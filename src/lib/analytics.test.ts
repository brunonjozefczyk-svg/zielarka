import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import test from "node:test";
import {
  GSC_PRIVACY_NOTE,
  averageEngagementSeconds,
  blankReport,
  cacheHit,
  claimPageView,
  consentFromChoice,
  decorateEvents,
  defaultConsent,
  eventFromClick,
  formSuccessPath,
  formatCount,
  organicShare,
  pageViewKey,
  parseGscTotals,
  parseRealtime,
  parseSeries,
  parseTotals,
  queryMovement,
  readStoredConsent,
  resolveRange,
  sanitizeEvent,
  shouldCountDelivery,
  type GaRunReport,
} from "./analytics.ts";
import { issueFormReceipt, loadStats, readAnalyticsEnv, receiptValid, signServiceJwt } from "./analytics.server.ts";

test("domyślna zgoda blokuje analitykę i reklamy", () => {
  const flags = defaultConsent();
  assert.equal(flags.analytics_storage, "denied");
  assert.equal(flags.ad_storage, "denied");
  assert.equal(flags.ad_user_data, "denied");
  assert.equal(flags.ad_personalization, "denied");
  const granted = consentFromChoice("granted");
  assert.equal(granted.analytics_storage, "granted");
  assert.equal(granted.ad_storage, "denied");
  assert.equal(readStoredConsent({ getItem: () => null }), "unknown");
  assert.equal(readStoredConsent({ getItem: () => "granted" }), "granted");
});

test("odsłona strony nie dubluje się w tej samej sekundzie", () => {
  const state = { key: "", at: 0 };
  assert.equal(pageViewKey("/zielnik/pokrzywa", ""), "/zielnik/pokrzywa");
  assert.equal(pageViewKey("/kontakt", "?wyslane=1"), "/kontakt?wyslane=1");
  assert.equal(pageViewKey("/kontakt", "?email=a@b.c"), "/kontakt");
  assert.equal(claimPageView("/zielnik/pokrzywa", 1000, state), true);
  assert.equal(claimPageView("/zielnik/pokrzywa", 1500, state), false);
  assert.equal(claimPageView("/konsultacje", 1600, state), true);
  assert.equal(claimPageView("/zielnik/pokrzywa", 3000, state), true);
});

test("zdarzenia nie zabierają treści wiadomości ani adresu", () => {
  assert.equal(eventFromClick("/konsultacje"), "consultation_click");
  assert.equal(eventFromClick("https://zielarka.pl/warsztaty"), "workshop_click");
  assert.equal(eventFromClick("/klub"), "club_click");
  assert.equal(eventFromClick("tel:+48111222333"), "phone_click");
  assert.equal(eventFromClick("mailto:kontakt@zielarka.pl"), "email_click");
  assert.equal(eventFromClick("/zielnik/pokrzywa"), null);
  const clean = sanitizeEvent("email_click", {
    page_path: "/kontakt?z=1",
    link_url: "mailto:kontakt@zielarka.pl",
    message: "boli mnie gardło",
    email: "a@b.c",
  });
  assert.deepEqual(clean, { name: "email_click", params: { page_path: "/kontakt", link_kind: "mailto" } });
  assert.equal(JSON.stringify(clean).includes("gardło"), false);
  assert.equal(JSON.stringify(clean).includes("kontakt@"), false);
  assert.equal(sanitizeEvent("purchase", {}), null);
  assert.equal(formSuccessPath("/kontakt", "?wyslane=1"), false);
  assert.equal(formSuccessPath("/kontakt", ""), false);
  const seen = new Set<string>();
  assert.equal(shouldCountDelivery(false, "a".repeat(24), seen), false);
  assert.equal(shouldCountDelivery(true, "", seen), false);
  const receipt = issueFormReceipt("sekret-testowy", 1_700_000_000_000);
  assert.equal(receipt.includes("@"), false);
  assert.equal(receipt.includes("gardło"), false);
  assert.equal(receiptValid(receipt, "sekret-testowy", 1_700_000_000_000), true);
  assert.equal(receiptValid(receipt, "sekret-testowy", 1_700_000_000_000 + 11 * 60_000), false);
  assert.equal(receiptValid(`${receipt}x`, "sekret-testowy", 1_700_000_000_000), false);
  assert.equal(shouldCountDelivery(true, receipt, seen), true);
  assert.equal(shouldCountDelivery(true, receipt, seen), false);
  const both = sanitizeEvent("workshop_click", {
    page_path: "/warsztaty",
    link_url: "/warsztaty?z=1#sekret",
  });
  assert.equal(both?.params.link_url, "/warsztaty");
  assert.equal(JSON.stringify(both).includes("sekret"), false);
  assert.equal(JSON.stringify(both).includes("z=1"), false);
  const queryOnly = sanitizeEvent("consultation_click", { link_url: "/konsultacje?email=a@b.c" });
  assert.equal(queryOnly?.params.link_url, "/konsultacje");
  assert.equal(JSON.stringify(queryOnly).includes("a@b.c"), false);
  const hashOnly = sanitizeEvent("consultation_click", { link_url: "/konsultacje#fragment-tajny" });
  assert.equal(hashOnly?.params.link_url, "/konsultacje");
  assert.equal(JSON.stringify(hashOnly).includes("fragment-tajny"), false);
  const start = sanitizeEvent("form_start", { page_path: "/kontakt", message: "boli mnie gardło", email: "a@b.c" });
  assert.equal(JSON.stringify(start).includes("gardło"), false);
  assert.equal(start?.name, "form_start");
});

