import assert from "node:assert/strict";
import test from "node:test";
import { assertRevision, attemptBlocked, canonicalEdits, classifyLegacy, createAttemptLimiter, draftImageUrls, herbOutageAction, lockDecision, memWrite, migrationAllowed, nextAttempt, publicFallback, restoreAllowed, toPublicDoc, urlsToPrune, urlsToRetain } from "./cms-guard.ts";
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
  assert.equal(migrationAllowed(false), false);
  assert.equal(migrationAllowed(true), true);
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
