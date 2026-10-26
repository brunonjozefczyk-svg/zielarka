import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertOutsideRepo,
  assertPathname,
  collectPages,
  exportStore,
  isPublicBlobUrl,
  localFile,
  nextAction,
  sha256,
  summarize,
} from "./blob-export.mjs";

const HOST = "https://itest0001.public.blob.vercel-storage.com";

function item(pathname, body) {
  return { pathname, url: `${HOST}/${pathname}`, body: Buffer.from(body) };
}

test("odrzucone są ścieżki spoza zielarka i wychodzące z katalogu", () => {
  assert.equal(assertPathname("zielarka/docs/a.json"), true);
  assert.equal(assertPathname("zielarka/../sekret"), false);
  assert.equal(assertPathname("/zielarka/docs/a.json"), false);
  assert.equal(isPublicBlobUrl(`${HOST}/zielarka/docs/a.json`), true);
  assert.equal(isPublicBlobUrl("http://evil.example/a"), false);
  assert.throws(() => localFile("/tmp/out", "zielarka/../../etc/passwd"));
  assert.throws(() => assertOutsideRepo("/tmp/repo/kopia", "/tmp/repo"));
  assert.doesNotThrow(() => assertOutsideRepo("/tmp/poza", "/tmp/repo"));
});

test("pusta i urwana lista nie jest kompletną kopią", () => {
  const empty = collectPages([{ blobs: [], hasMore: false }]);
  assert.equal(empty.ok, true);
  assert.equal(empty.items.length, 0);
  const broken = collectPages([{ blobs: [{ pathname: "zielarka/docs/a.json", url: `${HOST}/a` }], hasMore: true }]);
  assert.equal(broken.ok, false);
  const loop = collectPages([
    { blobs: [], hasMore: true, cursor: "c1" },
    { blobs: [], hasMore: true, cursor: "c1" },
  ]);
  assert.equal(loop.ok, false);
});

test("eksport fikcyjnych danych: dwie strony, SHA-256, wznowienie bez ponownego GET", async () => {
  const docs = item("zielarka/docs/1.json", JSON.stringify({ entries: [{ status: "draft", name: "szkic" }] }));
  const photo = item("zielarka/images/lisc.webp", "obraz-fikcyjny");
  const pages = [
    { blobs: [{ pathname: docs.pathname, url: docs.url, uploadedAt: "2026-01-01T00:00:00.000Z" }], hasMore: true, cursor: "next" },
    { blobs: [{ pathname: photo.pathname, url: photo.url }], hasMore: false },
  ];
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init?.method, authorization: init?.headers?.authorization || "" });
    if (String(url).includes("vercel.com/api/blob")) {
      const cursor = new URL(url).searchParams.get("cursor");
      const page = cursor ? pages[1] : pages[0];
      return { ok: true, status: 200, json: async () => page, text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) };
    }
    const hit = [docs, photo].find((row) => url === row.url);
    if (!hit) return { ok: false, status: 404, json: async () => ({}), text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) };
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => "",
      arrayBuffer: async () => hit.body.buffer.slice(hit.body.byteOffset, hit.body.byteOffset + hit.body.byteLength),
    };
  };
  const out = mkdtempSync(join(tmpdir(), "zielarka-export-"));
  try {
    const first = await exportStore({ outDir: out, token: "vercel_blob_rw_test_secret", fetchImpl });
    assert.equal(first.ok, true);
    assert.equal(first.downloaded, 2);
    assert.equal(first.pages, 2);
    assert.equal(first.summary.counts.docs, 1);
    assert.equal(first.summary.counts.images, 1);
    assert.equal(JSON.stringify(first.summary).includes("szkic"), false);
    const saved = readFileSync(join(out, "files", docs.pathname));
    assert.equal(sha256(saved), sha256(docs.body));
    const list = JSON.parse(readFileSync(join(out, "list.json"), "utf8"));
    assert.equal(JSON.stringify(list).includes("vercel_blob_rw"), false);
    assert.equal(calls.every((call) => call.method === "GET"), true);
    assert.equal(calls.filter((call) => call.url.includes("api/blob")).length, 2);
    assert.equal(calls.filter((call) => call.url.startsWith(HOST) && call.authorization).length, 0);
    const after = calls.length;
    const second = await exportStore({ outDir: out, token: "vercel_blob_rw_test_secret", fetchImpl, resume: true });
    assert.equal(second.ok, true);
    assert.equal(second.downloaded, 0);
    assert.equal(second.skipped, 2);
    assert.equal(calls.length, after);
    assert.equal(nextAction({ pathname: docs.pathname, url: docs.url }, null), "download");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("zawieszony magazyn i pusta lista nie tworzą fałszywej kopii", async () => {
  const out = mkdtempSync(join(tmpdir(), "zielarka-export-"));
  try {
    const suspended = await exportStore({
      outDir: out,
      token: "vercel_blob_rw_test_secret",
      fetchImpl: async () => ({ ok: false, status: 403, text: async () => "store_suspended", json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }),
    });
    assert.equal(suspended.suspended, true);
    assert.equal(suspended.ok, false);
    const empty = await exportStore({
      outDir: join(out, "pusta"),
      token: "vercel_blob_rw_test_secret",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ blobs: [], hasMore: false }),
        text: async () => "",
        arrayBuffer: async () => new ArrayBuffer(0),
      }),
    });
    assert.equal(empty.empty, true);
    assert.equal(empty.ok, false);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