test("parser GA4 nie wymyśla brakujących metryk", () => {
  assert.equal(parseTotals(null), null);
  assert.equal(parseTotals({ metricHeaders: [{ name: "activeUsers" }], rows: [] }), null);
  const report: GaRunReport = {
    metricHeaders: [{ name: "activeUsers" }, { name: "userEngagementDuration" }, { name: "sessions" }],
    totals: [{ metricValues: [{ value: "4" }, { value: "120" }, { value: "6" }] }],
  };
  const totals = parseTotals(report);
  assert.equal(totals?.users, 4);
  assert.equal(totals?.engagementSeconds, 30);
  assert.equal(totals?.views, null);
  assert.equal(totals?.bounceRate, null);
  assert.equal(averageEngagementSeconds(120, 0), null);
  assert.equal(organicShare(null, 10), null);
  assert.equal(organicShare(0, 0), null);
  assert.equal(organicShare(100, 40), 0.4);
  const series = parseSeries({
    dimensionHeaders: [{ name: "date" }],
    metricHeaders: [{ name: "activeUsers" }, { name: "sessions" }, { name: "screenPageViews" }],
    rows: [{ dimensionValues: [{ value: "20261025" }], metricValues: [{ value: "2" }, { value: "" }, { value: "5" }] }],
  });
  assert.equal(series[0]?.date, "2026-10-25");
  assert.equal(series[0]?.users, 2);
  assert.equal(series[0]?.sessions, null);
  assert.equal(parseRealtime({ metricHeaders: [{ name: "activeUsers" }], rows: [] }), null);
  assert.equal(parseRealtime({ metricHeaders: [{ name: "activeUsers" }], rows: [{ metricValues: [{ value: "3" }] }] }), 3);
});

test("brak frazy w Search Console nie jest zerem", () => {
  assert.equal(parseGscTotals({}), null);
  assert.equal(parseGscTotals({ rows: [] }), null);
  const movement = queryMovement(
    [
      { key: "pokrzywa", clicks: 8, impressions: 40, ctr: 0.2, position: 4 },
      { key: "nowa", clicks: 2, impressions: 10, ctr: 0.2, position: 9 },
    ],
    [{ key: "pokrzywa", clicks: 5, impressions: 30, ctr: 0.16, position: 6 }],
  );
  assert.equal(movement.rising[0]?.key, "pokrzywa");
  assert.equal(movement.rising[0]?.clicksDelta, 3);
  const fresh = movement.rows.find((row) => row.key === "nowa");
  assert.equal(fresh?.clicksDelta, null);
  assert.match(fresh?.note ?? "", /nie jest zero/);
  assert.match(GSC_PRIVACY_NOTE, /nie oznacza zera/);
  const events = decorateEvents([]);
  assert.equal(events.every((event) => event.seen === false && event.count === null), true);
  const seen = decorateEvents([{ name: "form_success", channel: "Organic Search", count: 0 }]);
  assert.equal(seen.find((event) => event.name === "form_success")?.count, 0);
  assert.equal(seen.find((event) => event.name === "phone_click")?.seen, false);
});

