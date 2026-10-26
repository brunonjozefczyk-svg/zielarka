/**
 * Prawdziwe funkcje site-store na magazynie w pamięci.
 * To nie jest Vercel Blob i nie jest magazyn Sabiny. Żądanie poza atrapę jest błędem.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import test from "node:test";
import { canonicalEdits } from "./cms-guard.ts";
import { openJson, payloadSha, sealJson } from "./draft-seal.server.ts";
import { herbs } from "./herbs.ts";
import { sitemapXml } from "./sitemap.ts";
import {
  beginRestoreUpload,
  createVerifiedBackup,
  deleteEntry,
  downloadBackupPart,
  editorGate,
  finishRestoreUpload,
  readEditorDoc,
  readPublicEdits,
  resetPublicCacheForTests,
  restorePrevious,
  saveCopy,
  saveEntry,
  saveRestorePart,
  saveTheme,
  diagnosePublicCutover,
  applyPublicCutover,
} from "./site-store.server.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const DRAFT_PNG = Buffer.from(PNG);
DRAFT_PNG[DRAFT_PNG.length - 1] ^= 0xff;

const TEST_TOKEN = "vercel_blob_rw_itest0001_notprodkey1";
const HOST = "https://itest.public.blob.vercel-storage.com/p/";
const PUBLIC_ORIGIN = "https://itest0001.public.blob.vercel-storage.com/";

type Row = { body: Buffer; uploadedAt: number };

function dataUrl(bytes: Buffer) {
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

test("izolowany CMS: edytor, kopia, utrata magazynu i koszt listy", async () => {
  const saved = {
    blob: process.env.BLOB_READ_WRITE_TOKEN,
    seal: process.env.CMS_SEAL_KEY,
    seals: process.env.CMS_SEAL_KEYS,
    legacy: process.env.CMS_SEAL_LEGACY_PASSWORD,
    password: process.env.EDITOR_PASSWORD,
    offsite: process.env.ZIELARKA_OFFSITE,
    approved: process.env.ZIELARKA_OFFSITE_APPROVED,
  };
  const files = new Map<string, Row>();
  const calls: string[] = [];
  let outage = false;
  let failList = 0;
  let clock = 1_700_000_000_000;
  const original = globalThis.fetch;

  function urlFor(pathname: string) {
    return `${HOST}${encodeURIComponent(pathname)}`;
  }

  function pathnameFromUrl(value: string) {
    if (value.startsWith(HOST)) return decodeURIComponent(value.slice(HOST.length));
    if (value.startsWith(PUBLIC_ORIGIN)) return decodeURIComponent(value.slice(PUBLIC_ORIGIN.length));
    return "";
  }

  globalThis.fetch = async (input, init) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method || "GET").toUpperCase();
    if (!raw.startsWith("https://vercel.com/api/blob") && !raw.startsWith(HOST) && !raw.startsWith(PUBLIC_ORIGIN)) {
      throw new Error(`Izolowany test odmówił sieci: ${raw}`);
    }
    const auth = new Headers(init?.headers).get("authorization") || "";
    if (raw.startsWith("https://vercel.com/api/blob") && auth !== `Bearer ${TEST_TOKEN}`) {
      return new Response("zły token", { status: 401 });
    }
    if (outage && method === "GET") {
      calls.push(`503 ${raw}`);
      return new Response("niedostępne", { status: 503 });
    }
    if (raw.startsWith(HOST) || raw.startsWith(PUBLIC_ORIGIN)) {
      calls.push(`GET ${pathnameFromUrl(raw)}`);
      const row = files.get(pathnameFromUrl(raw));
      if (!row) return new Response("brak", { status: 404 });
      return new Response(new Uint8Array(row.body), { status: 200 });
    }
    const url = new URL(raw);
    if (url.pathname === "/api/blob/delete") {
      const payload = JSON.parse(String(init?.body || "{}")) as { urls?: string[] };
      for (const item of payload.urls || []) {
        const path = pathnameFromUrl(item);
        if (path) files.delete(path);
      }
      calls.push("DELETE");
      return Response.json({ ok: true });
    }
    if (method === "PUT") {
      const pathname = url.searchParams.get("pathname") || "";
      if (!pathname.startsWith("zielarka/") || pathname.includes("..")) {
        return new Response("zła ścieżka", { status: 400 });
      }
      if (files.has(pathname) && (new Headers(init?.headers).get("x-allow-overwrite") || "1") === "0") {
        return new Response("The blob already exists", { status: 409 });
      }
      const body = Buffer.from(typeof init?.body === "string" ? init.body : (init?.body as Uint8Array));
      clock += 1;
      files.set(pathname, { body, uploadedAt: clock });
      calls.push(`PUT ${pathname}`);
      return Response.json({ url: urlFor(pathname), downloadUrl: urlFor(pathname) });
    }
    if (url.searchParams.get("url")) {
      const pathname = url.searchParams.get("url") || "";
      calls.push(`HEAD ${pathname}`);
      const row = files.get(pathname);
      if (!row) return new Response("brak", { status: 404 });
      return Response.json({
        pathname,
        url: urlFor(pathname),
        downloadUrl: urlFor(pathname),
        uploadedAt: row.uploadedAt,
      });
    }
    const prefix = url.searchParams.get("prefix") || "";
    if (failList) {
      calls.push(`LIST-FAIL ${failList} ${prefix}`);
      return new Response("limit", { status: failList });
    }
    const limit = Number(url.searchParams.get("limit") || "1000");
    const start = Number(url.searchParams.get("cursor") || "0");
    const matched = [...files.entries()]
      .filter(([pathname]) => pathname.startsWith(prefix))
      .map(([pathname, row]) => ({
        pathname,
        url: urlFor(pathname),
        downloadUrl: urlFor(pathname),
        uploadedAt: row.uploadedAt,
      }));
    const page = matched.slice(start, start + limit);
    const hasMore = start + limit < matched.length;
    calls.push(`LIST ${prefix} ${start}`);
    return Response.json({
      blobs: page,
      hasMore,
      ...(hasMore ? { cursor: String(start + limit) } : {}),
    });
  };

  const restoreEnv = () => {
    globalThis.fetch = original;
    resetPublicCacheForTests();
    const entries: [string, string | undefined][] = [
      ["BLOB_READ_WRITE_TOKEN", saved.blob],
      ["CMS_SEAL_KEY", saved.seal],
      ["CMS_SEAL_KEYS", saved.seals],
      ["CMS_SEAL_LEGACY_PASSWORD", saved.legacy],
      ["EDITOR_PASSWORD", saved.password],
      ["ZIELARKA_OFFSITE", saved.offsite],
      ["ZIELARKA_OFFSITE_APPROVED", saved.approved],
    ];
    for (const [key, value] of entries) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };

  try {
    const k1 = randomBytes(32).toString("base64");
    const k2 = randomBytes(32).toString("base64");
    process.env.BLOB_READ_WRITE_TOKEN = TEST_TOKEN;
    process.env.CMS_SEAL_KEY = k1;
    delete process.env.CMS_SEAL_KEYS;
    delete process.env.CMS_SEAL_LEGACY_PASSWORD;
    process.env.EDITOR_PASSWORD = "haslo-testu-izolowanego";
    process.env.ZIELARKA_OFFSITE = "https://example.r2.cloudflarestorage.com/kopie";
    process.env.ZIELARKA_OFFSITE_APPROVED = "tak";
    resetPublicCacheForTests();

    const badLogin = await editorGate("nie-to-haslo", "test");
    assert.equal(badLogin.ok, false);
    const goodLogin = await editorGate("haslo-testu-izolowanego", "test");
    assert.equal(goodLogin.ok, true);
    await assert.rejects(() => deleteEntry("pokrzywa", 0), /nie da się usunąć/i);

    const draftImage = dataUrl(DRAFT_PNG);
    const draftSaved = await saveEntry(
      { name: "Szkic tajny", slug: "szkic-tajny", lead: "ukryty opis", status: "draft", image: draftImage },
      undefined,
      0,
    );
    assert.equal(draftSaved.entry.status, "draft");
    resetPublicCacheForTests();
    const hidden = await readPublicEdits();
    assert.equal(hidden.entries.some((entry) => entry.slug === "szkic-tajny"), false);
    assert.equal(JSON.stringify(hidden).includes("Szkic tajny"), false);

    const publishedImage = dataUrl(PNG);
    const published = await saveEntry(
      {
        name: "Mięta testowa",
        slug: "mieta-testowa",
        lead: "liść testowy",
        status: "published",
        image: publishedImage,
      },
      undefined,
      draftSaved.revision,
    );
    resetPublicCacheForTests();
    const visible = await readPublicEdits();
    assert.equal(visible.entries.some((entry) => entry.slug === "mieta-testowa"), true);
    assert.equal(visible.entries.some((entry) => entry.slug === "szkic-tajny"), false);

    const pulled = await saveEntry(
      { name: "Mięta testowa", slug: "mieta-testowa", lead: "wycofane", status: "draft", image: "" },
      "mieta-testowa",
      published.revision,
    );
    resetPublicCacheForTests();
    const afterPull = await readPublicEdits();
    assert.equal(afterPull.entries.some((entry) => entry.slug === "mieta-testowa"), false);

    const again = await saveEntry(
      {
        name: "Mięta testowa",
        slug: "mieta-testowa",
        lead: "liść testowy",
        status: "published",
        image: publishedImage,
      },
      "mieta-testowa",
      pulled.revision,
    );
    let revision = await saveCopy("seo.title", "Mięta pieprzowa — test izolowany", again.revision);
    revision = await saveTheme({ display: "sans", body: "serif", h1: 3.2 }, revision);
    revision = await saveCopy("home.note", "pierwsza", revision);
    revision = await saveCopy("home.note", "druga", revision);
    const restoredPrev = await restorePrevious(revision);
    const editor = await readEditorDoc();
    assert.equal(editor.copy["home.note"], "pierwsza");
    assert.equal(editor.copy["seo.title"], "Mięta pieprzowa — test izolowany");
    assert.equal(editor.theme?.display, "sans");
    assert.equal(editor.theme?.h1, 3.2);
    assert.equal(editor.entries.find((entry) => entry.slug === "szkic-tajny")?.status, "draft");
    assert.equal(editor.entries.find((entry) => entry.slug === "mieta-testowa")?.status, "published");
    assert.equal(restoredPrev.revision, editor.revision);

    const backup = await createVerifiedBackup("manual");
    const parts = [];
    for (const part of backup.parts) parts.push(await downloadBackupPart(part.sha256, part.slice));
    assert.equal(backup.sealedManifest.includes("Szkic tajny"), false);
    assert.equal(backup.sealedManifest.includes("ukryty opis"), false);
    const beforeWipe = editor.revision;
    await saveCopy("home.note", "po-kopii", beforeWipe);
    const archiveManifest = backup.sealedManifest;
    const archiveParts = parts.map((part) => part.sealed);
    files.clear();
    resetPublicCacheForTests();
    assert.equal((await readPublicEdits()).revision, 0);

    process.env.CMS_SEAL_KEY = `k2:${k2}`;
    process.env.CMS_SEAL_KEYS = `k1:${k1}`;
    const begun = await beginRestoreUpload(archiveManifest);
    for (const sealed of archiveParts) await saveRestorePart(begun.session, sealed);
    const recovered = await finishRestoreUpload(begun.session, 0, "PRZYWRÓĆ");
    assert.equal(recovered.ok, true);
    resetPublicCacheForTests();
    const back = await readEditorDoc();
    assert.equal(back.copy["home.note"], "pierwsza");
    assert.equal(back.copy["seo.title"], "Mięta pieprzowa — test izolowany");
    assert.equal(back.theme?.display, "sans");
    assert.equal(back.entries.find((entry) => entry.slug === "szkic-tajny")?.status, "draft");
    assert.equal(back.entries.find((entry) => entry.slug === "mieta-testowa")?.status, "published");
    const draftBytes = Buffer.from(String(back.entries.find((entry) => entry.slug === "szkic-tajny")?.image || "").split(",")[1] || "", "base64");
    assert.equal(draftBytes.equals(DRAFT_PNG), true);
    const publicUrl = String(back.entries.find((entry) => entry.slug === "mieta-testowa")?.image || "");
    const publicBytes = Buffer.from(await (await fetch(publicUrl)).arrayBuffer());
    assert.equal(publicBytes.equals(PNG), true);
    resetPublicCacheForTests();
    const pub = await readPublicEdits();
    assert.equal(pub.entries.some((entry) => entry.slug === "szkic-tajny"), false);
    assert.equal(JSON.stringify(pub).includes("Szkic tajny"), false);
    assert.equal(JSON.stringify(pub).includes("ukryty opis"), false);

    const marker = JSON.stringify(back.copy);
    await assert.rejects(() => beginRestoreUpload("{"), /nieczytelny|uszkodzona/i);
    const opened = openJson(JSON.parse(archiveManifest)) as { docSha?: string };
    opened.docSha = "0".repeat(64);
    const corrupt = sealJson(JSON.stringify(opened));
    const bad = await beginRestoreUpload(corrupt);
    for (const sealed of archiveParts) await saveRestorePart(bad.session, sealed);
    await assert.rejects(() => finishRestoreUpload(bad.session, back.revision, "PRZYWRÓĆ"), /Nie zostało podmienione|uszkodzona|nie pasuje/i);
    const still = await readEditorDoc();
    assert.equal(JSON.stringify(still.copy), marker);

    delete process.env.CMS_SEAL_KEYS;
    assert.throws(() => openJson(JSON.parse(archiveManifest)), /Brak klucza k1/);
    const fresh = await createVerifiedBackup("manual");
    assert.equal((openJson(JSON.parse(fresh.sealedManifest)) as { sealKid?: string }).sealKid, "k2");

    const current = await readEditorDoc();
    const pair = await Promise.allSettled([
      saveCopy("home.note", "sesja-a", current.revision),
      saveCopy("home.note", "sesja-b", current.revision),
    ]);
    const oks = pair.filter((item) => item.status === "fulfilled");
    const fails = pair.filter((item) => item.status === "rejected");
    assert.equal(oks.length, 1);
    assert.equal(fails.length, 1);
    const sizeAfterRace = files.size;
    await assert.rejects(() => saveCopy("home.note", "stara", 1), /Odśwież stronę/);
    assert.equal(files.size, sizeAfterRace);

    outage = true;
    const live = await readEditorDoc().catch(() => current);
    await assert.rejects(() => saveCopy("home.note", "w trakcie awarii", live.revision), /chwilowo niedostępny|nie powiódł|zatrzymany/i);
    outage = false;
    resetPublicCacheForTests();
    const afterOutage = await readEditorDoc();
    assert.notEqual(afterOutage.copy["home.note"], "w trakcie awarii");

    const timings: { saves: number; listCalls: number; bodyCalls: number; ms: number }[] = [];
    for (const count of [100, 1000, 10000]) {
      files.clear();
      resetPublicCacheForTests();
      const doc = {
        revision: count,
        copy: {},
        images: {},
        herbs: {},
        entries: [],
        theme: null,
        styles: {},
      };
      const body = canonicalEdits(doc);
      const sha = payloadSha(body);
      const text = JSON.stringify({ ...JSON.parse(body), sha });
      const docPath = "zielarka/public/scale.json";
      files.set(docPath, { body: Buffer.from(text), uploadedAt: 1 });
      const docUrl = urlFor(docPath);
      for (let revision = 1; revision < count; revision += 1) {
        const path = `zielarka/journal/public/${String(revision).padStart(8, "0")}.json`;
        files.set(path, { body: Buffer.from("{}"), uploadedAt: revision });
      }
      const newest = `zielarka/journal/public/${String(count).padStart(8, "0")}.json`;
      files.set(newest, {
        body: Buffer.from(JSON.stringify({ revision: count, url: docUrl, sha })),
        uploadedAt: count + 1,
      });
      files.set("zielarka/journal/public/current.json", {
        body: Buffer.from(JSON.stringify({ revision: count, url: docUrl, sha, committed: true })),
        uploadedAt: count + 2,
      });
      files.set(`zielarka/journal/public/${String(count + 5).padStart(8, "0")}.json`, {
        body: Buffer.from(JSON.stringify({ revision: count + 5, url: docUrl, sha: "0".repeat(64) })),
        uploadedAt: count + 3,
      });
      const before = calls.length;
      const started = performance.now();
      resetPublicCacheForTests();
      const cold = await readPublicEdits();
      const ms = performance.now() - started;
      assert.equal(cold.revision, count);
      assert.notEqual(cold.revision, count + 5);
      const used = calls.slice(before);
      const listCalls = used.filter((item) => item.startsWith("LIST ")).length;
      const bodyCalls = used.filter((item) => item.startsWith("GET ")).length;
      assert.equal(listCalls, 0);
      assert.equal(bodyCalls, 2);
      const warmBefore = calls.length;
      await readPublicEdits();
      assert.equal(calls.length, warmBefore);
      timings.push({ saves: count, listCalls, bodyCalls, ms: Math.round(ms * 10) / 10 });
    }
    files.clear();
    resetPublicCacheForTests();
    const legacyDoc = {
      revision: 2,
      copy: { "home.note": "stary-dziennik" },
      images: {},
      herbs: {},
      entries: [],
      theme: null,
      styles: {},
    };
    const legacyBody = canonicalEdits(legacyDoc);
    const legacySha = payloadSha(legacyBody);
    const legacyText = JSON.stringify({ ...JSON.parse(legacyBody), sha: legacySha });
    files.set("zielarka/public/legacy.json", { body: Buffer.from(legacyText), uploadedAt: 1 });
    const legacyUrl = urlFor("zielarka/public/legacy.json");
    files.set("zielarka/journal/public/00000002.json", {
      body: Buffer.from(JSON.stringify({ revision: 2, url: legacyUrl, sha: legacySha })),
      uploadedAt: 2,
    });
    const beforeLegacy = calls.length;
    const hiddenLegacy = await readPublicEdits();
    assert.equal(hiddenLegacy.revision, 0);
    assert.equal(calls.slice(beforeLegacy).some((item) => item.startsWith("LIST zielarka/journal/public")), false);
    const looked = await diagnosePublicCutover();
    assert.equal(looked.action, "ready");
    assert.equal(looked.revision, 2);
    assert.equal(files.has("zielarka/journal/public/current.json"), false);
    const paused = await applyPublicCutover(false);
    assert.equal(paused.action, "ready");
    assert.equal(files.has("zielarka/journal/public/current.json"), false);
    const promoted = await applyPublicCutover(true);
    assert.equal(promoted.action, "already");
    resetPublicCacheForTests();
    const legacyRead = await readPublicEdits();
    assert.equal(legacyRead.copy["home.note"], "stary-dziennik");
    assert.equal(legacyRead.revision, 2);
    const promotedBody = JSON.parse(files.get("zielarka/journal/public/current.json")?.body.toString("utf8") || "null") as {
      committed?: boolean;
    };
    assert.equal(promotedBody.committed, true);
    files.set("zielarka/journal/public/00000009.json", {
      body: Buffer.from(JSON.stringify({ revision: 9, url: legacyUrl, sha: "cd".repeat(32) })),
      uploadedAt: 9,
    });
    files.delete("zielarka/journal/public/current.json");
    files.set("zielarka/journal/commit/00000002.json", {
      body: Buffer.from(JSON.stringify({ revision: 2, sha: legacySha, publicSha: legacySha })),
      uploadedAt: 3,
    });
    resetPublicCacheForTests();
    const unsafe = await diagnosePublicCutover();
    assert.equal(unsafe.action, "stop");
    assert.equal(files.has("zielarka/journal/public/current.json"), false);
    const stillHidden = await readPublicEdits();
    assert.notEqual(stillHidden.revision, 9);
    assert.equal(stillHidden.revision, 2);

    files.clear();
    resetPublicCacheForTests();
    const imageBytes = Buffer.from(PNG);
    const privateImage = Buffer.from(DRAFT_PNG);
    files.set("zielarka/images/pokrzywa-polna.png", { body: imageBytes, uploadedAt: 10 });
    files.set("zielarka/images/szkic-polny.png", { body: privateImage, uploadedAt: 11 });
    const imageUrl = urlFor("zielarka/images/pokrzywa-polna.png");
    const draftUrl = urlFor("zielarka/images/szkic-polny.png");
    const publishedEntry = {
      slug: "pokrzywa-polna",
      status: "published",
      name: "Pokrzywa polna",
      latin: "Urtica urens",
      lead: "Liście na napar.",
      note: "Na herbatę.",
      season: "wiosna",
      part: "liść",
      habitat: "przydroża",
      recognize: "włoski parzące",
      harvest: "przed kwitnieniem",
      prepare: "suszyć w cieniu",
      tradition: "wiosna",
      caution: "nie w ciąży",
      seoTitle: "Pokrzywa polna | Zielarka.pl",
      seoDescription: "Jak rozpoznać pokrzywę polną.",
      alt: "Liść pokrzywy polnej",
      image: imageUrl,
      faqs: [{ q: "Kiedy zbierać?", a: "Wiosną, przed kwitnieniem." }],
      related: ["pokrzywa"],
      updatedAt: "2026-08-01T10:00:00.000Z",
      history: [{ at: "2026-07-01T10:00:00.000Z", name: "Pokrzywa polna", lead: "pierwsza notatka", status: "published" }],
    };
    const draftEntry = {
      ...publishedEntry,
      slug: "szkic-polny",
      status: "draft",
      name: "Szkic polny",
      lead: "ten opis ma zostać prywatny",
      seoTitle: "Szkic polny",
      seoDescription: "Nie indeksować.",
      image: draftUrl,
      updatedAt: "2026-08-02T10:00:00.000Z",
      history: [],
    };
    const older = {
      copy: { "home.note": "nie-laczyc" },
      images: {},
      herbs: {},
      entries: [{ ...publishedEntry, slug: "stara-karta", name: "Stara karta", status: "published" }],
    };
    const currentMain = {
      copy: { "home.note": "z-produkcji", "seo.title": "Zielarka z CMS" },
      images: { "img.home": imageUrl, "img.herb.szkic-polny": draftUrl, "img.herb.pokrzywa-polna": imageUrl },
      herbs: { pokrzywa: { lead: "opis pokrzywy z cms" } },
      entries: [publishedEntry, draftEntry],
    };
    files.set("zielarka/docs/1700000000000-aaaaaa.json", { body: Buffer.from(JSON.stringify(older)), uploadedAt: 20 });
    files.set("zielarka/docs/1700000001000-bbbbbb.json", { body: Buffer.from(JSON.stringify(currentMain)), uploadedAt: 30 });
    files.set("zielarka/content.json", {
      body: Buffer.from(JSON.stringify({ ...older, copy: { "home.note": "sam-content" } })),
      uploadedAt: 40,
    });
    const locs = (xml: string) => [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
    resetPublicCacheForTests();
    const beforeMove = await readPublicEdits();
    assert.equal(beforeMove.copy["home.note"], "z-produkcji");
    assert.equal(beforeMove.copy["seo.title"], "Zielarka z CMS");
    assert.equal(beforeMove.herbs.pokrzywa && (beforeMove.herbs.pokrzywa as { lead: string }).lead, "opis pokrzywy z cms");
    assert.equal(beforeMove.entries.some((entry) => entry.slug === "pokrzywa-polna"), true);
    assert.equal(beforeMove.entries.some((entry) => entry.slug === "stara-karta"), false);
    assert.equal(beforeMove.entries.some((entry) => entry.slug === "szkic-polny"), false);
    assert.equal(JSON.stringify(beforeMove).includes("ten opis ma zostać prywatny"), false);
    assert.equal(JSON.stringify(beforeMove).includes(draftUrl), false);
    const shown = beforeMove.entries.find((entry) => entry.slug === "pokrzywa-polna");
    assert.ok(shown);
    assert.equal(shown.seoTitle, "Pokrzywa polna | Zielarka.pl");
    assert.equal(shown.seoDescription, "Jak rozpoznać pokrzywę polną.");
    assert.equal(shown.history[0]?.lead, "pierwsza notatka");
    const seenBytes = Buffer.from(await (await fetch(shown.image)).arrayBuffer());
    assert.equal(createHash("sha256").update(seenBytes).digest("hex"), createHash("sha256").update(imageBytes).digest("hex"));
    const beforeXml = sitemapXml({
      herbs: herbs.map((herb) => herb.slug),
      entries: beforeMove.entries.map((entry) => ({ slug: entry.slug, updatedAt: entry.updatedAt })),
    });
    const beforeLocs = locs(beforeXml);
    assert.ok(beforeLocs.includes("https://zielarka.pl/zielnik/pokrzywa-polna"));
    assert.equal(beforeLocs.includes("https://zielarka.pl/zielnik/szkic-polny"), false);
    assert.ok(beforeLocs.length > 6);
    const firstLook = await diagnosePublicCutover();
    assert.equal(firstLook.action, "ready");
    assert.equal(firstLook.source, "main");
    const putsBefore = calls.filter((item) => item.startsWith("PUT")).length;
    const secondLook = await diagnosePublicCutover();
    assert.equal(secondLook.action, "ready");
    assert.equal(calls.filter((item) => item.startsWith("PUT")).length, putsBefore);
    assert.equal(files.has("zielarka/journal/public/current.json"), false);
    const pausedMain = await applyPublicCutover(false);
    assert.equal(pausedMain.action, "ready");
    assert.equal(files.has("zielarka/journal/public/current.json"), false);
    assert.equal(files.has("zielarka/docs/1700000001000-bbbbbb.json"), true);
    const promotedMain = await applyPublicCutover(true);
    assert.equal(promotedMain.action, "already");
    assert.equal(files.has("zielarka/docs/1700000001000-bbbbbb.json"), true);
    assert.equal(files.has("zielarka/content.json"), true);
    assert.equal(files.get("zielarka/images/pokrzywa-polna.png")?.body.equals(imageBytes), true);
    assert.equal(files.get("zielarka/images/szkic-polny.png")?.body.equals(privateImage), true);
    const oldRaw = files.get("zielarka/docs/1700000001000-bbbbbb.json")?.body.toString("utf8") || "";
    assert.equal(oldRaw.includes("Szkic polny"), true);
    resetPublicCacheForTests();
    const afterMove = await readPublicEdits();
    assert.equal(afterMove.entries.some((entry) => entry.slug === "pokrzywa-polna"), true);
    assert.equal(afterMove.entries.some((entry) => entry.slug === "szkic-polny"), false);
    assert.equal(afterMove.copy["home.note"], "z-produkcji");
    assert.equal(JSON.stringify(afterMove).includes("ten opis ma zostać prywatny"), false);
    const afterXml = sitemapXml({
      herbs: herbs.map((herb) => herb.slug),
      entries: afterMove.entries.map((entry) => ({ slug: entry.slug, updatedAt: entry.updatedAt })),
    });
    assert.deepEqual(locs(afterXml), beforeLocs);
    const quiet = calls.length;
    resetPublicCacheForTests();
    await readPublicEdits();
    assert.equal(calls.slice(quiet).some((item) => item.startsWith("LIST")), false);
    const editorAfter = await readEditorDoc();
    assert.equal(editorAfter.entries.some((entry) => entry.slug === "szkic-polny" && entry.status === "draft"), true);
    assert.equal(editorAfter.entries.find((entry) => entry.slug === "pokrzywa-polna")?.history[0]?.lead, "pierwsza notatka");
    const againMain = await applyPublicCutover(true);
    assert.equal(againMain.action, "already");
    assert.equal(againMain.revision, promotedMain.revision);
    const publicDocs = [...files.keys()].filter((path) => path.startsWith("zielarka/public/"));
    assert.equal(publicDocs.length, 1);

    files.clear();
    resetPublicCacheForTests();
    files.set("zielarka/content.json", {
      body: Buffer.from(JSON.stringify({ ...currentMain, copy: { "home.note": "tylko-content" } })),
      uploadedAt: 5,
    });
    const fromContent = await readPublicEdits();
    assert.equal(fromContent.copy["home.note"], "tylko-content");
    assert.equal(fromContent.entries.some((entry) => entry.slug === "pokrzywa-polna"), true);
    assert.equal(fromContent.entries.some((entry) => entry.slug === "szkic-polny"), false);

    files.set("zielarka/docs/1700000002000-cccccc.json", {
      body: Buffer.from("{to-nie-jest-json"),
      uploadedAt: 50,
    });
    files.set("zielarka/docs/1700000000000-aaaaaa.json", { body: Buffer.from(JSON.stringify(older)), uploadedAt: 20 });
    resetPublicCacheForTests();
    await assert.rejects(() => readPublicEdits(), /uszkodzona/);
    const damagedPlan = await diagnosePublicCutover();
    assert.equal(damagedPlan.action, "stop");
    assert.equal(files.has("zielarka/journal/public/current.json"), false);

    files.clear();
    resetPublicCacheForTests();
    const odd = {
      ...currentMain,
      notatkaWlasna: "nie gubić",
      entries: [{ ...publishedEntry, wlasnePole: "zostaje w pliku" }],
    };
    files.set("zielarka/docs/1700000003000-dddddd.json", { body: Buffer.from(JSON.stringify(odd)), uploadedAt: 8 });
    const visibleOdd = await readPublicEdits();
    assert.equal(visibleOdd.entries.some((entry) => entry.slug === "pokrzywa-polna"), true);
    const oddPlan = await diagnosePublicCutover();
    assert.equal(oddPlan.action, "stop");
    assert.match(oddPlan.reason, /notatkaWlasna/);
    assert.match(oddPlan.reason, /wlasnePole/);
    assert.equal(files.has("zielarka/journal/public/current.json"), false);
    assert.equal(files.get("zielarka/docs/1700000003000-dddddd.json")?.body.toString("utf8").includes("nie gubić"), true);
    const refused = await applyPublicCutover(true);
    assert.equal(refused.action, "stop");
    assert.equal(files.has("zielarka/journal/public/current.json"), false);

    files.clear();
    resetPublicCacheForTests();
    files.set("zielarka/docs/1700000004000-eeeeee.json", {
      body: Buffer.from(JSON.stringify(currentMain)),
      uploadedAt: 3,
    });
    files.set("zielarka/journal/public/00000004.json", {
      body: Buffer.from(JSON.stringify({ revision: 4, url: "https://evil.example/x", sha: "ab".repeat(32) })),
      uploadedAt: 9,
    });
    const mixed = await readPublicEdits();
    assert.equal(mixed.copy["home.note"], "z-produkcji");
    assert.notEqual(mixed.revision, 4);
    const mixedPlan = await diagnosePublicCutover();
    assert.equal(mixedPlan.action, "stop");
    assert.equal(files.has("zielarka/journal/public/current.json"), false);

    files.clear();
    resetPublicCacheForTests();
    const emptyRead = await readPublicEdits();
    assert.equal(emptyRead.revision, 0);
    assert.equal(emptyRead.entries.length, 0);
    const emptyPlan = await diagnosePublicCutover();
    assert.equal(emptyPlan.action, "stop");
    assert.equal(files.has("zielarka/journal/public/current.json"), false);

    files.set("zielarka/docs/1700000005000-ffffff.json", { body: Buffer.from(JSON.stringify(currentMain)), uploadedAt: 6 });
    resetPublicCacheForTests();
    failList = 403;
    await assert.rejects(() => readPublicEdits(), /403|chwilowo niedostępny/);
    failList = 429;
    resetPublicCacheForTests();
    await assert.rejects(() => readPublicEdits(), /429|chwilowo niedostępny/);
    failList = 500;
    resetPublicCacheForTests();
    await assert.rejects(() => readPublicEdits(), /500|chwilowo niedostępny/);
    failList = 0;
    outage = true;
    resetPublicCacheForTests();
    await assert.rejects(() => readPublicEdits(), /503|chwilowo niedostępny/);
    outage = false;
    resetPublicCacheForTests();
    assert.equal((await readPublicEdits()).copy["home.note"], "z-produkcji");
    files.set("zielarka/journal/public/current.json", {
      body: Buffer.from(JSON.stringify({ revision: 1, url: imageUrl, sha: "ab".repeat(32), committed: false })),
      uploadedAt: 70,
    });
    resetPublicCacheForTests();
    const beforeBadPointer = calls.length;
    await assert.rejects(() => readPublicEdits(), /uszkodzona|chwilowo/);
    assert.equal(calls.slice(beforeBadPointer).some((item) => item.startsWith("LIST")), false);
    writeFileSync("/tmp/zielarka-perf.json", JSON.stringify(timings));
  } finally {
    restoreEnv();
  }
});
