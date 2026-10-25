import assert from "node:assert/strict";
import test from "node:test";
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
