/**
 * Prawdziwe funkcje site-store na magazynie w pamięci.
 * To nie jest Vercel Blob i nie jest magazyn Sabiny. Żądanie poza atrapę jest błędem.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import test from "node:test";
import { canonicalEdits } from "./cms-guard.ts";
import { openJson, payloadSha, sealJson } from "./draft-seal.server.ts";
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
} from "./site-store.server.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const DRAFT_PNG = Buffer.from(PNG);
DRAFT_PNG[DRAFT_PNG.length - 1] ^= 0xff;

const TEST_TOKEN = "vercel_blob_rw_itest0001_notprodkey1";
const HOST = "https://itest.public.blob.vercel-storage.com/p/";

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
  let clock = 1_700_000_000_000;
  const original = globalThis.fetch;

  function urlFor(pathname: string) {
    return `${HOST}${encodeURIComponent(pathname)}`;
  }

  function pathnameFromUrl(value: string) {
    if (!value.startsWith(HOST)) return "";
    return decodeURIComponent(value.slice(HOST.length));
  }

  globalThis.fetch = async (input, init) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method || "GET").toUpperCase();
    if (!raw.startsWith("https://vercel.com/api/blob") && !raw.startsWith(HOST)) {
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
    if (raw.startsWith(HOST)) {
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
      const before = calls.length;
      const started = performance.now();
      resetPublicCacheForTests();
      const cold = await readPublicEdits();
      const ms = performance.now() - started;
      assert.equal(cold.revision, count);
      const used = calls.slice(before);
      const listCalls = used.filter((item) => item.startsWith("LIST zielarka/journal/public/")).length;
      const bodyCalls = used.filter((item) => item.startsWith("GET ")).length;
      assert.equal(listCalls, Math.ceil(count / 1000));
      assert.equal(bodyCalls, 2);
      const warmBefore = calls.length;
      await readPublicEdits();
      assert.equal(calls.length, warmBefore);
      timings.push({ saves: count, listCalls, bodyCalls, ms: Math.round(ms * 10) / 10 });
    }
    writeFileSync("/tmp/zielarka-perf.json", JSON.stringify(timings));
  } finally {
    restoreEnv();
  }
});