test("niepełny zakres dat jest odrzucany", () => {
  const now = new Date("2026-10-25T12:00:00Z");
  assert.equal(resolveRange("custom", { start: "2026-10-01" }, now), null);
  assert.equal(resolveRange("custom", { start: "2026-01-01", end: "2028-01-01" }, now), null);
  assert.deepEqual(resolveRange("custom", { start: "2026-10-01", end: "2026-10-25" }, now), {
    start: "2026-10-01",
    end: "2026-10-25",
    label: "2026-10-01 – 2026-10-25",
    partial: true,
  });
  assert.equal(resolveRange("today", undefined, now)?.partial, true);
});

test("cache raportu wygasa po kwadransie", () => {
  assert.equal(cacheHit({ at: 0, value: 7 }, 14 * 60 * 1000, 15 * 60 * 1000), 7);
  assert.equal(cacheHit({ at: 0, value: 7 }, 15 * 60 * 1000, 15 * 60 * 1000), undefined);
  const empty = blankReport("overview");
  assert.equal(empty.title, "Nie skonfigurowano");
  assert.equal(empty.totals, null);
  assert.equal(empty.series, null);
  assert.equal(empty.realtime, null);
  assert.equal(formatCount(null), "—");
  assert.equal(JSON.stringify(empty).includes("1234"), false);
});

test("bez zmiennych serwer nie woła Google i nie zwraca liczb", async () => {
  let called = false;
  const report = await loadStats(
    { section: "overview", range: "7" },
    {
      env: {},
      now: new Date("2026-10-25T12:00:00Z"),
      memory: { token: null, reports: new Map() },
      fetch: async () => {
        called = true;
        return new Response("{}", { status: 500 });
      },
    },
  );
  assert.equal(called, false);
  assert.equal(report.configured, false);
  assert.equal(report.title, "Nie skonfigurowano");
  assert.equal(report.totals, null);
  assert.equal(report.realtime, null);
  assert.match(report.steps.join("\n"), /GA4_PROPERTY_ID/);
  assert.match(report.steps.join("\n"), /GA4_PRIVATE_KEY/);
  assert.equal(JSON.stringify(report).match(/"users":\s*\d+/), null);
});

test("klucz z \\n w zmiennej jest sklejany, a JWT da się sprawdzić", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const escaped = pem.replace(/\n/g, "\\n");
  const env = readAnalyticsEnv({
    GA4_PROPERTY_ID: "123456",
    GA4_CLIENT_EMAIL: "analityka@zielarka.iam.gserviceaccount.com",
    GA4_PRIVATE_KEY: escaped,
    GSC_SITE_URL: "",
    VITE_GA_MEASUREMENT_ID: "nie-id",
  });
  assert.equal(env.gaOk, true);
  assert.equal(env.gscOk, false);
  assert.equal(env.privateKey.includes("\\n"), false);
  const token = signServiceJwt(env.clientEmail, env.privateKey, 1_700_000_000, "https://www.googleapis.com/auth/analytics.readonly");
  const [header, payload, signature] = token.split(".");
  const verify = createVerify("RSA-SHA256");
  verify.update(`${header}.${payload}`);
  verify.end();
  assert.equal(verify.verify(publicKey, Buffer.from(signature ?? "", "base64url")), true);
  const claim = JSON.parse(Buffer.from(payload ?? "", "base64url").toString()) as { iss: string; aud: string };
  assert.equal(claim.iss, env.clientEmail);
  assert.equal(claim.aud, "https://oauth2.googleapis.com/token");
});

