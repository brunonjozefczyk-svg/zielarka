#!/usr/bin/env node
/**
 * Pełna kopia surowych plików CMS z Vercel Blob na dysk.
 * Tylko GET. Nie kasuje, nie nadpisuje i nie wysyła niczego do magazynu.
 *
 * Istniejąca kopia z edytora tego nie zastępuje: ona tworzy nowy zapis
 * i nie zabiera starych dokumentów zielarka/docs/.
 *
 *   BLOB_READ_WRITE_TOKEN='...' node scripts/blob-export.mjs --out /ścieżka/poza/repo
 *   node scripts/blob-export.mjs --check --out /ścieżka/poza/repo
 *   node scripts/blob-export.mjs --resume --out /ścieżka/poza/repo
 *
 * Katalog --out nie może leżeć w repozytorium. Nie commituj go.
 * Token zostaje w zmiennej środowiska. Skrypt go nie wypisuje i nie zapisuje.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const PREFIX = "zielarka/";
export const PAGE_LIMIT = 1000;
export const MAX_PAGES = 200;
const API = "https://vercel.com/api/blob/";

export function assertPathname(pathname) {
  return (
    typeof pathname === "string" &&
    pathname.startsWith(PREFIX) &&
    !pathname.includes("..") &&
    !pathname.includes("\\") &&
    !pathname.includes("\0") &&
    !pathname.startsWith("/")
  );
}

export function localFile(outDir, pathname) {
  if (!assertPathname(pathname)) throw new Error("Odrzucony adres pliku.");
  const root = resolve(outDir, "files");
  const full = resolve(root, pathname);
  if (full !== root && !full.startsWith(root + sep)) throw new Error("Odrzucony adres pliku.");
  return full;
}

export function assertOutsideRepo(outDir, repoRoot) {
  const out = resolve(outDir);
  const repo = resolve(repoRoot);
  if (out === repo || out.startsWith(repo + sep)) {
    throw new Error("Katalog kopii nie może leżeć w repozytorium.");
  }
}

export function isPublicBlobUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const host = url.hostname;
    return host.endsWith(".public.blob.vercel-storage.com") || host === "public.blob.vercel-storage.com";
  } catch {
    return false;
  }
}

export function bucket(pathname) {
  if (pathname === "zielarka/content.json") return "content";
  if (pathname.startsWith("zielarka/docs/")) return "docs";
  if (pathname.startsWith("zielarka/images/")) return "images";
  if (pathname.startsWith("zielarka/journal/")) return "journal";
  if (pathname.startsWith("zielarka/private/")) return "private";
  if (pathname.startsWith("zielarka/sealed-images/")) return "sealed";
  if (pathname.startsWith("zielarka/backups/")) return "backups";
  return "inne";
}

export function summarize(items) {
  const counts = {};
  for (const item of items) {
    const key = bucket(item.pathname);
    counts[key] = (counts[key] || 0) + 1;
  }
  return { files: items.length, counts };
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function parseListPage(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.blobs) || typeof data.hasMore !== "boolean") {
    return { ok: false, error: "Lista magazynu jest niepełna." };
  }
  if (data.hasMore && (typeof data.cursor !== "string" || !data.cursor)) {
    return { ok: false, error: "Lista magazynu jest niepełna." };
  }
  const items = [];
  for (const blob of data.blobs) {
    if (!blob || typeof blob !== "object") return { ok: false, error: "Lista magazynu jest niepełna." };
    const pathname = typeof blob.pathname === "string" ? blob.pathname : "";
    if (!pathname.startsWith(PREFIX)) continue;
    items.push({
      pathname,
      url: typeof blob.url === "string" ? blob.url : "",
      uploadedAt: blob.uploadedAt ?? null,
    });
  }
  return { ok: true, items, hasMore: data.hasMore, cursor: typeof data.cursor === "string" ? data.cursor : "" };
}

export function collectPages(pages) {
  const items = [];
  const seen = new Set();
  let cursor = "";
  for (let index = 0; index < pages.length; index += 1) {
    const parsed = parseListPage(pages[index]);
    if (!parsed.ok) return parsed;
    items.push(...parsed.items);
    if (!parsed.hasMore) return { ok: true, items, pages: index + 1 };
    if (!parsed.cursor || seen.has(parsed.cursor) || index === pages.length - 1) {
      return { ok: false, error: "Lista magazynu jest niepełna." };
    }
    seen.add(parsed.cursor);
    cursor = parsed.cursor;
  }
  return { ok: false, error: cursor ? "Lista magazynu jest niepełna." : "Lista magazynu jest niepełna." };
}

export function nextAction(item, local) {
  if (!assertPathname(item.pathname) || !isPublicBlobUrl(item.url)) return "reject";
  if (local && local.sha256 && local.sha256 === sha256(local.bytes) && local.bytes.length === local.size) return "skip";
  return "download";
}

function writeJson(path, value) {
  const temporary = `${path}.partial`;
  writeFileSync(temporary, JSON.stringify(value));
  renameSync(temporary, path);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

async function listRemote(token, fetchImpl) {
  const items = [];
  const seen = new Set();
  let cursor = "";
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({ prefix: PREFIX, limit: String(PAGE_LIMIT) });
    if (cursor) params.set("cursor", cursor);
    const response = await fetchImpl(`${API}?${params}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}`, "x-api-version": "11" },
      redirect: "manual",
    });
    if (response.status === 403) {
      const detail = await response.text();
      if (/store_suspended|limits-exceeded|suspended/i.test(detail)) {
        return { ok: false, suspended: true, error: "Magazyn jest wstrzymany. Nic nie pobrano i nic nie zmieniono." };
      }
      return { ok: false, error: "Odczyt listy został odrzucony. Nic nie zmieniono." };
    }
    if (!response.ok) return { ok: false, error: `Odczyt listy nie powiódł się (${response.status}). Nic nie zmieniono.` };
    const parsed = parseListPage(await response.json());
    if (!parsed.ok) return parsed;
    items.push(...parsed.items);
    if (!parsed.hasMore) return { ok: true, items, pages: page + 1 };
    if (!parsed.cursor || seen.has(parsed.cursor)) return { ok: false, error: "Lista magazynu jest niepełna. Nic nie zmieniono." };
    seen.add(parsed.cursor);
    cursor = parsed.cursor;
  }
  return { ok: false, error: "Lista magazynu jest za długa. Nic nie zmieniono." };
}

async function downloadOne(item, fetchImpl) {
  const response = await fetchImpl(item.url, { method: "GET", redirect: "manual" });
  if (response.status >= 300 && response.status < 400) return { ok: false, error: "Przekierowanie pliku zostało odrzucone." };
  if (!response.ok) return { ok: false, error: `Pobranie nie powiodło się (${response.status}).` };
  const bytes = Buffer.from(await response.arrayBuffer());
  return { ok: true, bytes, sha256: sha256(bytes) };
}

export async function exportStore({ outDir, token, fetchImpl = fetch, resume = false, allowEmpty = false }) {
  mkdirSync(outDir, { recursive: true });
  const listPath = resolve(outDir, "list.json");
  const verifiedPath = resolve(outDir, "verified.json");
  let listed;
  let pages = 0;
  if (resume && existsSync(listPath)) {
    const saved = readJson(listPath);
    if (!saved?.complete || !Array.isArray(saved.items)) return { ok: false, error: "Zapisana lista jest niepełna." };
    listed = saved.items;
    pages = saved.pages || 0;
  } else {
    const remote = await listRemote(token, fetchImpl);
    if (!remote.ok) return remote;
    if (remote.items.length === 0 && !allowEmpty) {
      return { ok: false, empty: true, error: "Lista jest pusta. To nie jest dowód, że magazyn nie ma plików. Kopia nie została uznana za kompletną." };
    }
    listed = remote.items;
    pages = remote.pages;
    writeJson(listPath, { version: 1, prefix: PREFIX, complete: true, pages, items: listed });
  }
  const previous = existsSync(verifiedPath) ? readJson(verifiedPath).files || {} : {};
  const files = {};
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  for (const item of listed) {
    let local = null;
    const path = assertPathname(item.pathname) ? localFile(outDir, item.pathname) : "";
    if (path && existsSync(path)) {
      const bytes = readFileSync(path);
      const known = previous[item.pathname];
      local = { bytes, size: bytes.length, sha256: known?.sha256, verifiedSha: known?.sha256 };
      if (known?.sha256 === sha256(bytes) && known.size === bytes.length) {
        files[item.pathname] = { sha256: known.sha256, size: bytes.length };
        skipped += 1;
        continue;
      }
    }
    if (nextAction(item, null) === "reject") {
      failed += 1;
      continue;
    }
    const got = await downloadOne(item, fetchImpl);
    if (!got.ok) {
      failed += 1;
      continue;
    }
    const destination = localFile(outDir, item.pathname);
    mkdirSync(dirname(destination), { recursive: true });
    const partial = `${destination}.partial`;
    writeFileSync(partial, got.bytes);
    renameSync(partial, destination);
    files[item.pathname] = { sha256: got.sha256, size: got.bytes.length };
    downloaded += 1;
  }
  writeJson(verifiedPath, { version: 1, files });
  const check = verifyLocal(outDir, listed, files);
  return {
    ok: failed === 0 && check.ok,
    downloaded,
    skipped,
    failed,
    pages,
    summary: summarize(listed),
    error: check.ok ? "" : "Kopia jest niepełna. Nic w magazynie nie zostało zmienione.",
  };
}

export function verifyLocal(outDir, items, recorded) {
  for (const item of items) {
    const row = recorded[item.pathname];
    if (!row?.sha256) return { ok: false };
    let bytes;
    try {
      bytes = readFileSync(localFile(outDir, item.pathname));
    } catch {
      return { ok: false };
    }
    if (bytes.length !== row.size || sha256(bytes) !== row.sha256) return { ok: false };
  }
  return { ok: true };
}

function repoRoot() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(resolve(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirname(fileURLToPath(import.meta.url));
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

async function main() {
  const outDir = arg("--out");
  const checkOnly = process.argv.includes("--check");
  const resume = process.argv.includes("--resume");
  if (!outDir) {
    console.error("Podaj --out katalogu poza repozytorium.");
    process.exit(2);
  }
  try {
    assertOutsideRepo(outDir, repoRoot());
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Zły katalog.");
    process.exit(2);
  }
  if (checkOnly) {
    try {
      const list = readJson(resolve(outDir, "list.json"));
      const verified = readJson(resolve(outDir, "verified.json"));
      if (!list?.complete || !Array.isArray(list.items)) throw new Error("Zapisana lista jest niepełna.");
      const result = verifyLocal(outDir, list.items, verified.files || {});
      const summary = summarize(list.items);
      console.log(`Plików: ${summary.files}. Katalogi: ${JSON.stringify(summary.counts)}.`);
      if (!result.ok) {
        console.error("Kopia nie zgadza się z sumami SHA-256.");
        process.exit(1);
      }
      console.log("Kopia lokalna jest kompletna. Magazyn nie był ruszany.");
      return;
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Nie da się sprawdzić kopii.");
      process.exit(1);
    }
  }
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim() || "";
  if (!token) {
    console.error("Brak BLOB_READ_WRITE_TOKEN w środowisku. Nic nie zostało pobrane.");
    process.exit(2);
  }
  const result = await exportStore({ outDir, token, resume, allowEmpty: process.env.ZIELARKA_EXPORT_ALLOW_EMPTY === "tak" });
  if (result.suspended) {
    console.error(result.error);
    process.exit(3);
  }
  if (!result.ok) {
    console.error(result.error || "Kopia nie jest kompletna.");
    process.exit(result.empty ? 4 : 1);
  }
  console.log(
    `Lista: ${result.pages} stron. Pobrane: ${result.downloaded}. Pominięte: ${result.skipped}. Braki: ${result.failed}.`,
  );
  console.log(`Plików: ${result.summary.files}. Katalogi: ${JSON.stringify(result.summary.counts)}.`);
  console.log("Kopia kompletna. W magazynie nic nie zostało zmienione.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "Eksport przerwany.";
    console.error(message.replace(/vercel_blob_rw_\S+/g, "[token]"));
    process.exit(1);
  });
}
