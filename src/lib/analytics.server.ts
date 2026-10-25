/**
 * Raporty GA4 i Search Console. Sekrety tylko ze zmiennych serwera.
 * Brak VITE_ w odpowiedziach z liczbami, gdy konta nie podłączono.
 */
import { createSign } from "node:crypto";
import {
  GSC_PRIVACY_NOTE,
  GSC_STEPS,
  ORGANIC_NOTE,
  SETUP_STEPS,
  andFilters,
  blankReport,
  cacheHit,
  decorateEvents,
  deviceFilter,
  exactFilter,
  gaBody,
  inListFilter,
  isMeasurementId,
  organicShare,
  pageFilter,
  parseEvents,
  parseGscRows,
  parseGscTotals,
  parsePages,
  parseRealtime,
  parseSeries,
  parseSources,
  parseTotals,
  previousWindow,
  queryMovement,
  resolveRange,
  searchEngine,
  TRACK_EVENTS,
  type GaRunReport,
  type RangeId,
  type StatsPayload,
} from "./analytics.ts";

const SCOPES = [
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/webmasters.readonly",
].join(" ");

const HIST_TTL = 15 * 60 * 1000;
const LIVE_TTL = 60 * 1000;

type CacheEntry = { at: number; value: unknown };
type Memory = { token: { token: string; exp: number } | null; reports: Map<string, CacheEntry> };

const memory: Memory = { token: null, reports: new Map() };

export function clearAnalyticsCache() {
  memory.token = null;
  memory.reports.clear();
}

export type AnalyticsEnv = {
  propertyId: string;
  clientEmail: string;
  privateKey: string;
  siteUrl: string;
  measurementId: string;
  gaOk: boolean;
  gscOk: boolean;
};

export function readAnalyticsEnv(env: NodeJS.ProcessEnv = process.env): AnalyticsEnv {
  const propertyId = (env.GA4_PROPERTY_ID ?? "").trim();
  const clientEmail = (env.GA4_CLIENT_EMAIL ?? "").trim();
  const privateKey = (env.GA4_PRIVATE_KEY ?? "").replace(/\\n/g, "\n").trim();
  const siteUrl = (env.GSC_SITE_URL ?? "").trim();
  const measurementId = (env.VITE_GA_MEASUREMENT_ID ?? "").trim();
  const gaOk = /^\d+$/.test(propertyId) && clientEmail.includes("@") && privateKey.includes("BEGIN PRIVATE KEY");
  const gscOk = gaOk && /^https?:\/\/.+/i.test(siteUrl);
  return { propertyId, clientEmail, privateKey, siteUrl, measurementId, gaOk, gscOk };
}

function b64url(value: string | Buffer) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buffer.toString("base64url");
}

export function signServiceJwt(email: string, privateKeyPem: string, nowSec: number, scopes: string) {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: email,
      scope: scopes,
      aud: "https://oauth2.googleapis.com/token",
      iat: nowSec,
      exp: nowSec + 3600,
    }),
  );
  const unsigned = `${header}.${claim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(privateKeyPem).toString("base64url")}`;
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

async function googleError(response: Response) {
  if (response.status === 401 || response.status === 403) {
    return "Google odmówiło dostępu. Sprawdź uprawnienia konta usługi i włączone API.";
  }
  if (response.status === 404) return "Nie znaleziono usługi albo witryny. Sprawdź GA4_PROPERTY_ID i GSC_SITE_URL.";
  if (response.status === 429) return "Google ograniczyło liczbę zapytań. Spróbuj za kilka minut.";
  return "Google nie zwróciło raportu. Liczby nie zostały uzupełnione.";
}

