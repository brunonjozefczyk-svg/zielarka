/** Czysta logika pomiaru. Bez sieci, bez sekretów, bez wymyślonych liczb. */

export const CONSENT_STORAGE_KEY = "zielarka.consent";

export type ConsentChoice = "granted" | "denied";

export type ConsentFlags = {
  analytics_storage: "granted" | "denied";
  ad_storage: "denied";
  ad_user_data: "denied";
  ad_personalization: "denied";
  functionality_storage: "denied";
  personalization_storage: "denied";
  security_storage: "granted";
};

export function defaultConsent(): ConsentFlags {
  return {
    analytics_storage: "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    functionality_storage: "denied",
    personalization_storage: "denied",
    security_storage: "granted",
  };
}

export function consentFromChoice(choice: ConsentChoice): ConsentFlags {
  const flags = defaultConsent();
  if (choice === "granted") flags.analytics_storage = "granted";
  return flags;
}

export function readStoredConsent(storage: { getItem(key: string): string | null }): ConsentChoice | "unknown" {
  let value: string | null;
  try { value = storage.getItem(CONSENT_STORAGE_KEY); } catch { return "unknown"; }
  if (value === "granted" || value === "denied") return value;
  return "unknown";
}

export function isMeasurementId(value: string | undefined | null): boolean {
  return /^G-[A-Z0-9]+$/i.test((value ?? "").trim());
}

export function publicMeasurementEnabled(config: {
  id?: string; enabled?: string; manualEventsConfirmed?: string;
  policyReady: boolean; origin: string; path: string;
}): boolean {
  return config.policyReady && config.enabled === "true" &&
    config.manualEventsConfirmed === "true" && isMeasurementId(config.id) &&
    config.origin === "https://zielarka.pl" && trackOnThisPage(config.path);
}

export const SETUP_STEPS = [
  "W Google Analytics utwórz usługę GA4 dla https://zielarka.pl. Identyfikator pomiaru wygląda jak G-XXXXXXXX.",
  "W Vercel dodaj publiczną zmienną VITE_GA_MEASUREMENT_ID z tym identyfikatorem. Bez niej baner zgody się nie pojawi i strona nie wyśle odwiedzin. To nie jest sekret.",
  "W Google Cloud włącz Google Analytics Data API oraz Google Search Console API. Utwórz konto usługi i pobierz klucz JSON.",
  "Z klucza weź client_email do GA4_CLIENT_EMAIL i private_key do GA4_PRIVATE_KEY (cały blok BEGIN PRIVATE KEY). Te zmienne są tylko na serwerze. Nigdy nie wkładaj ich do gita.",
  "W usłudze GA4 dodaj ten e-mail jako Przeglądający. Numer usługi, same cyfry, wpisz w GA4_PROPERTY_ID.",
  "W Search Console dodaj ten sam e-mail do użytkowników witryny. GSC_SITE_URL ustaw na zweryfikowany adres, zwykle https://zielarka.pl/",
  "Sekrety konfiguruj osobno dla środowisk. Preview nie może wysyłać pomiarów do produkcyjnej usługi. Włączenie pomiaru wymaga też zatwierdzonej polityki i VITE_ANALYTICS_ENABLED=true.",
  "Dopóki zmiennych nie ma, ten ekran pokazuje tylko instrukcję. Nie pokazuje przykładowych liczb.",
] as const;

export const GSC_STEPS = [
  "Użyj istniejącej zweryfikowanej usługi: https://zielarka.pl/ albo sc-domain:zielarka.pl.",
  "Dodaj e-mail konta usługi jako użytkownika witryny.",
  "W Vercel ustaw GSC_SITE_URL dokładnie na zweryfikowany adres.",
  "Włącz Google Search Console API w tym samym projekcie Cloud.",
] as const;

export const TRACK_EVENTS = [
  "consultation_click",
  "phone_click",
  "email_click",
  "form_start",
  "form_success",
  "workshop_click",
  "club_click",
] as const;

export type TrackEvent = (typeof TRACK_EVENTS)[number];

export const EVENT_LABELS: Record<TrackEvent, string> = {
  consultation_click: "Przejście do konsultacji",
  phone_click: "Kliknięcie telefonu",
  email_click: "Kliknięcie e-maila",
  form_start: "Kliknięcie wysłania formularza (jeszcze bez potwierdzenia)",
  form_success: "Potwierdzone wysłanie formularza",
  workshop_click: "Przejście do warsztatów",
  club_click: "Przejście do klubu",
};

