import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { listAllBlobs, newestRevisionPath, parseBlobListPage, urlsIfComplete } from "./blob-pages.ts";
import { assertRevision, attemptBlocked, canonicalEdits, chooseFreshRead, classifyLegacy, createAttemptLimiter, draftImageUrls, expiredInboxUrls, herbOutageAction, lockDecision, memWrite, migrationAllowed, migrationPlan, newestCommittedRevision, nextAttempt, publicFallback, publicJournalFailure, readFailureAction, restoreAllowed, sameRevisionOrUnreadable, selectPublicRevision, STORE_OUTAGE, throwIfUncertain, toPublicDoc, trustPublicPointer, urlsToPrune, urlsToRetain, writeAfterReread } from "./cms-guard.ts";
import { openJson, payloadSha, resealJson, sealJson, sealWithEditorPassword } from "./draft-seal.server.ts";
import { normalizeEntry, plainText, slugify, uniqueSlug } from "./entries.ts";
import { sitemapXml } from "./sitemap.ts";
import { sanitizeStyle, sanitizeTheme, textInline, themeAttrs, themeVars } from "./theme.ts";

test("slugify zdejmuje polskie znaki", () => {
  assert.equal(slugify("Mięta pieprzowa!"), "mieta-pieprzowa");
});

test("plainText usuwa znaczniki", () => {
  assert.equal(plainText("<b>mięta</b><script>alert(1)</script>", 80), "miętaalert(1)");
});

test("jawny zajęty adres nie jest po cichu podmieniany", () => {
  assert.equal(uniqueSlug("Mięta", new Set(["mieta"]), "mieta"), "");
  assert.equal(uniqueSlug("Mięta", new Set(["mieta"])), "mieta-2");
});

test("adres z kodu jest zablokowany, HTML znika z tekstu", () => {
  assert.equal(normalizeEntry({ name: "Inna", slug: "pokrzywa" }, new Set()), null);
  const entry = normalizeEntry(
    { name: "Mięta", lead: "<i>liść</i>", status: "published" },
    new Set(["pokrzywa"]),
  );
  assert.ok(entry);
  assert.equal(entry?.slug, "mieta");
  assert.equal(entry?.lead, "liść");
  assert.equal(entry?.status, "published");
});

test("mapa strony ma opublikowane karty i nie ma panelu", () => {
  const xml = sitemapXml({
    herbs: ["pokrzywa"],
    entries: [{ slug: "mieta", updatedAt: "2026-10-25T12:00:00.000Z" }],
  });
  assert.match(xml, /zielnik\/pokrzywa/);
  assert.match(xml, /zielnik\/mieta/);
  assert.match(xml, /<lastmod>2026-10-25<\/lastmod>/);
  assert.doesNotMatch(xml, /edytuj/);
  const escaped = sitemapXml({ herbs: ["a&b"], entries: [] });
  assert.match(escaped, /a\u0026amp;b/);
  assert.doesNotMatch(escaped, /a\u0026b/);
});

test("publiczny zapis nie zawiera szkiców", () => {
  const doc = toPublicDoc({
    revision: 4,
    entries: [
      { status: "published", slug: "mieta" },
      { status: "draft", slug: "szkic" },
    ],
  });
  assert.deepEqual(
    doc.entries.map((entry) => entry.slug),
    ["mieta"],
  );
  assert.equal(doc.revision, 4);
});

test("przycinanie kopii nie rusza ostatniego zapisu", () => {
  const blobs = [
    { pathname: "zielarka/private/2.json", url: "https://x.blob.vercel-storage.com/2", uploadedAt: 2 },
    { pathname: "zielarka/private/1.json", url: "https://x.blob.vercel-storage.com/1", uploadedAt: 1 },
  ];
  assert.deepEqual(urlsToPrune(blobs, 1, "zielarka/private/2.json"), [
    "https://x.blob.vercel-storage.com/1",
  ]);
  assert.deepEqual(urlsToPrune(blobs, 8, "zielarka/private/2.json"), []);
  assert.deepEqual(urlsToPrune(blobs, 1, "zielarka/private/brak.json"), []);
});

test("zły numer wersji blokuje zapis", () => {
  assert.throws(() => assertRevision(3, 2), /Odśwież stronę/);
  assert.doesNotThrow(() => assertRevision(3, 3));
});