async function googleJson(url: string, token: string, body: unknown, fetcher: Fetcher) {
  const response = await fetcher(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(await googleError(response));
  return (await response.json()) as unknown;
}

export async function fetchAccessToken(
  email: string,
  privateKey: string,
  now: number,
  fetcher: Fetcher,
  box: Memory = memory,
) {
  if (box.token && box.token.exp > now + 60_000) return box.token.token;
  const assertion = signServiceJwt(email, privateKey, Math.floor(now / 1000), SCOPES);
  const response = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(await googleError(response));
  const json = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("Google nie wydało tokenu. Klucz konta usługi może być niepełny.");
  box.token = { token: json.access_token, exp: now + (json.expires_in ?? 3600) * 1000 };
  return json.access_token;
}

export type StatsQuery = {
  section: "overview" | "organic" | "pages" | "sources" | "seo" | "conversions" | "page";
  range: RangeId;
  start?: string;
  end?: string;
  page?: string;
  device?: string;
  country?: string;
};

function safePage(path: string | undefined) {
  const value = (path ?? "").trim();
  return /^\/[a-z0-9/_-]{0,160}$/i.test(value) ? value : "";
}

function safeCountry(value: string | undefined) {
  const country = (value ?? "").trim().toLowerCase();
  return /^[a-z]{3}$/.test(country) ? country : "";
}

async function runGa(propertyId: string, token: string, body: unknown, fetcher: Fetcher, realtime = false) {
  const method = realtime ? "runRealtimeReport" : "runReport";
  const json = await googleJson(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:${method}`,
    token,
    body,
    fetcher,
  );
  return json as GaRunReport;
}

async function runGsc(siteUrl: string, token: string, body: unknown, fetcher: Fetcher) {
  return googleJson(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    token,
    body,
    fetcher,
  );
}

function gscBody(start: string, end: string, dimensions: string[], country: string, device: string, rowLimit = 25) {
  const filters = [];
  if (country) filters.push({ dimension: "country", operator: "equals", expression: country });
  if (device === "desktop" || device === "mobile" || device === "tablet") {
    filters.push({ dimension: "device", operator: "equals", expression: device.toUpperCase() });
  }
  const body: Record<string, unknown> = { startDate: start, endDate: end, type: "web", rowLimit };
  if (dimensions.length) body.dimensions = dimensions;
  if (filters.length) body.dimensionFilterGroups = [{ filters }];
  return body;
}

function base(
  query: StatsQuery,
  env: AnalyticsEnv,
  range: { start: string; end: string; label: string; partial: boolean },
): StatsPayload {
  return blankReport(query.section, {
    configured: true,
    gaConfigured: true,
    gscConfigured: env.gscOk,
    measurementConfigured: isMeasurementId(env.measurementId),
    title: "",
    steps: [],
    rangeLabel: range.label,
    partial: range.partial,
    start: range.start,
    end: range.end,
  });
}

export async function loadStats(
  query: StatsQuery,
  deps?: { env?: NodeJS.ProcessEnv; fetch?: Fetcher; now?: Date; memory?: Memory },
): Promise<StatsPayload> {
  const env = readAnalyticsEnv(deps?.env ?? process.env);
  const now = deps?.now ?? new Date();
  const fetcher = deps?.fetch ?? fetch;
  const box = deps?.memory ?? memory;
  if (!env.gaOk) {
    return blankReport(query.section, {
      title: "Nie skonfigurowano",
      steps: [...SETUP_STEPS],
      measurementConfigured: isMeasurementId(env.measurementId),
    });
  }
  if (query.section === "seo" && !env.gscOk) {
    return blankReport(query.section, {
      gaConfigured: true,
      gscConfigured: false,
      measurementConfigured: isMeasurementId(env.measurementId),
      title: "Nie skonfigurowano",
      steps: [...GSC_STEPS],
      note: "Search Console nie jest podłączone. Pozostałe zakładki mogą działać.",
    });
  }
  const range = resolveRange(query.range, { start: query.start, end: query.end }, now);
  if (!range) {
    return blankReport(query.section, {
      configured: true,
      gaConfigured: true,
      gscConfigured: env.gscOk,
      measurementConfigured: isMeasurementId(env.measurementId),
      title: "",
      steps: [],
      error: "Podaj daty w formacie RRRR-MM-DD. Zakres nie może być dłuższy niż rok.",
    });
  }
  const page = safePage(query.page);
  const device = query.device === "desktop" || query.device === "mobile" || query.device === "tablet" ? query.device : "";
  const country = safeCountry(query.country);
  if (query.section === "page" && !page) {
    return blankReport(query.section, {
      configured: true,
      gaConfigured: true,
      gscConfigured: env.gscOk,
      title: "",
      steps: [],
      error: "Wybierz podstronę z listy.",
      rangeLabel: range.label,
      start: range.start,
      end: range.end,
    });
  }
  const cacheKey = JSON.stringify({
    section: query.section,
    start: range.start,
    end: range.end,
    page,
    device,
    country,
  });
  const nowMs = now.getTime();
  const hit = cacheHit(box.reports.get(cacheKey) as { at: number; value: StatsPayload } | undefined, nowMs, HIST_TTL);
  if (hit && query.section !== "overview") return hit;

  try {
    const token = await fetchAccessToken(env.clientEmail, env.privateKey, nowMs, fetcher, box);
    const report = hit ?? (await buildReport(query, env, range, { page, device, country }, token, fetcher));
    if (!hit) box.reports.set(cacheKey, { at: nowMs, value: report });
    if (query.section !== "overview") return report;
    const liveKey = "realtime";
    const liveHit = cacheHit(box.reports.get(liveKey) as { at: number; value: number | null } | undefined, nowMs, LIVE_TTL);
    let activeUsers: number | null;
    if (liveHit !== undefined) activeUsers = liveHit;
    else {
      try {
        activeUsers = parseRealtime(
          await runGa(env.propertyId, token, { metrics: [{ name: "activeUsers" }] }, fetcher, true),
        );
        box.reports.set(liveKey, { at: nowMs, value: activeUsers });
      } catch {
        return {
          ...report,
          realtime: { activeUsers: null, fetchedAt: new Date(nowMs).toISOString() },
          note: "Liczba osób aktywnych teraz jest chwilowo niedostępna. Wykres historyczny jej nie zawiera.",
        };
      }
    }
    return { ...report, realtime: { activeUsers, fetchedAt: new Date(nowMs).toISOString() } };
  } catch (error) {
    const message = error instanceof Error && error.message.length < 220 ? error.message : "Nie udało się pobrać raportu.";
    return blankReport(query.section, {
      configured: true,
      gaConfigured: true,
      gscConfigured: env.gscOk,
      measurementConfigured: isMeasurementId(env.measurementId),
      title: "",
      steps: [],
      error: message,
      rangeLabel: range.label,
      start: range.start,
      end: range.end,
    });
  }
}

async function buildReport(
  query: StatsQuery,
  env: AnalyticsEnv,
  range: { start: string; end: string; label: string; partial: boolean },
  filter: { page: string; device: string; country: string },
  token: string,
  fetcher: Fetcher,
): Promise<StatsPayload> {
  const payload = base(query, env, range);
  const prev = previousWindow(range.start, range.end);
  const device = deviceFilter(filter.device);
  if (query.section === "overview") {
    const current = await runGa(
      env.propertyId,
      token,
      gaBody({ start: range.start, end: range.end, dimensions: ["date"], filter: device, totals: true, limit: 100 }),
      fetcher,
    );
    const before = await runGa(
      env.propertyId,
      token,
      gaBody({ start: prev.start, end: prev.end, filter: device, totals: true }),
      fetcher,
    );
    payload.totals = parseTotals(current);
    payload.previousTotals = parseTotals(before);
    payload.series = parseSeries(current);
    payload.note = payload.partial ? "Dane z dzisiaj w GA4 często dochodzą z opóźnieniem i bywają niepełne." : "";
    return payload;
  }
  if (query.section === "organic") {
    const organic = andFilters([exactFilter("sessionDefaultChannelGroup", "Organic Search"), device]);
    const [trend, pages, engines, all] = await Promise.all([
      runGa(env.propertyId, token, gaBody({ start: range.start, end: range.end, dimensions: ["date"], filter: organic, totals: true, limit: 100 }), fetcher),
      runGa(env.propertyId, token, gaBody({ start: range.start, end: range.end, dimensions: ["pagePath"], metrics: ["screenPageViews", "activeUsers", "sessions", "userEngagementDuration"], filter: organic, orderMetric: "screenPageViews", limit: 20 }), fetcher),
      runGa(env.propertyId, token, gaBody({ start: range.start, end: range.end, dimensions: ["sessionSource"], metrics: ["sessions", "activeUsers"], filter: organic, orderMetric: "sessions", limit: 15 }), fetcher),
      runGa(env.propertyId, token, gaBody({ start: range.start, end: range.end, metrics: ["sessions", "activeUsers"], filter: device, totals: true }), fetcher),
    ]);
    const organicTotals = parseTotals(trend);
    const allTotals = parseTotals(all);
    const engineRows = parseSources(engines);
    const grouped = new Map<string, number | null>();
    for (const row of engineRows) {
      const name = searchEngine(row.source);
      const prevValue = grouped.get(name);
      if (row.sessions === null) {
        if (!grouped.has(name)) grouped.set(name, null);
        continue;
      }
      grouped.set(name, (prevValue ?? 0) + row.sessions);
    }
    payload.organic = {
      sessions: organicTotals?.sessions ?? null,
      users: organicTotals?.users ?? null,
      share: organicShare(allTotals?.sessions ?? null, organicTotals?.sessions ?? null),
      note: ORGANIC_NOTE,
      series: parseSeries(trend),
      pages: parsePages(pages),
      engines: [...grouped.entries()].map(([name, sessions]) => ({ name, sessions })),
    };
    payload.totals = organicTotals;
    return payload;
  }
  if (query.section === "pages") {
    const report = await runGa(
      env.propertyId,
      token,
      gaBody({
        start: range.start,
        end: range.end,
        dimensions: ["pagePath"],
        filter: device,
        orderMetric: "screenPageViews",
        limit: 30,
      }),
      fetcher,
    );
    payload.pages = parsePages(report);
    return payload;
  }
  if (query.section === "sources") {
    const report = await runGa(
      env.propertyId,
      token,
      gaBody({
        start: range.start,
        end: range.end,
        dimensions: ["sessionDefaultChannelGroup", "sessionSource"],
        metrics: ["sessions", "activeUsers"],
        filter: device,
        orderMetric: "sessions",
        limit: 40,
      }),
      fetcher,
    );
    payload.sources = parseSources(report);
    return payload;
  }
  if (query.section === "conversions") {
    const report = await runGa(
      env.propertyId,
      token,
      gaBody({
        start: range.start,
        end: range.end,
        dimensions: ["eventName", "sessionDefaultChannelGroup"],
        metrics: ["eventCount"],
        filter: andFilters([inListFilter("eventName", [...TRACK_EVENTS]), device, pageFilter(filter.page)]),
        limit: 100,
      }),
      fetcher,
    );
    payload.conversions = {
      events: decorateEvents(parseEvents(report)),
      note: "Zliczane są tylko nazwy zdarzeń. Treść wiadomości, e-mail i opis zdrowia nie wychodzą ze strony.",
    };
    return payload;
  }
  if (query.section === "page") {
    const onPage = andFilters([pageFilter(filter.page), device]);
    const [current, before, trend, channels, events] = await Promise.all([
      runGa(env.propertyId, token, gaBody({ start: range.start, end: range.end, filter: onPage, totals: true }), fetcher),
      runGa(env.propertyId, token, gaBody({ start: prev.start, end: prev.end, filter: onPage, totals: true }), fetcher),
      runGa(env.propertyId, token, gaBody({ start: range.start, end: range.end, dimensions: ["date"], filter: onPage, limit: 100 }), fetcher),
      runGa(env.propertyId, token, gaBody({ start: range.start, end: range.end, dimensions: ["sessionDefaultChannelGroup"], metrics: ["sessions", "activeUsers"], filter: onPage, limit: 12 }), fetcher),
      runGa(env.propertyId, token, gaBody({ start: range.start, end: range.end, dimensions: ["eventName"], metrics: ["eventCount"], filter: andFilters([onPage, inListFilter("eventName", [...TRACK_EVENTS])]), limit: 20 }), fetcher),
    ]);
    const totals = parseTotals(current);
    const sourceRows = parseSources(channels);
    const organicSessions = sourceRows.find((row) => row.channel === "Organic Search")?.sessions ?? null;
    payload.page = {
      path: filter.page,
      totals,
      previousTotals: parseTotals(before),
      series: parseSeries(trend),
      sources: sourceRows.map((row) => ({ channel: row.channel || row.bucket, sessions: row.sessions, users: row.users })),
      organicShare: organicShare(totals?.sessions ?? null, organicSessions),
      events: decorateEvents(parseEvents(events)),
      note: `${ORGANIC_NOTE} Udział organiczny liczy się z sesji tego adresu.`,
    };
    return payload;
  }
  const [totalsBody, queryBody, pageBody, prevTotals, prevQueries] = await Promise.all([
    runGsc(env.siteUrl, token, gscBody(range.start, range.end, [], filter.country, filter.device, 1), fetcher),
    runGsc(env.siteUrl, token, gscBody(range.start, range.end, ["query"], filter.country, filter.device, 25), fetcher),
    runGsc(env.siteUrl, token, gscBody(range.start, range.end, ["page"], filter.country, filter.device, 20), fetcher),
    runGsc(env.siteUrl, token, gscBody(prev.start, prev.end, [], filter.country, filter.device, 1), fetcher),
    runGsc(env.siteUrl, token, gscBody(prev.start, prev.end, ["query"], filter.country, filter.device, 50), fetcher),
  ]);
  const movement = queryMovement(parseGscRows(queryBody), parseGscRows(prevQueries));
  const headline = parseGscTotals(totalsBody);
  payload.seo = {
    clicks: headline?.clicks ?? null,
    impressions: headline?.impressions ?? null,
    ctr: headline?.ctr ?? null,
    position: headline?.position ?? null,
    previous: parseGscTotals(prevTotals),
    queries: movement.rows.slice(0, 25),
    pages: parseGscRows(pageBody),
    rising: movement.rising,
    falling: movement.falling,
    note: GSC_PRIVACY_NOTE,
  };
  return payload;
}