const EVENT_SET = new Set<string>(TRACK_EVENTS);

export function sanitizeEvent(name: string, params?: Record<string, unknown>) {
  if (!EVENT_SET.has(name)) return null;
  const rawPath = typeof params?.page_path === "string" ? params.page_path : "";
  const path = rawPath.split("?")[0]?.split("#")[0] ?? "";
  const out: Record<string, string> = {};
  if (path.startsWith("/") && path.length <= 180) out.page_path = path;
  const href = typeof params?.link_url === "string" ? params.link_url : "";
  if (href.toLowerCase().startsWith("tel:")) out.link_kind = "tel";
  else if (href.toLowerCase().startsWith("mailto:")) out.link_kind = "mailto";
  else if (href.startsWith("/")) {
    const link = (href.split("?")[0] ?? "").split("#")[0] ?? "";
    if (link.startsWith("/") && link.length > 0 && link.length <= 180) out.link_url = link;
  }
  return { name: name as TrackEvent, params: out };
}

export function eventFromClick(href: string): TrackEvent | null {
  const raw = href.trim();
  if (!raw || raw.startsWith("#") || raw.toLowerCase().startsWith("javascript:")) return null;
  if (raw.toLowerCase().startsWith("tel:")) return "phone_click";
  if (raw.toLowerCase().startsWith("mailto:")) return "email_click";
  let path = raw;
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    try {
      path = new URL(raw).pathname;
    } catch {
      return null;
    }
  }
  const clean = (path.split("?")[0] ?? path).replace(/\/$/, "") || "/";
  if (clean === "/konsultacje") return "consultation_click";
  if (clean === "/warsztaty") return "workshop_click";
  if (clean === "/klub") return "club_click";
  return null;
}

export const CONVERSION_NOTE =
  "Pomiar potwierdzonych zgłoszeń jest niedostępny. Formularz wysyła wiadomości bezpośrednio przez FormSubmit. Kliknięcie wysłania ani adres /kontakt?wyslane=1 nie potwierdzają dostarczenia wiadomości.";

export function formSuccessPath(_pathname: string, _search: string): boolean {
  return false;
}

/** Jedno przyjęte zgłoszenie = jeden identyfikator. Odświeżenie strony nie ma tego identyfikatora. */
export function shouldCountDelivery(accepted: boolean, receipt: string, seen: Set<string>): boolean {
  if (!accepted || !receipt || receipt.length < 20 || receipt.length > 300) return false;
  if (receipt.includes("@") || /\s/.test(receipt) || receipt.includes("http")) return false;
  if (seen.has(receipt)) return false;
  seen.add(receipt);
  return true;
}

export function trackOnThisPage(pathname: string): boolean {
  return /^(?:\/|\/(?:kontakt|konsultacje|warsztaty|klub|o-mnie|zielnik)\/?|\/zielnik\/[a-z0-9-]{1,80}\/?)$/.test(pathname);
}

export function pageViewKey(pathname: string, search: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const flag = params.get("wyslane") === "1" ? "?wyslane=1" : "";
  return `${pathname}${flag}`;
}

export function claimPageView(key: string, now: number, state: { key: string; at: number }): boolean {
  if (!key) return false;
  if (state.key === key && now - state.at < 1000) return false;
  state.key = key;
  state.at = now;
  return true;
}

export type RangeId = "today" | "7" | "30" | "90" | "custom";

export type DateWindow = { start: string; end: string; label: string; partial: boolean };