test("ósma zła próba logowania jest odrzucana", () => {
  const limiter = createAttemptLimiter(8, 1000);
  for (let i = 0; i < 7; i += 1) limiter.note("a", false, 0);
  assert.equal(limiter.blocked("a", 10), false);
  limiter.note("a", false, 10);
  assert.equal(limiter.blocked("a", 20), true);
  limiter.note("a", true, 20);
  assert.equal(limiter.blocked("a", 30), false);
});

test("trwały licznik nie blokuje po jednej literówce", () => {
  let row: { count: number; until: number } | null = null;
  for (let i = 0; i < 7; i += 1) {
    row = nextAttempt(row, false, 1_000);
    assert.equal(attemptBlocked(row, 1_000), false);
  }
  row = nextAttempt(row, false, 1_000);
  assert.equal(row.count, 8);
  assert.equal(attemptBlocked(row, 1_000), true);
  row = nextAttempt(row, true, 2_000);
  assert.equal(attemptBlocked(row, 2_000), false);
  row = nextAttempt(null, false, 5_000);
  assert.equal(row.count, 1);
  assert.equal(attemptBlocked(row, 5_000), false);
});

test("drugi zapis tej samej wersji nie nadpisuje", () => {
  assert.equal(lockDecision(200, "", null), "claimed");
  assert.equal(lockDecision(409, "exists", 1_000), "busy");
  assert.equal(lockDecision(412, "Precondition failed", 1_000), "busy");
  assert.equal(lockDecision(400, "The blob already exists", 1_000), "busy");
  assert.equal(lockDecision(400, "Bad pathname", 1_000), "fail");
  assert.equal(lockDecision(409, "exists", 90_000), "steal");
  assert.equal(lockDecision(500, "down", null), "fail");
});

test("awaria magazynu nie jest pustą bazą ani 404 karty z kodu", () => {
  assert.throws(() => publicFallback(null, new Error("Odczyt nie powiódł się (503).")), /503/);
  assert.deepEqual(publicFallback({ revision: 4 }, new Error("x")), { revision: 4 });
  assert.equal(herbOutageAction(true), "show-builtin");
  assert.equal(herbOutageAction(false), "unavailable");
});

test("szkic nie występuje w zaszyfrowanym pliku", () => {
  process.env.CMS_SEAL_KEY = Buffer.from("k".repeat(32)).toString("base64");
  const secret = "sekretny szkic mięty";
  const sealed = sealJson(JSON.stringify({ lead: secret, status: "draft" }));
  assert.equal(sealed.includes(secret), false);
  assert.equal(sealed.includes("mięty"), false);
  const opened = openJson(JSON.parse(sealed)) as { lead: string };
  assert.equal(opened.lead, secret);
  const plain = { lead: "publiczne" };
  assert.equal(openJson(plain), plain);
});

test("zmiana hasła nie zamyka dostępu do kopii", () => {
  process.env.CMS_SEAL_KEY = Buffer.from("n".repeat(32)).toString("base64");
  process.env.EDITOR_PASSWORD = "stare-haslo-sabiny";
  const legacy = sealWithEditorPassword(JSON.stringify({ lead: "szkic mięty" }), "stare-haslo-sabiny");
  process.env.EDITOR_PASSWORD = "nowe-haslo-sabiny";
  process.env.CMS_SEAL_LEGACY_PASSWORD = "stare-haslo-sabiny";
  const opened = openJson(JSON.parse(legacy)) as { lead: string };
  assert.equal(opened.lead, "szkic mięty");
  const fresh = resealJson(JSON.parse(legacy));
  delete process.env.CMS_SEAL_LEGACY_PASSWORD;
  delete process.env.EDITOR_PASSWORD;
  const again = openJson(JSON.parse(fresh)) as { lead: string };
  assert.equal(again.lead, "szkic mięty");
  assert.equal(fresh.includes("szkic"), false);
});

