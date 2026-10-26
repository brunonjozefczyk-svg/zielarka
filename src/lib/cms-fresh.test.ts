/**
 * Regresja po teście na prawdziwym Blobie: 404 tuż po PUT, brak publikacji bez znacznika,
 * odtworzenie po chwilowym 404 i trwała awaria odczytu.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { FRESH_READ_LIMIT, setFreshReadDelayScaleForTests } from "./cms-guard.ts";
import { openJson, sealJson } from "./draft-seal.server.ts";
import { buildPayload, recoverBackup, type BackupDoc } from "./backup-bundle.ts";
import {
  beginRestoreUpload,
  createVerifiedBackup,
  downloadBackupPart,
  finishRestoreUpload,
  readEditorDoc,
  readPublicEdits,
  resetPublicCacheForTests,
  saveCopy,
  saveEntry,
  saveRestorePart,
} from "./site-store.server.ts";

const TOKEN = "vercel_blob_rw_itest0001_notprodkey1";
const HOST = "https://itest.public.blob.vercel-storage.com/p/";
const PUBLIC_ORIGIN = "https://itest0001.public.blob.vercel-storage.com/";

type Row = { body: Buffer; uploadedAt: number };

function dataUrl(bytes: Buffer) {
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

test("świeży Blob: 404, zła suma, przerwana publikacja i odtworzenie", async () => {
  const saved = {
    blob: process.env.BLOB_READ_WRITE_TOKEN,
    seal: process.env.CMS_SEAL_KEY,
    seals: process.env.CMS_SEAL_KEYS,
    legacy: process.env.CMS_SEAL_LEGACY_PASSWORD,
    password: process.env.EDITOR_PASSWORD,
  };
  const files = new Map<string, Row>();
  const calls: string[] = [];
  let clock = 10;
  let outage = false;
  let fault: { method: string; includes: string; status: number } | null = null;
  let privateMisses = 0;
  let alwaysMissPrivate = false;
  const readablePrivate = new Set<string>();
  let flipPrivateSha = false;
  let flipServes = 0;
  let blockPublic = 0;
  let laterJournalMisses = 0;
  let stalePrivateCdn = "";
  const seenJournal = new Set<string>();
  const original = globalThis.fetch;
  setFreshReadDelayScaleForTests(0);

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
      throw new Error(`Test odmówił sieci: ${raw}`);
    }
    if (outage && method === "GET") return new Response("niedostępne", { status: 503 });
    if (fault && method === fault.method && decodeURIComponent(raw).includes(fault.includes)) {
      const current = fault;
      fault = null;
      calls.push(`FAULT ${current.status} ${current.includes}`);
      return new Response("injected", { status: current.status });
    }
    if (raw.startsWith(HOST) || raw.startsWith(PUBLIC_ORIGIN)) {
      const pathname = pathnameFromUrl(raw);
      calls.push(`GET ${pathname}`);
      if (blockPublic && pathname === "zielarka/journal/public/current.json") {
        calls.push(`CDN ${blockPublic}`);
        return new Response("limit", { status: blockPublic });
      }
      if (pathname === "zielarka/journal/private/current.json" && init?.cache !== "no-store" && stalePrivateCdn) {
        calls.push("CDN-STALE private");
        return new Response(stalePrivateCdn, { status: 200 });
      }
      if (pathname.startsWith("zielarka/private/") && !pathname.includes("/journal/")) {
        if (alwaysMissPrivate && !readablePrivate.has(pathname)) {
          calls.push(`GET404 ${pathname}`);
          return new Response("brak", { status: 404 });
        }
        if (privateMisses > 0) {
          privateMisses -= 1;
          calls.push(`GET404 ${pathname}`);
          return new Response("brak", { status: 404 });
        }
      }
      if (pathname.startsWith("zielarka/journal/private/") && seenJournal.has(pathname) && laterJournalMisses > 0) {
        laterJournalMisses -= 1;
        return new Response("brak", { status: 404 });
      }
      const row = files.get(pathname);
      if (!row) return new Response("brak", { status: 404 });
      if (flipPrivateSha && pathname.startsWith("zielarka/private/") && !pathname.includes("/journal/") && !readablePrivate.has(pathname)) {
        flipServes += 1;
        const opened = openJson(JSON.parse(row.body.toString("utf8"))) as { sha?: string };
        opened.sha = "0".repeat(64);
        return new Response(sealJson(JSON.stringify(opened)), { status: 200 });
      }
      if (pathname.startsWith("zielarka/journal/private/")) seenJournal.add(pathname);
      if (pathname.startsWith("zielarka/private/") && !pathname.includes("/journal/")) readablePrivate.add(pathname);
      return new Response(new Uint8Array(row.body), { status: 200 });
    }
    const url = new URL(raw);
    const auth = new Headers(init?.headers).get("authorization") || "";
    if (auth !== `Bearer ${TOKEN}`) return new Response("zły token", { status: 401 });
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
      if (!pathname.startsWith("zielarka/") || pathname.includes("..")) return new Response("zła ścieżka", { status: 400 });
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
      return Response.json({ pathname, url: urlFor(pathname), downloadUrl: urlFor(pathname), uploadedAt: row.uploadedAt });
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
    calls.push(`LIST ${prefix}`);
    return Response.json({
      blobs: page,
      hasMore: start + limit < matched.length,
      ...(start + limit < matched.length ? { cursor: String(start + limit) } : {}),
    });
  };

  const restoreEnv = () => {
    globalThis.fetch = original;
    setFreshReadDelayScaleForTests(1);
    resetPublicCacheForTests();
    for (const [key, value] of [
      ["BLOB_READ_WRITE_TOKEN", saved.blob],
      ["CMS_SEAL_KEY", saved.seal],
      ["CMS_SEAL_KEYS", saved.seals],
      ["CMS_SEAL_LEGACY_PASSWORD", saved.legacy],
      ["EDITOR_PASSWORD", saved.password],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };

  try {
    process.env.BLOB_READ_WRITE_TOKEN = TOKEN;
    process.env.CMS_SEAL_KEY = randomBytes(32).toString("base64");
    delete process.env.CMS_SEAL_KEYS;
    delete process.env.CMS_SEAL_LEGACY_PASSWORD;
    process.env.EDITOR_PASSWORD = "haslo-testu-blob";
    resetPublicCacheForTests();

    privateMisses = 1;
    const noted = await saveCopy("home.note", "mieta", 0);
    assert.equal(noted, 1);
    const approved = JSON.parse(files.get("zielarka/journal/public/current.json")?.body.toString("utf8") || "null") as {
      committed?: boolean;
    };
    assert.equal(approved.committed, true);
    const privateGets = calls.filter((item) => item.startsWith("GET zielarka/private/") || item.startsWith("GET404 zielarka/private/"));
    assert.ok(privateGets.some((item) => item.startsWith("GET404 ")) && privateGets.some((item) => item.startsWith("GET ")), "PUT 200, potem GET 404 i GET 200");
    resetPublicCacheForTests();
    assert.equal((await readPublicEdits()).copy["home.note"], "mieta");
    const coldGets = calls.filter((item) => item.startsWith("GET ")).length;
    const beforeSteady = calls.length;
    resetPublicCacheForTests();
    await readPublicEdits();
    const steady = calls.slice(beforeSteady);
    assert.equal(
      steady.filter((item) => item.startsWith("LIST")).length,
      0,
      "odczyt strony nie listuje dziennika",
    );
    const added = calls.filter((item) => item.startsWith("GET ")).length - coldGets;
    assert.equal(added, 2, "zwykły odczyt nie ponawia");
    const pointerPath = "zielarka/journal/public/current.json";
    const keptPointer = files.get(pointerPath);
    assert.ok(keptPointer);
    const denied = JSON.parse(keptPointer.body.toString("utf8")) as { committed?: boolean };
    denied.committed = false;
    files.set(pointerPath, { body: Buffer.from(JSON.stringify(denied)), uploadedAt: keptPointer.uploadedAt });
    resetPublicCacheForTests();
    let beforeGate = calls.length;
    await assert.rejects(() => readPublicEdits(), /uszkodzona|chwilowo/);
    assert.equal(calls.slice(beforeGate).some((item) => item.startsWith("LIST")), false, "committed false nie listuje");
    delete denied.committed;
    files.set(pointerPath, { body: Buffer.from(JSON.stringify(denied)), uploadedAt: keptPointer.uploadedAt });
    resetPublicCacheForTests();
    beforeGate = calls.length;
    await assert.rejects(() => readPublicEdits(), /uszkodzona|chwilowo/);
    assert.equal(calls.slice(beforeGate).some((item) => item.startsWith("LIST")), false, "brak committed nie listuje");
    files.set(pointerPath, keptPointer);
    files.delete(pointerPath);
    resetPublicCacheForTests();
    beforeGate = calls.length;
    const withoutPointer = await readPublicEdits();
    assert.equal(withoutPointer.revision, 0);
    assert.equal(calls.slice(beforeGate).some((item) => item.startsWith("LIST")), false, "brak wskaźnika nie listuje dziennika");
    files.set(pointerPath, keptPointer);
    resetPublicCacheForTests();
    assert.equal((await readPublicEdits()).copy["home.note"], "mieta");
    files.set("zielarka/journal/public/00000099.json", {
      body: Buffer.from(JSON.stringify({ revision: 99, url: "https://evil.example/doc", sha: "ab".repeat(32) })),
      uploadedAt: 99_999,
    });
    resetPublicCacheForTests();
    const ignored = await readPublicEdits();
    assert.equal(ignored.copy["home.note"], "mieta");
    assert.notEqual(ignored.revision, 99);
    for (const status of [403, 429, 500, 503]) {
      blockPublic = status;
      resetPublicCacheForTests();
      const beforeBlock = calls.length;
      await assert.rejects(() => readPublicEdits(), /403|429|500|503|chwilowo niedostępny/);
      assert.equal(
        calls.slice(beforeBlock).some((item) => item.startsWith("LIST")),
        false,
        `status ${status} nie uruchamia listy`,
      );
    }
    blockPublic = 0;
    resetPublicCacheForTests();

    const beforeRepeat = calls.length;
    alwaysMissPrivate = true;
    await assert.rejects(() => saveCopy("home.note", "zniknieta", 1), /404/);
    alwaysMissPrivate = false;
    const repeated = calls.slice(beforeRepeat).filter((item) => item.startsWith("GET404 zielarka/private/")).length;
    assert.equal(repeated, FRESH_READ_LIMIT);
    resetPublicCacheForTests();
    assert.equal((await readPublicEdits()).copy["home.note"], "mieta");

    flipPrivateSha = true;
    flipServes = 0;
    await assert.rejects(() => saveCopy("home.note", "zla-suma", 1), /uszkodzona/);
    flipPrivateSha = false;
    assert.equal(flipServes, 1, "zła suma nie jest ponawiana");
    resetPublicCacheForTests();
    assert.equal((await readEditorDoc()).copy["home.note"], "mieta");

    fault = { method: "PUT", includes: "zielarka/journal/commit/", status: 500 };
    await assert.rejects(() => saveCopy("home.note", "bez-znacznika", 1), /Publikacja nie została wykonana/);
    resetPublicCacheForTests();
    assert.equal((await readPublicEdits()).copy["home.note"], "mieta");
    assert.equal([...files.keys()].some((path) => path.endsWith("journal/commit/00000002.json") || path.endsWith("journal/public/00000002.json")), false);

    fault = { method: "PUT", includes: "zielarka/private/", status: 500 };
    await assert.rejects(() => saveCopy("home.note", "prywatny-dokument", 1), /nie powiódł się \(500\)/);
    assert.equal(calls.filter((item) => item.includes("zielarka/private/") && item.startsWith("FAULT")).length, 1);
    resetPublicCacheForTests();
    assert.equal((await readPublicEdits()).copy["home.note"], "mieta");

    const editorBefore = await readEditorDoc();
    fault = { method: "PUT", includes: "zielarka/journal/public/", status: 500 };
    await assert.rejects(() => saveCopy("home.note", "przerwane-dziennik", editorBefore.revision), /Publikacja nie została wykonana/);
    resetPublicCacheForTests();
    const afterFault = await readPublicEdits();
    assert.equal(afterFault.copy["home.note"], "mieta");
    assert.notEqual(afterFault.copy["home.note"], "przerwane-dziennik");
    resetPublicCacheForTests();
    const healed = await readEditorDoc();
    resetPublicCacheForTests();
    const afterHeal = await readPublicEdits();
    assert.equal(afterHeal.copy["home.note"], "mieta");
    assert.equal(healed.copy["home.note"], "mieta");
    assert.equal([...files.keys()].some((path) => path.startsWith("zielarka/journal/commit/") && path.endsWith("00000002.json")), false);

    const kept = await saveCopy("home.note", "zostaje", healed.revision);
    for (const path of [...files.keys()]) {
      if (path.startsWith("zielarka/journal/public/") || path.startsWith("zielarka/public/")) files.delete(path);
    }
    resetPublicCacheForTests();
    await readEditorDoc();
    resetPublicCacheForTests();
    assert.equal((await readPublicEdits()).copy["home.note"], "zostaje");
    stalePrivateCdn = files.get("zielarka/journal/private/current.json")?.body.toString("utf8") || "";
    assert.ok(stalePrivateCdn.length > 20);
    const edited = await saveCopy("home.note", "z-edytora", kept);
    assert.equal(edited, kept + 1);
    const seen = await readEditorDoc();
    assert.equal(seen.revision, edited);
    assert.equal(seen.copy["home.note"], "z-edytora");
    assert.equal(calls.some((item) => item === "CDN-STALE private"), false, "edytor nie bierze starego wskaźnika z CDN");
    stalePrivateCdn = "";
    for (const path of [...files.keys()]) {
      if (
        path.startsWith("zielarka/journal/public/") ||
        path.startsWith("zielarka/public/") ||
        path.startsWith("zielarka/journal/commit/")
      ) {
        files.delete(path);
      }
    }
    resetPublicCacheForTests();
    await readEditorDoc();
    resetPublicCacheForTests();
    assert.notEqual((await readPublicEdits()).copy["home.note"], "zostaje");

    const current = await readEditorDoc();
    const pair = await Promise.allSettled([
      saveCopy("home.note", "sesja-a", current.revision),
      saveCopy("home.note", "sesja-b", current.revision),
    ]);
    assert.equal(pair.filter((item) => item.status === "fulfilled").length, 1);
    const raced = await readEditorDoc();
    assert.ok(raced.copy["home.note"] === "sesja-a" || raced.copy["home.note"] === "sesja-b");

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const drafted = await saveEntry(
      { name: "Szkic tajny", slug: "szkic-tajny", lead: "ukryty", status: "draft", image: dataUrl(png) },
      undefined,
      raced.revision,
    );
    assert.equal(drafted.entry.status, "draft");
    resetPublicCacheForTests();
    const hidden = await readPublicEdits();
    assert.equal(JSON.stringify(hidden).includes("Szkic tajny"), false);

    const journal = [...files.keys()].find((path) => path.startsWith("zielarka/journal/private/") && path.endsWith(`${String(drafted.revision).padStart(8, "0")}.json`));
    assert.ok(journal);
    const pointer = openJson(JSON.parse(files.get(journal || "")?.body.toString("utf8") || "null")) as {
      revision?: number;
      sha?: string;
      url?: string;
    };
    assert.equal(pointer.revision, drafted.revision);
    const storedPath = decodeURIComponent(String(pointer.url || "").slice(HOST.length));
    const stored = openJson(JSON.parse(files.get(storedPath)?.body.toString("utf8") || "null")) as { sha?: string };
    assert.equal(pointer.sha, stored.sha);
    assert.equal(typeof stored.sha, "string");

    const backup = await createVerifiedBackup("manual");
    for (const part of backup.parts) await downloadBackupPart(part.sha256, part.slice);
    const archive = backup.sealedManifest;
    const parts = [];
    for (const part of backup.parts) parts.push((await downloadBackupPart(part.sha256, part.slice)).sealed);
    files.clear();
    seenJournal.clear();
    resetPublicCacheForTests();
    assert.equal((await readPublicEdits()).revision, 0);
    laterJournalMisses = 1;
    const begun = await beginRestoreUpload(archive);
    for (const sealed of parts) await saveRestorePart(begun.session, sealed);
    const restored = await finishRestoreUpload(begun.session, 0, "PRZYWRÓĆ");
    assert.equal(restored.ok, true);
    resetPublicCacheForTests();
    const back = await readEditorDoc();
    assert.equal(back.copy["home.note"], drafted.entry.status === "draft" ? raced.copy["home.note"] : back.copy["home.note"]);
    assert.equal(back.entries.some((entry) => entry.slug === "szkic-tajny" && entry.status === "draft"), true);
    resetPublicCacheForTests();
    assert.equal(JSON.stringify(await readPublicEdits()).includes("Szkic tajny"), false);
    assert.equal(kept > 0, true);

    outage = true;
    const bare: BackupDoc = {
      revision: back.revision,
      copy: { "home.note": "mieta" },
      images: {},
      herbs: {},
      entries: [],
      theme: null,
      styles: {},
    };
    const blocked = await recoverBackup({
      phrase: "PRZYWRÓĆ",
      expectedRevision: back.revision,
      raw: buildPayload("manual", "2026-10-26T00:00:00.000Z", bare, []),
      readCurrent: async () => {
        throw new Error("Magazyn treści jest chwilowo niedostępny. Zapis został zatrzymany. Nic nie zostało cofnięte.");
      },
      revisionHint: async () => back.revision,
      snapshot: async () => undefined,
      legacyFiles: async () => null,
      putImage: async () => {
        throw new Error("nie wolno zapisać");
      },
      writeDoc: async () => {
        throw new Error("nie wolno zapisać");
      },
      readBack: async () => back as BackupDoc,
      readImage: async () => null,
    });
    outage = false;
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.uncertain, true);
    resetPublicCacheForTests();
    assert.equal((await readEditorDoc()).entries.some((entry) => entry.slug === "szkic-tajny"), true);
  } finally {
    restoreEnv();
  }
});