test("skonfigurowane API oddaje liczby z odpowiedzi, a czas rzeczywisty jest obok", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const urls: string[] = [];
  const metrics = [
    "activeUsers",
    "newUsers",
    "sessions",
    "screenPageViews",
    "engagedSessions",
    "userEngagementDuration",
    "engagementRate",
    "bounceRate",
  ];
  const report = await loadStats(
    { section: "overview", range: "7" },
    {
      now: new Date("2026-10-25T12:00:00Z"),
      memory: { token: null, reports: new Map() },
      env: {
        GA4_PROPERTY_ID: "123456",
        GA4_CLIENT_EMAIL: "analityka@zielarka.iam.gserviceaccount.com",
        GA4_PRIVATE_KEY: pem,
        GSC_SITE_URL: "https://zielarka.pl/",
        VITE_GA_MEASUREMENT_ID: "G-TESTOWA1",
      },
      fetch: async (url, init) => {
        urls.push(String(url));
        if (String(url).includes("oauth2.googleapis.com")) {
          return Response.json({ access_token: "ya29.test", expires_in: 3600 });
        }
        if (String(url).includes("runRealtimeReport")) {
          return Response.json({
            metricHeaders: [{ name: "activeUsers" }],
            rows: [{ metricValues: [{ value: "3" }] }],
          });
        }
        const body = JSON.parse(String(init?.body ?? "{}")) as { dimensions?: { name: string }[] };
        if (body.dimensions?.some((item) => item.name === "date")) {
          return Response.json({
            dimensionHeaders: [{ name: "date" }],
            metricHeaders: metrics.map((name) => ({ name })),
            rows: [
              {
                dimensionValues: [{ value: "20261025" }],
                metricValues: metrics.map((name) => ({ value: name === "activeUsers" ? "10" : name === "sessions" ? "12" : "1" })),
              },
            ],
            totals: [{ metricValues: metrics.map((name) => ({ value: name === "activeUsers" ? "10" : name === "userEngagementDuration" ? "300" : "4" })) }],
          });
        }
        return Response.json({
          metricHeaders: metrics.map((name) => ({ name })),
          totals: [{ metricValues: metrics.map(() => ({ value: "4" })) }],
        });
      },
    },
  );
  assert.equal(report.configured, true);
  assert.equal(report.title, "");
  assert.equal(report.totals?.users, 10);
  assert.equal(report.totals?.engagementSeconds, 30);
  assert.equal(report.series?.[0]?.users, 10);
  assert.equal(report.realtime?.activeUsers, 3);
  assert.equal(urls.some((url) => url.includes("searchconsole")), false);
  assert.equal(urls.some((url) => url.includes("runRealtimeReport")), true);
});

test("Search Console bez adresu witryny nie pokazuje kliknięć", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  let called = false;
  const report = await loadStats(
    { section: "seo", range: "30" },
    {
      now: new Date("2026-10-25T12:00:00Z"),
      memory: { token: null, reports: new Map() },
      env: {
        GA4_PROPERTY_ID: "123456",
        GA4_CLIENT_EMAIL: "analityka@zielarka.iam.gserviceaccount.com",
        GA4_PRIVATE_KEY: pem,
      },
      fetch: async () => {
        called = true;
        return Response.json({});
      },
    },
  );
  assert.equal(called, false);
  assert.equal(report.configured, false);
  assert.equal(report.gaConfigured, true);
  assert.equal(report.gscConfigured, false);
  assert.equal(report.title, "Nie skonfigurowano");
  assert.equal(report.seo, null);
  assert.match(report.steps.join("\n"), /GSC_SITE_URL/);
});