test("dwa równoczesne zapisy i przerwany zapis", () => {
  const mem = { lock: null as number | null, privateRev: 3, publicRev: 3, privateBody: "stare", publicBody: "stare-public" };
  const first = memWrite(mem, 3, "nowe-prywatne", "nowe-publiczne");
  assert.equal(first.ok, true);
  assert.equal(mem.publicBody, "nowe-publiczne");
  const second = memWrite(mem, 3, "cudze", "cudze-public");
  assert.equal(second.ok, false);
  if (!second.ok) assert.match(second.message, /Odśwież stronę/);
  assert.equal(mem.publicBody, "nowe-publiczne");
  const broken = memWrite(
    { lock: null, privateRev: 4, publicRev: 4, privateBody: "ok", publicBody: "ok" },
    4,
    "przerwane",
    "niepublikowane",
    "public-commit",
  );
  assert.equal(broken.ok, false);
  const retry = memWrite(
    { lock: null, privateRev: 4, publicRev: 4, privateBody: "ok", publicBody: "ok" },
    4,
    "ponowne",
    "ponowne-public",
  );
  assert.equal(retry.ok, true);
  const damaged = memWrite(
    { lock: null, privateRev: 9, publicRev: 9, privateBody: "zepsute", publicBody: "zepsute" },
    4,
    "od zera",
    "od zera public",
    undefined,
    true,
  );
  assert.equal(damaged.ok, true);
  const newer = memWrite(
    { lock: null, privateRev: 9, publicRev: 9, privateBody: "nowe", publicBody: "nowe" },
    4,
    "stare",
    "stare public",
  );
  assert.equal(newer.ok, false);
});

test("retencja nie kasuje jedynej ani najnowszej kopii", () => {
  const now = Date.parse("2026-10-25T00:00:00.000Z");
  const blobs = Array.from({ length: 40 }, (_, index) => ({
    pathname: `zielarka/backups/manual/${index}.json`,
    url: `https://x.blob.vercel-storage.com/${index}`,
    uploadedAt: now - index * 86_400_000,
    revision: 100 - index,
  }));
  const removed = urlsToRetain(blobs);
  assert.equal(removed.includes("https://x.blob.vercel-storage.com/0"), false);
  assert.equal(urlsToRetain([{ pathname: "a", url: "https://only", uploadedAt: now, revision: 1 }]).length, 0);
});

test("stary jawny szkic jest rozpoznany, a migracja czeka na kopię", () => {
  assert.equal(classifyLegacy("zielarka/private/1.json", { entries: [] }), "plaintext-private");
  assert.equal(classifyLegacy("zielarka/private/2.json", { sealed: 1 }), "sealed");
  assert.equal(classifyLegacy("zielarka/content.json", { entries: [{ status: "draft" }] }), "plaintext-private");
  assert.equal(classifyLegacy("zielarka/public/1.json", { entries: [] }), "public");
  assert.deepEqual(
    draftImageUrls({ entries: [{ status: "draft", image: "https://cdn.example/szkic.jpg" }, { status: "published", image: "https://cdn.example/ok.jpg" }] }),
    ["https://cdn.example/szkic.jpg"],
  );
  assert.equal(migrationAllowed(false, true), false);
  assert.equal(migrationAllowed(true, false), false);
  assert.equal(migrationAllowed(true, true), true);
  const plan = migrationPlan(
    [
      { pathname: "zielarka/content.json", json: { entries: [{ status: "draft", image: "https://cdn.example/szkic.jpg" }] } },
      { pathname: "zielarka/private/2.json", json: { sealed: 1 } },
    ],
    true,
    true,
  );
  assert.equal(plan.run, false);
  assert.equal(plan.ready, true);
  assert.equal(plan.steps.some((step) => step.action === "reseal-plaintext"), true);
  assert.equal(plan.steps.some((step) => step.action === "seal-draft-image"), true);
  assert.equal(migrationPlan([], false, true).run, false);
  assert.equal(migrationPlan([], true, false).ready, false);
  assert.equal(restoreAllowed("przywróć"), false);
  assert.equal(restoreAllowed("PRZYWRÓĆ"), true);
  const doc = {
    revision: 2,
    copy: {},
    images: { hero: "seal:https://hidden" },
    herbs: {},
    entries: [{ status: "published", image: "seal:https://hidden", slug: "x" }],
    theme: null,
    styles: {},
  };
  const pub = toPublicDoc(doc);
  assert.equal(pub.images.hero, undefined);
  assert.equal(pub.entries[0].image, "");
  assert.equal(payloadSha(canonicalEdits(doc)).length, 64);
});

