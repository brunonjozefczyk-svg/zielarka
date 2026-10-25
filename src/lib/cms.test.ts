import assert from "node:assert/strict";
import test from "node:test";
import { assertRevision, createAttemptLimiter, toPublicDoc, urlsToPrune } from "./cms-guard.ts";
import { normalizeEntry, plainText, slugify, uniqueSlug } from "./entries.ts";
import { sitemapXml } from "./sitemap.ts";

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