test("raport GSC działa bez GA4 i obsługuje usługę domenową", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const calls: string[] = [];
  const result = await loadStats({ section: "seo", range: "7" }, {
    env: { GA4_CLIENT_EMAIL: "test@example.invalid", GA4_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), GSC_SITE_URL: "sc-domain:zielarka.pl" },
    memory: { token: null, reports: new Map() },
    now: new Date("2026-10-31T01:00:00Z"),
    fetch: async (url) => {
      calls.push(url);
      return Response.json(url.includes("oauth2") ? { access_token: "test", expires_in: 3600 } : { rows: [{ clicks: 2, impressions: 10, ctr: 0.2, position: 3 }] });
    },
  });
  assert.equal(result.configured, true);
  assert.equal(result.gaConfigured, false);
  assert.equal(result.gscConfigured, true);
  assert.equal(result.end, "2026-10-30");
  assert.equal(result.seo?.clicks, 2);
  assert.equal(calls.some(url => url.includes("sc-domain%3Azielarka.pl")), true);
  assert.equal(calls.some(url => url.includes("analyticsdata")), false);
});

test("daty: nieistniejący dzień, przyszłość, oznaczenie bieżącego dnia", () => {
  const now = new Date("2026-10-31T12:00:00Z");
  assert.equal(resolveRange("custom", { start: "2026-02-30", end: "2026-03-10" }, now), null);
  assert.equal(resolveRange("custom", { start: "2026-10-01", end: "2026-11-01" }, now), null);
  for (const range of ["7", "30", "90"] as const) assert.equal(resolveRange(range, undefined, now)?.partial, true);
});

test("błąd pamięci zgody nie włącza pomiaru", () => {
  assert.equal(readStoredConsent({ getItem() { throw new Error("blocked"); } }), "unknown");
});

test("serie są sortowane, a roczne zapytania nie obcinają dni", async () => {
  const { gaBody } = await import("./analytics.ts");
  const body = gaBody({ start: "2025-10-31", end: "2026-10-31", dimensions: ["date"], limit: 367 });
  assert.deepEqual(body.orderBys, [{ dimension: { dimensionName: "date" }, desc: false }]);
  const series = parseSeries({ dimensionHeaders: [{ name: "date" }], metricHeaders: [{ name: "activeUsers" }], rows: ["20261031", "20261001"].map(value => ({ dimensionValues: [{ value }], metricValues: [{ value: "1" }] })) });
  assert.deepEqual(series.map(row => row.date), ["2026-10-01", "2026-10-31"]);
});

test("błędy Google nie ujawniają surowej odpowiedzi ani nie udają danych", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  for (const status of [401, 403, 429, 500]) {
    const report = await loadStats({ section: "overview", range: "7" }, {
      env: { GA4_PROPERTY_ID: "123", GA4_CLIENT_EMAIL: "test@example.invalid", GA4_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString() },
      memory: { token: null, reports: new Map() },
      fetch: async () => new Response("PRIVATE-UPSTREAM-PAYLOAD", { status }),
    });
    assert.ok(report.error);
    assert.equal(report.totals, null);
    assert.equal(JSON.stringify(report).includes("PRIVATE-UPSTREAM-PAYLOAD"), false);
  }
});