test("zła czcionka odpada, a puste rozmiary nie zmieniają strony", () => {
  assert.equal(sanitizeTheme({ display: "comic", body: "figtree" }), null);
  assert.equal(sanitizeTheme({ display: "fraunces", body: "figtree" }), null);
  const theme = sanitizeTheme({
    display: "sans",
    body: "figtree",
    h1: 99,
    headingWeight: 800,
    bodySize: "",
  });
  assert.ok(theme);
  assert.equal(theme?.display, "sans");
  assert.equal(theme?.h1, 4.5);
  assert.equal(theme?.headingWeight, null);
  assert.equal(theme?.bodySize, null);
  assert.equal(themeAttrs(null)["data-theme"], undefined);
  assert.equal(themeAttrs(theme)["data-size-h1"], "");
  assert.equal(themeAttrs(theme)["data-size-h2"], undefined);
  assert.equal(themeVars(theme)?.["--zl-h1"], "4.5rem");
  assert.equal(themeVars(theme)?.["--zl-h2"], undefined);
  assert.equal(sanitizeStyle({ font: "papyrus", bold: true })?.bold, true);
  assert.equal(sanitizeStyle({ font: "papyrus" }), null);
  assert.equal(sanitizeStyle({ size: "xxl" }), null);
  const css = textInline(sanitizeStyle({ font: "serif", bold: true, italic: true }));
  assert.equal(css?.fontWeight, 700);
  assert.equal(css?.fontStyle, "italic");
  assert.equal(String(css?.fontFamily).includes("color"), false);
});

test("lista magazynu przechodzi strony 50, 100, 101, 500, 1000, 1001 i 1500", async () => {
  async function all(count: number, pageSize: number) {
    const items = Array.from({ length: count }, (_, index) => ({
      pathname: `zielarka/journal/private/${String(index + 1).padStart(8, "0")}.json`,
      url: `https://blob.example/${index + 1}`,
    }));
    const blobs = await listAllBlobs(async (cursor) => {
      const start = cursor ? Number(cursor) : 0;
      const next = start + pageSize;
      const hasMore = next < items.length;
      return { blobs: items.slice(start, next), hasMore, ...(hasMore ? { cursor: String(next) } : {}) };
    });
    assert.equal(blobs.length, count);
    assert.equal(newestRevisionPath(blobs), items[count - 1]?.pathname);
    if (count > pageSize) {
      assert.notEqual(newestRevisionPath(items.slice(0, pageSize)), items[count - 1]?.pathname);
    }
    return items;
  }
  for (const count of [50, 100, 101, 500, 1000, 1001, 1500]) await all(count, 100);
  await all(1000, 1000);
  await all(1001, 1000);
  assert.equal(parseBlobListPage({ blobs: [], hasMore: true }).ok, false);
  assert.equal(parseBlobListPage({ blobs: [], hasMore: false }).ok, true);
  await assert.rejects(
    listAllBlobs(async () => ({ blobs: [{ pathname: "a.json" }], hasMore: true, cursor: "same" })),
    /zapętliła/,
  );
  await assert.rejects(
    listAllBlobs(async (cursor) => {
      if (cursor) throw new Error("sieć");
      return { blobs: [{ pathname: "00000001.json" }], hasMore: true, cursor: "2" };
    }),
    /Nic nie zostało skasowane/,
  );
  assert.deepEqual(urlsIfComplete(false, ["https://zostaw.example/a"]), []);
  const kept = urlsToRetain([
    { pathname: "nowa", url: "https://zostaw.example/nowa", uploadedAt: 2, revision: 2 },
    { pathname: "stara", url: "https://zostaw.example/stara", uploadedAt: 1, revision: 1 },
  ]);
  assert.equal(urlsIfComplete(true, kept).includes("https://zostaw.example/nowa"), false);
  assert.equal(urlsIfComplete(false, kept).length, 0);
});