export function warsawDay(now: Date, timeZone = "Europe/Warsaw"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function shiftIso(day: string, delta: number): string {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return day;
  const next = new Date(Date.UTC(year, month - 1, date + delta));
  return next.toISOString().slice(0, 10);
}

export function resolveRange(id: RangeId, custom?: { start?: string; end?: string }, now = new Date(), timeZone = "Europe/Warsaw"): DateWindow | null {
  const end = warsawDay(now, timeZone);
  if (id === "today") return { start: end, end, label: "Dzisiaj", partial: true };
  if (id === "7") return { start: shiftIso(end, -6), end, label: "Ostatnie 7 dni", partial: true };
  if (id === "30") return { start: shiftIso(end, -29), end, label: "Ostatnie 30 dni", partial: true };
  if (id === "90") return { start: shiftIso(end, -89), end, label: "Ostatnie 90 dni", partial: true };
  if (id !== "custom") return null;
  const start = custom?.start ?? "";
  const finish = custom?.end ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(finish)) return null;
  if (start > finish || finish > end) return null;
  for (const day of [start, finish]) {
    const date = new Date(`${day}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) return null;
  }
  const span = (Date.parse(`${finish}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000;
  if (!Number.isFinite(span) || span > 366) return null;
  return { start, end: finish, label: `${start} – ${finish}`, partial: finish === end };
}

export function previousWindow(start: string, end: string): DateWindow {
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
  const prevEnd = shiftIso(start, -1);
  const prevStart = shiftIso(prevEnd, -(days - 1));
  return { start: prevStart, end: prevEnd, label: "Poprzedni okres", partial: false };
}

export function num(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

export function averageEngagementSeconds(totalDuration: number | null, users: number | null): number | null {
  if (totalDuration === null || users === null || users <= 0) return null;
  return totalDuration / users;
}

export function organicShare(totalSessions: number | null, organicSessions: number | null): number | null {
  if (totalSessions === null || organicSessions === null || totalSessions <= 0) return null;
  return organicSessions / totalSessions;
}

export type GaValue = { value?: string };
export type GaRow = { dimensionValues?: GaValue[]; metricValues?: GaValue[] };
export type GaRunReport = {
  dimensionHeaders?: { name?: string }[];
  metricHeaders?: { name?: string }[];
  rows?: GaRow[];
  totals?: GaRow[];
};

export function indexHeaders(headers: { name?: string }[] | undefined) {
  const map = new Map<string, number>();
  (headers ?? []).forEach((header, index) => {
    if (header.name) map.set(header.name, index);
  });
  return map;
}

export function cell(row: GaRow | undefined, map: Map<string, number>, name: string, kind: "dim" | "metric"): string | null {
  if (!row) return null;
  const index = map.get(name);
  if (index === undefined) return null;
  const list = kind === "dim" ? row.dimensionValues : row.metricValues;
  const value = list?.[index]?.value;
  if (value === undefined || value === "") return null;
  return value;
}

export type MetricRow = {
  users: number | null;
  newUsers: number | null;
  sessions: number | null;
  views: number | null;
  engagedSessions: number | null;
  engagementSeconds: number | null;
  engagementRate: number | null;
  bounceRate: number | null;
};

export function parseMetricRow(report: GaRunReport | null | undefined, row: GaRow | undefined): MetricRow | null {
  if (!report?.metricHeaders?.length || !row) return null;
  const metrics = indexHeaders(report.metricHeaders);
  const users = num(cell(row, metrics, "activeUsers", "metric"));
  const duration = num(cell(row, metrics, "userEngagementDuration", "metric"));
  return {
    users,
    newUsers: num(cell(row, metrics, "newUsers", "metric")),
    sessions: num(cell(row, metrics, "sessions", "metric")),
    views: num(cell(row, metrics, "screenPageViews", "metric")),
    engagedSessions: num(cell(row, metrics, "engagedSessions", "metric")),
    engagementSeconds: averageEngagementSeconds(duration, users),
    engagementRate: num(cell(row, metrics, "engagementRate", "metric")),
    bounceRate: num(cell(row, metrics, "bounceRate", "metric")),
  };
}

export function parseTotals(report: GaRunReport | null | undefined): MetricRow | null {
  if (!report) return null;
  const row = report.totals?.[0] ?? (report.dimensionHeaders?.length ? undefined : report.rows?.[0]);
  return parseMetricRow(report, row);
}

export function gaDate(value: string | null): string {
  if (!value) return "";
  if (/^\d{8}$/.test(value)) return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  return value;
}

export type SeriesPoint = { date: string; users: number | null; sessions: number | null; views: number | null };

export function parseSeries(report: GaRunReport | null | undefined): SeriesPoint[] {
  if (!report?.rows?.length || !report.dimensionHeaders?.some((header) => header.name === "date")) return [];
  const dims = indexHeaders(report.dimensionHeaders);
  const metrics = indexHeaders(report.metricHeaders);
  return report.rows
    .map((row) => ({
      date: gaDate(cell(row, dims, "date", "dim")),
      users: num(cell(row, metrics, "activeUsers", "metric")),
      sessions: num(cell(row, metrics, "sessions", "metric")),
      views: num(cell(row, metrics, "screenPageViews", "metric")),
    }))
    .filter((point) => point.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export type PageStat = {
  path: string;
  views: number | null;
  users: number | null;
  sessions: number | null;
  engagementSeconds: number | null;
  bounceRate: number | null;
};

export function parsePages(report: GaRunReport | null | undefined): PageStat[] {
  if (!report?.rows?.length) return [];
  const dims = indexHeaders(report.dimensionHeaders);
  const metrics = indexHeaders(report.metricHeaders);
  return report.rows
    .map((row) => {
      const users = num(cell(row, metrics, "activeUsers", "metric"));
      const duration = num(cell(row, metrics, "userEngagementDuration", "metric"));
      return {
        path: cell(row, dims, "pagePath", "dim") ?? "",
        views: num(cell(row, metrics, "screenPageViews", "metric")),
        users,
        sessions: num(cell(row, metrics, "sessions", "metric")),
        engagementSeconds: averageEngagementSeconds(duration, users),
        bounceRate: num(cell(row, metrics, "bounceRate", "metric")),
      };
    })
    .filter((row) => row.path.startsWith("/"));
}

export function sourceBucket(channel: string, source: string): string {
  const group = channel.toLowerCase();
  const name = source.toLowerCase();
  if (group === "organic search") {
    if (name.includes("google")) return "Google — wyniki organiczne";
    return "Bing i inne wyszukiwarki";
  }
  if (name.includes("facebook") || name === "fb" || name.includes("fb.com")) return "Facebook";
  if (name.includes("instagram")) return "Instagram";
  if (group === "direct" || name === "(direct)") return "Wejścia bezpośrednie";
  if (group === "referral") return "Polecenia z innych stron";
  return "Pozostałe źródła i kampanie";
}

export function searchEngine(source: string): string {
  const name = source.toLowerCase();
  if (name.includes("google")) return "Google";
  if (name.includes("bing")) return "Bing";
  if (name.includes("duckduckgo")) return "DuckDuckGo";
  if (name.includes("yahoo")) return "Yahoo";
  if (name.includes("ecosia")) return "Ecosia";
  if (!name || name === "(not set)") return "Nierozpoznana wyszukiwarka";
  return "Inne wyszukiwarki";
}

export type SourceStat = {
  bucket: string;
  channel: string;
  source: string;
  sessions: number | null;
  users: number | null;
};

export function parseSources(report: GaRunReport | null | undefined): SourceStat[] {
  if (!report?.rows?.length) return [];
  const dims = indexHeaders(report.dimensionHeaders);
  const metrics = indexHeaders(report.metricHeaders);
  return report.rows.map((row) => {
    const channel = cell(row, dims, "sessionDefaultChannelGroup", "dim") ?? "";
    const source = cell(row, dims, "sessionSource", "dim") ?? "";
    return {
      bucket: sourceBucket(channel, source),
      channel,
      source,
      sessions: num(cell(row, metrics, "sessions", "metric")),
      users: num(cell(row, metrics, "activeUsers", "metric")),
    };
  });
}

export type EventHit = { name: string; channel: string; count: number | null };

export function parseEvents(report: GaRunReport | null | undefined): EventHit[] {
  if (!report?.rows?.length) return [];
  const dims = indexHeaders(report.dimensionHeaders);
  const metrics = indexHeaders(report.metricHeaders);
  return report.rows
    .map((row) => ({
      name: cell(row, dims, "eventName", "dim") ?? "",
      channel: cell(row, dims, "sessionDefaultChannelGroup", "dim") ?? "",
      count: num(cell(row, metrics, "eventCount", "metric")),
    }))
    .filter((row) => EVENT_SET.has(row.name));
}

export type EventStat = {
  name: TrackEvent;
  label: string;
  count: number | null;
  channels: { channel: string; count: number | null }[];
  seen: boolean;
};

export function decorateEvents(rows: EventHit[]): EventStat[] {
  return TRACK_EVENTS.map((name) => {
    const mine = rows.filter((row) => row.name === name);
    if (!mine.length) {
      return { name, label: EVENT_LABELS[name], count: null, channels: [], seen: false };
    }
    const known = mine.filter((row) => row.count !== null);
    const count = known.length ? known.reduce((sum, row) => sum + (row.count ?? 0), 0) : null;
    return {
      name,
      label: EVENT_LABELS[name],
      count,
      channels: mine.map((row) => ({ channel: row.channel || "nieznany kanał", count: row.count })),
      seen: true,
    };
  });
}

export function parseRealtime(report: GaRunReport | null | undefined): number | null {
  if (!report?.rows?.length) return null;
  const metrics = indexHeaders(report.metricHeaders);
  return num(cell(report.rows[0], metrics, "activeUsers", "metric"));
}

export type GscRow = {
  key: string;
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  position: number | null;
};

export function parseGscRows(body: unknown): GscRow[] {
  if (!body || typeof body !== "object" || !Array.isArray((body as { rows?: unknown }).rows)) return [];
  return (body as { rows: unknown[] }).rows.map((row) => {
    const item = (row ?? {}) as {
      keys?: unknown;
      clicks?: unknown;
      impressions?: unknown;
      ctr?: unknown;
      position?: unknown;
    };
    const key = Array.isArray(item.keys) && typeof item.keys[0] === "string" ? item.keys[0] : "";
    return {
      key,
      clicks: num(item.clicks),
      impressions: num(item.impressions),
      ctr: num(item.ctr),
      position: num(item.position),
    };
  });
}

export function parseGscTotals(body: unknown): Omit<GscRow, "key"> | null {
  const rows = parseGscRows(body);
  if (!rows.length) return null;
  const row = rows[0];
  if (!row) return null;
  return { clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position };
}

export type GscCompare = GscRow & { clicksDelta: number | null; note: string };

export function queryMovement(current: GscRow[], previous: GscRow[]) {
  const prev = new Map(previous.filter((row) => row.key).map((row) => [row.key, row]));
  const rows: GscCompare[] = current
    .filter((row) => row.key)
    .map((row) => {
      const before = prev.get(row.key);
      const clicksDelta =
        before && row.clicks !== null && before.clicks !== null ? row.clicks - before.clicks : null;
      const note = before ? "" : "Brak w poprzednim okresie. Google mógł ukryć frazę — to nie jest zero.";
      return { ...row, clicksDelta, note };
    });
  const rising = rows
    .filter((row) => row.clicksDelta !== null && row.clicksDelta > 0)
    .sort((a, b) => (b.clicksDelta ?? 0) - (a.clicksDelta ?? 0))
    .slice(0, 8);
  const falling = rows
    .filter((row) => row.clicksDelta !== null && row.clicksDelta < 0)
    .sort((a, b) => (a.clicksDelta ?? 0) - (b.clicksDelta ?? 0))
    .slice(0, 8);
  return { rows, rising, falling };
}

export const GSC_PRIVACY_NOTE =
  "Search Console ukrywa rzadkie frazy. Porównujemy tylko pobrane czołowe frazy (25 obecnych i 50 poprzednich), nie pełną listę wzrostów i spadków. Brak wiersza nie oznacza zera. Daty GSC są w strefie America/Los_Angeles; najnowsze dni mogą być niedostępne.";

export const ENGAGEMENT_NOTE =
  "Średni czas zaangażowania to userEngagementDuration podzielone przez activeUsers. GA4 liczy czas, gdy karta była na wierzchu. To nie jest stoper konkretnej osoby.";

export const ORGANIC_NOTE =
  "Sesje z kanału GA4 „Organic Search”. To nie są kliknięcia z Google Search Console.";

export type GaFilter = {
  filter?: {
    fieldName: string;
    stringFilter?: { matchType: "EXACT"; value: string };
    inListFilter?: { values: string[] };
  };
  andGroup?: { expressions: GaFilter[] };
};

export function exactFilter(field: string, value: string): GaFilter {
  return { filter: { fieldName: field, stringFilter: { matchType: "EXACT", value } } };
}

export function inListFilter(field: string, values: string[]): GaFilter {
  return { filter: { fieldName: field, inListFilter: { values } } };
}

export function andFilters(filters: Array<GaFilter | undefined>): GaFilter | undefined {
  const list = filters.filter((item): item is GaFilter => Boolean(item));
  if (!list.length) return undefined;
  if (list.length === 1) return list[0];
  return { andGroup: { expressions: list } };
}

export function deviceFilter(device: string): GaFilter | undefined {
  if (device !== "desktop" && device !== "mobile" && device !== "tablet") return undefined;
  return exactFilter("deviceCategory", device);
}

export function pageFilter(path: string): GaFilter | undefined {
  if (!/^\/[a-z0-9/_-]{0,160}$/i.test(path)) return undefined;
  return exactFilter("pagePath", path);
}

const GA_CORE_METRICS = [
  "activeUsers",
  "newUsers",
  "sessions",
  "screenPageViews",
  "engagedSessions",
  "userEngagementDuration",
  "engagementRate",
  "bounceRate",
];

export function gaBody(options: {
  start: string;
  end: string;
  dimensions?: string[];
  metrics?: string[];
  filter?: GaFilter;
  limit?: number;
  orderMetric?: string;
  totals?: boolean;
}) {
  const body: Record<string, unknown> = {
    dateRanges: [{ startDate: options.start, endDate: options.end }],
    metrics: (options.metrics ?? GA_CORE_METRICS).map((name) => ({ name })),
  };
  if (options.dimensions?.length) body.dimensions = options.dimensions.map((name) => ({ name }));
  if (options.filter) body.dimensionFilter = options.filter;
  if (options.limit) body.limit = options.limit;
  if (options.dimensions?.includes("date")) body.orderBys = [{ dimension: { dimensionName: "date" }, desc: false }];
  else if (options.orderMetric) body.orderBys = [{ metric: { metricName: options.orderMetric }, desc: true }];
  if (options.totals) body.metricAggregations = ["TOTAL"];
  return body;
}

export function cacheHit<T>(entry: { at: number; value: T } | undefined, now: number, ttl: number): T | undefined {
  if (!entry) return undefined;
  if (now - entry.at >= ttl) return undefined;
  return entry.value;
}

export function formatCount(value: number | null): string {
  if (value === null) return "—";
  return Math.round(value).toLocaleString("pl-PL");
}

export function formatPercent(ratio: number | null): string {
  if (ratio === null) return "—";
  return `${(ratio * 100).toLocaleString("pl-PL", { maximumFractionDigits: 1 })}%`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  if (minutes <= 0) return `${rest} s`;
  return `${minutes} min ${rest} s`;
}

export function formatDelta(current: number | null, previous: number | null): string {
  if (current === null || previous === null) return "—";
  const diff = Math.round(current - previous);
  const sign = diff > 0 ? "+" : "";
  return `${sign}${diff.toLocaleString("pl-PL")} wobec poprzedniego okresu`;
}

export type RealtimeStat = { activeUsers: number | null; fetchedAt: string } | null;

export type OrganicStat = {
  sessions: number | null;
  users: number | null;
  share: number | null;
  note: string;
  series: SeriesPoint[];
  pages: PageStat[];
  engines: { name: string; sessions: number | null }[];
};

export type SeoStat = {
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  position: number | null;
  previous: { clicks: number | null; impressions: number | null; ctr: number | null; position: number | null } | null;
  queries: GscCompare[];
  pages: GscRow[];
  rising: GscCompare[];
  falling: GscCompare[];
  note: string;
};

export type PageDetail = {
  path: string;
  totals: MetricRow | null;
  previousTotals: MetricRow | null;
  series: SeriesPoint[];
  sources: { channel: string; sessions: number | null; users: number | null }[];
  organicShare: number | null;
  events: EventStat[];
  note: string;
};

export type StatsPayload = {
  configured: boolean;
  gaConfigured: boolean;
  gscConfigured: boolean;
  measurementConfigured: boolean;
  title: string;
  steps: string[];
  error: string;
  note: string;
  section: string;
  rangeLabel: string;
  partial: boolean;
  start: string;
  end: string;
  totals: MetricRow | null;
  previousTotals: MetricRow | null;
  series: SeriesPoint[] | null;
  pages: PageStat[] | null;
  sources: SourceStat[] | null;
  organic: OrganicStat | null;
  seo: SeoStat | null;
  conversions: { events: EventStat[]; note: string } | null;
  page: PageDetail | null;
  realtime: RealtimeStat;
};

export function blankReport(section: string, extra?: Partial<StatsPayload>): StatsPayload {
  return {
    configured: false,
    gaConfigured: false,
    gscConfigured: false,
    measurementConfigured: false,
    title: "Nie skonfigurowano",
    steps: [...SETUP_STEPS],
    error: "",
    note: "",
    section,
    rangeLabel: "",
    partial: false,
    start: "",
    end: "",
    totals: null,
    previousTotals: null,
    series: null,
    pages: null,
    sources: null,
    organic: null,
    seo: null,
    conversions: null,
    page: null,
    realtime: null,
    ...extra,
  };
}