test("sesja statystyk omija Blob tylko po uwierzytelnieniu, wygasa i jest związana z klientem", async () => {
  const { authorizeStats, statsSessionKey } = await import("./stats-session.server.ts");
  const good = "a".repeat(32);
  const password = "haslo-edytora-testowe";
  let calls = 0;
  const gate = async (given: string) => {
    calls++;
    return { ok: given === password, message: "denied" };
  };
  const now = 1_800_000_000_000;
  const depsFor = (session: string | undefined, editorPassword: string) => ({
    secret: statsSessionKey(session, editorPassword),
    now,
    gate,
  });
  assert.equal(statsSessionKey(undefined, password), "");
  assert.equal(statsSessionKey("", password), "");
  assert.equal(statsSessionKey(" ".repeat(32), password), "");
  assert.equal(statsSessionKey("\t".repeat(32), password), "");
  assert.equal(statsSessionKey("  krotki  ", password), "");
  assert.equal(statsSessionKey(`  ${good}  `, password), `${good}\0${password}`);
  for (const session of [undefined, "", " ".repeat(32), "\t".repeat(32), "  krotki  "] as const) {
    const before = calls;
    const weak = await authorizeStats(password, "", "client-a", depsFor(session, password));
    assert.equal(weak.ok, true);
    assert.equal(weak.token, "");
    assert.equal(calls, before + 1);
  }
  const rawSpaces = await authorizeStats(password, "", "client-a", {
    secret: `${" ".repeat(32)}\0${password}`,
    now,
    gate,
  });
  assert.equal(rawSpaces.ok, true);
  assert.equal(rawSpaces.token, "");
  const denied = await authorizeStats("wrong", "", "client-a", depsFor(good, password));
  assert.equal(denied.ok, false);
  const login = await authorizeStats(password, "", "client-a", depsFor(good, password));
  assert.equal(login.ok, true);
  assert.equal(login.token.includes(password), false);
  assert.equal(login.token.includes(good), false);
  const atLogin = calls;
  assert.equal((await authorizeStats("", login.token, "client-a", depsFor(good, password))).ok, true);
  assert.equal(calls, atLogin);
  for (const [token, client, options] of [
    [login.token + "x", "client-a", depsFor(good, password)],
    [login.token + ".", "client-a", depsFor(good, password)],
    [login.token, "client-b", depsFor(good, password)],
    [login.token, "client-a", { ...depsFor(good, password), now: now + 300_001 }],
    [login.token, "client-a", depsFor("b".repeat(32), password)],
    [login.token, "client-a", depsFor(good, "inne-haslo")],
  ] as const) assert.equal((await authorizeStats("wrong", token, client, options)).ok, false);
  assert.equal(calls, atLogin + 6);
});

test("pomiar publiczny wymaga zatwierdzenia i właściwej domeny, a Preview jest wyłączone", async () => {
  const { publicMeasurementEnabled } = await import("./analytics.ts");
  const config = { id: "G-TEST123", enabled: "true", manualEventsConfirmed: "true", policyReady: true, origin: "https://zielarka.pl", path: "/kontakt" };
  assert.equal(publicMeasurementEnabled(config), true);
  for (const override of [{ policyReady: false }, { enabled: "false" }, { manualEventsConfirmed: undefined }, { origin: "https://zielarka-preview.vercel.app" }, { origin: "http://localhost:8080" }, { path: "/edytuj" }, { path: "/edytuj/sekret" }, { id: "bad" }]) {
    assert.equal(publicMeasurementEnabled({ ...config, ...override }), false);
  }
});

test("roczny raport pobiera wszystkie 367 dni zamiast limitu 100", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const report = await loadStats({ section: "overview", range: "custom", start: "2025-10-30", end: "2026-10-31" }, {
    env: { GA4_PROPERTY_ID: "123", GA4_CLIENT_EMAIL: "test@example.invalid", GA4_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString() },
    now: new Date("2026-10-31T12:00:00Z"), memory: { token: null, reports: new Map() },
    fetch: async (url, init) => {
      if (url.includes("oauth2")) return Response.json({ access_token: "test", expires_in: 3600 });
      const body = JSON.parse(String(init?.body));
      if (body.dimensions?.some((dim: { name: string }) => dim.name === "date")) {
        assert.deepEqual(body.orderBys, [{ dimension: { dimensionName: "date" }, desc: false }]);
        const rows = Array.from({ length: Math.min(367, Number(body.limit)) }, (_, i) => {
          const date = new Date(Date.UTC(2025, 9, 30 + i)).toISOString().slice(0, 10).replaceAll("-", "");
          return { dimensionValues: [{ value: date }], metricValues: [{ value: "1" }] };
        });
        return Response.json({ dimensionHeaders: [{ name: "date" }], metricHeaders: [{ name: "activeUsers" }], rows });
      }
      return Response.json({ metricHeaders: [{ name: "activeUsers" }], rows: [{ metricValues: [{ value: "1" }] }] });
    },
  });
  assert.equal(report.series?.length, 367);
  assert.equal(report.series?.at(-1)?.date, "2026-10-31");
});