test("rotacja klucza k1 na k2 nie zamyka starej kopii", () => {
  const previousKey = process.env.CMS_SEAL_KEY;
  const previousKeys = process.env.CMS_SEAL_KEYS;
  const previousPassword = process.env.EDITOR_PASSWORD;
  const key1 = randomBytes(32).toString("base64");
  const key2 = randomBytes(32).toString("base64");
  try {
    process.env.CMS_SEAL_KEY = key1;
    delete process.env.CMS_SEAL_KEYS;
    const secretA = "dokument A zostaje";
    const sealedA = sealJson(JSON.stringify({ lead: secretA }));
    assert.equal(JSON.parse(sealedA).kid, "k1");
    assert.equal(sealedA.includes(secretA), false);
    process.env.CMS_SEAL_KEY = `k2:${key2}`;
    process.env.CMS_SEAL_KEYS = `k1:${key1}`;
    process.env.EDITOR_PASSWORD = "inne-haslo-edytora";
    const secretB = "dokument B jest nowy";
    const sealedB = sealJson(JSON.stringify({ lead: secretB }));
    assert.equal(JSON.parse(sealedB).kid, "k2");
    assert.equal((openJson(JSON.parse(sealedA)) as { lead: string }).lead, secretA);
    assert.equal((openJson(JSON.parse(sealedB)) as { lead: string }).lead, secretB);
    delete process.env.CMS_SEAL_KEYS;
    assert.throws(() => openJson(JSON.parse(sealedA)), /Brak klucza k1/);
    assert.equal((openJson(JSON.parse(sealedB)) as { lead: string }).lead, secretB);
    const key3 = randomBytes(32).toString("base64");
    process.env.CMS_SEAL_KEY = `k3:${key3}`;
    process.env.CMS_SEAL_KEYS = `k1:${key1},k2:${key2}`;
    const sealedC = sealJson(JSON.stringify({ lead: "dokument C" }));
    assert.equal(JSON.parse(sealedC).kid, "k3");
    assert.equal((openJson(JSON.parse(sealedA)) as { lead: string }).lead, secretA);
    assert.equal((openJson(JSON.parse(sealedB)) as { lead: string }).lead, secretB);
    assert.equal((openJson(JSON.parse(sealedC)) as { lead: string }).lead, "dokument C");
    delete process.env.CMS_SEAL_KEYS;
    assert.throws(() => openJson(JSON.parse(sealedA)), /Brak klucza k1/);
    assert.throws(() => openJson(JSON.parse(sealedB)), /Brak klucza k2/);
    assert.equal((openJson(JSON.parse(sealedC)) as { lead: string }).lead, "dokument C");
    process.env.CMS_SEAL_KEY = key2;
    process.env.CMS_SEAL_KEYS = `k1:${key1}`;
    assert.throws(() => sealJson("{}"), /dwa różne klucze/);
    assert.throws(() => openJson(JSON.parse(sealedB)), /dwa różne klucze/);
  } finally {
    if (previousKey === undefined) delete process.env.CMS_SEAL_KEY;
    else process.env.CMS_SEAL_KEY = previousKey;
    if (previousKeys === undefined) delete process.env.CMS_SEAL_KEYS;
    else process.env.CMS_SEAL_KEYS = previousKeys;
    if (previousPassword === undefined) delete process.env.EDITOR_PASSWORD;
    else process.env.EDITOR_PASSWORD = previousPassword;
  }
});

test("wskaźnik publiczny, konflikt zapisu i stare wgrywanie", () => {
  assert.equal(trustPublicPointer(10, [10]), true);
  assert.equal(trustPublicPointer(10, [10, 11]), false);
  assert.equal(trustPublicPointer(10, [10, 12]), false);
  assert.equal(trustPublicPointer(12, [10, 12]), true);
  assert.equal(trustPublicPointer(10, null), false);
  assert.equal(trustPublicPointer(10, []), false);
  assert.equal(trustPublicPointer(1.5, [1]), false);
  assert.equal(selectPublicRevision(null), null);
  assert.equal(selectPublicRevision([10, 12]), 12);
  assert.equal(selectPublicRevision([12, 10]), 12);
  assert.equal(newestCommittedRevision([10, 12, 11]), 12);
  assert.equal(publicJournalFailure(true, new Error("Odczyt treści nie powiódł się (404).")), "stop");
  assert.equal(publicJournalFailure(false, new Error("Odczyt treści nie powiódł się (404).")), "try-older");
  assert.equal(publicJournalFailure(true, new Error("Odczyt treści nie powiódł się (503).")), "stop");
  assert.equal(publicJournalFailure(true, new TypeError("fetch failed")), "stop");
  assert.equal(publicJournalFailure(true, new Error("Kopia jest uszkodzona.")), "try-older");
  assert.equal(sameRevisionOrUnreadable(null, 3, true), "proceed");
  assert.equal(sameRevisionOrUnreadable(3, 3, false), "proceed");
  assert.equal(sameRevisionOrUnreadable(8, 3, false), "conflict");
  const now = Date.parse("2026-10-25T12:00:00.000Z");
  const active = "a".repeat(32);
  const old = "b".repeat(32);
  const fresh = "c".repeat(32);
  const urls = expiredInboxUrls(
    [
      { pathname: `zielarka/restore-inbox/${old}/manifest.json`, url: "https://blob.vercel-storage.com/old", uploadedAt: now - 49 * 60 * 60 * 1000 },
      { pathname: `zielarka/restore-inbox/${active}/manifest.json`, url: "https://blob.vercel-storage.com/active", uploadedAt: now - 72 * 60 * 60 * 1000 },
      { pathname: `zielarka/restore-inbox/${fresh}/1.json`, url: "https://blob.vercel-storage.com/fresh", uploadedAt: now - 60 * 1000 },
      { pathname: `zielarka/restore-inbox/${"d".repeat(32)}/x.json`, url: "https://blob.vercel-storage.com/nodate", uploadedAt: 0 },
      { pathname: "zielarka/backups/manual/1.json", url: "https://blob.vercel-storage.com/backup", uploadedAt: 1 },
    ],
    now,
    active,
  );
  assert.deepEqual(urls, ["https://blob.vercel-storage.com/old"]);
});

test("chwilowy błąd najnowszej wersji nie cofa zapisu do starszej", () => {
  assert.equal(readFailureAction(new Error("Odczyt treści nie powiódł się (503).")), "stop");
  assert.equal(readFailureAction(new Error("Odczyt nie powiódł się (500).")), "stop");
  assert.equal(readFailureAction(new TypeError("fetch failed")), "stop");
  assert.equal(readFailureAction(new Error("Nie da się odczytać kopii. Brak klucza k1. Dopisz go do CMS_SEAL_KEYS. Dane nie zostały skasowane.")), "stop");
  assert.equal(readFailureAction(new Error("Kopia jest uszkodzona.")), "try-older");
  assert.equal(readFailureAction(new SyntaxError("Unexpected token")), "try-older");
  const choice = chooseFreshRead([
    { ok: false as const, error: new Error("Odczyt treści nie powiódł się (503).") },
    { ok: true as const, value: { revision: 4, lead: "starsza" } },
  ]);
  assert.equal(choice.action, "stop");
  assert.equal(writeAfterReread(new Error(STORE_OUTAGE), null, 6), "stop");
  assert.equal(writeAfterReread(null, 5, 6), "conflict");
  assert.equal(writeAfterReread(null, 6, 6), "write");
  assert.equal(writeAfterReread(new Error("Aktywna treść jest uszkodzona."), null, 6), "write");
  const damagedHead = chooseFreshRead([
    { ok: false as const, error: new Error("Kopia jest uszkodzona.") },
    { ok: true as const, value: { revision: 4, lead: "ostatnia dobra" } },
  ]);
  assert.equal(damagedHead.action, "use");
  if (damagedHead.action === "use") assert.equal(damagedHead.value.revision, 4);
  assert.throws(() => throwIfUncertain(new Error("Odczyt treści nie powiódł się (503).")), /Nic nie zostało cofnięte/);
  assert.throws(
    () => throwIfUncertain(new Error("Nie da się odczytać kopii. Brak klucza k1. Dopisz go do CMS_SEAL_KEYS. Dane nie zostały skasowane.")),
    /Brak klucza k1/,
  );
  assert.doesNotThrow(() => throwIfUncertain(new Error("Kopia jest uszkodzona.")));
  const editorHad = 6;
  const duringOutage = chooseFreshRead([
    { ok: false as const, error: new Error("Odczyt treści nie powiódł się (503).") },
    { ok: true as const, value: { revision: 4 } },
  ]);
  assert.equal(duringOutage.action, "stop");
  assert.equal(writeAfterReread(new Error(STORE_OUTAGE), null, editorHad), "stop");
});
