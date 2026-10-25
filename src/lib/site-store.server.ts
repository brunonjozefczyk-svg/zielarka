import { createHash, timingSafeEqual } from "node:crypto";
import { herbs } from "./herbs";
import { builtinSlugs, type ManagedEntry, normalizeEntry, parseStoredEntry, slugify } from "./entries";
import {
  assertRevision,
  attemptBlocked,
  createAttemptLimiter,
  nextAttempt,
  toPublicDoc,
  urlsToPrune,
  lockDecision,
  publicFallback,
  type AttemptRow,
  type StampBlob,
} from "./cms-guard";
import { openJson, sealJson } from "./draft-seal.server";
import { sanitizeStyle, sanitizeStyles, sanitizeTheme, type TextStyle, type ThemeSettings } from "./theme";

export type SiteEdits = {
  revision: number;
  copy: Record<string, string>;
  images: Record<string, string>;
  herbs: Record<string, unknown>;
  entries: ManagedEntry[];
  theme: ThemeSettings | null;
  styles: Record<string, TextStyle>;
};

const DOC = "zielarka/content.json";
const DOCS = "zielarka/docs/";
const PRIVATE_DOCS = "zielarka/private/";
const PUBLIC_DOCS = "zielarka/public/";
const PUBLIC_CACHE_MS = 30_000;
const PRIVATE_KEEP = 8;
const PUBLIC_KEEP = 3;
const LOCKS = "zielarka/locks/";
const AUTH = "zielarka/auth/";

function empty(): SiteEdits {
  return { revision: 0, copy: {}, images: {}, herbs: {}, entries: [], theme: null, styles: {} };
}

let publicCache: { at: number; data: SiteEdits } | null = null;

function token() {
  return process.env.BLOB_READ_WRITE_TOKEN?.trim() || "";
}

export function passwordOk(given: string) {
  const expected = process.env.EDITOR_PASSWORD?.trim() || "";
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const memoryAttempts = createAttemptLimiter();

export async function editorGate(password: string, key: string) {
  const id = createHash("sha256").update(key || "local").digest("hex").slice(0, 20);
  if (memoryAttempts.blocked(id)) {
    return { ok: false as const, message: "Za dużo prób. Spróbuj za kwadrans." };
  }
  let row: AttemptRow | null = null;
  try {
    row = await readAttempt(id);
  } catch {
    row = null;
  }
  if (attemptBlocked(row)) {
    memoryAttempts.note(id, false);
    return { ok: false as const, message: "Za dużo prób. Spróbuj za kwadrans." };
  }
  const ok = passwordOk(password);
  memoryAttempts.note(id, ok);
  const next = nextAttempt(row, ok);
  try {
    await writeAttempt(id, next);
  } catch {
    // Licznik w pamięci tej instancji zostaje.
  }
  if (!ok) return { ok: false as const, message: "Złe hasło." };
  return { ok: true as const, message: "" };
}

const BLOB_API = "11";

async function blobPut(pathname: string, body: BodyInit, contentType: string) {
  const key = token();
  if (!key) throw new Error("Brak magazynu zdjęć.");
  const url = `https://vercel.com/api/blob/?${new URLSearchParams({ pathname })}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${key}`,
      "x-api-version": BLOB_API,
      "x-content-type": contentType,
      "x-add-random-suffix": "0",
      "x-allow-overwrite": "1",
      "x-cache-control-max-age": contentType.startsWith("image/") ? "86400" : "60",
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Zapis nie powiódł się (${res.status}).`);
  }
  return (await res.json()) as { url: string; downloadUrl?: string };
}

async function blobCreate(pathname: string, body: string) {
  const key = token();
  if (!key) throw new Error("Brak magazynu treści.");
  const url = `https://vercel.com/api/blob/?${new URLSearchParams({ pathname })}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${key}`,
      "x-api-version": BLOB_API,
      "x-content-type": "application/json",
      "x-add-random-suffix": "0",
      "x-allow-overwrite": "0",
      "x-cache-control-max-age": "60",
    },
    body,
  });
  if (res.ok) {
    const data = (await res.json()) as { url?: string };
    return { status: res.status, body: "", url: data.url ?? "" };
  }
  return { status: res.status, body: await res.text(), url: "" };
}

type BlobMeta = { url?: string; downloadUrl?: string; pathname?: string; uploadedAt?: string | number };

async function blobList(prefix: string) {
  const key = token();
  if (!key) throw new Error("Brak magazynu treści.");
  const url = `https://vercel.com/api/blob/?${new URLSearchParams({ prefix, limit: "100" })}`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${key}`, "x-api-version": BLOB_API },
  });
  if (!res.ok) throw new Error(`Odczyt nie powiódł się (${res.status}).`);
  const data = (await res.json()) as { blobs?: BlobMeta[] };
  return data.blobs ?? [];
}

async function blobHead(pathname: string) {
  const key = token();
  if (!key) throw new Error("Brak magazynu treści.");
  const url = `https://vercel.com/api/blob/?${new URLSearchParams({ url: pathname })}`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${key}`, "x-api-version": BLOB_API },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Odczyt nie powiódł się (${res.status}).`);
  return (await res.json()) as BlobMeta;
}

async function blobDelete(urls: string[]) {
  const key = token();
  const clean = [...new Set(urls.filter((url) => url.includes("vercel-storage.com")))];
  if (!key || clean.length === 0) return;
  await fetch("https://vercel.com/api/blob/delete", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "x-api-version": BLOB_API,
      "content-type": "application/json",
    },
    body: JSON.stringify({ urls: clean }),
  });
}

function blobStamp(blob: BlobMeta) {
  const value = typeof blob.uploadedAt === "number" ? blob.uploadedAt : Date.parse(String(blob.uploadedAt ?? ""));
  return Number.isFinite(value) ? value : 0;
}

function readUrl(blob: BlobMeta) {
  return blob.downloadUrl || blob.url || "";
}

function newest(blobs: BlobMeta[]) {
  return blobs
    .filter((blob) => blob.pathname && readUrl(blob))
    .sort((a, b) => blobStamp(b) - blobStamp(a) || String(b.pathname).localeCompare(String(a.pathname)))[0];
}

function parseDoc(data: Partial<SiteEdits> & { revision?: unknown }): SiteEdits {
  const revision = typeof data.revision === "number" && Number.isFinite(data.revision) ? data.revision : 0;
  return {
    revision,
    copy: data.copy && typeof data.copy === "object" ? data.copy : {},
    images: data.images && typeof data.images === "object" ? data.images : {},
    herbs: data.herbs && typeof data.herbs === "object" ? data.herbs : {},
    entries: Array.isArray(data.entries)
      ? data.entries.flatMap((item) => {
          const entry = parseStoredEntry(item);
          return entry ? [entry] : [];
        })
      : [],
    theme: sanitizeTheme(data.theme),
    styles: sanitizeStyles(data.styles),
  };
}

async function fetchDoc(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Odczyt treści nie powiódł się (${res.status}).`);
  return parseDoc(openJson(await res.json()) as Partial<SiteEdits>);
}

async function loadLegacy(): Promise<SiteEdits | null> {
  const latest = newest(await blobList(DOCS));
  if (latest) return fetchDoc(readUrl(latest));
  const legacy = await blobHead(DOC);
  if (!legacy || !readUrl(legacy)) return null;
  return fetchDoc(readUrl(legacy));
}

async function loadPrivateFresh(): Promise<SiteEdits> {
  const latest = newest(await blobList(PRIVATE_DOCS));
  if (latest) return fetchDoc(readUrl(latest));
  return (await loadLegacy()) ?? empty();
}

async function loadPublic(): Promise<SiteEdits> {
  if (publicCache && Date.now() - publicCache.at < PUBLIC_CACHE_MS) return publicCache.data;
  try {
    const latest = newest(await blobList(PUBLIC_DOCS));
    const doc = latest ? toPublicDoc(await fetchDoc(readUrl(latest))) : toPublicDoc((await loadLegacy()) ?? empty());
    publicCache = { at: Date.now(), data: doc };
    return doc;
  } catch (error) {
    if (publicCache) return publicCache.data;
    throw error;
  }
}

function clone(doc: SiteEdits): SiteEdits {
  return {
    revision: doc.revision,
    copy: { ...doc.copy },
    images: { ...doc.images },
    herbs: { ...doc.herbs },
    entries: doc.entries.map((entry) => ({ ...entry })),
    theme: doc.theme ? { ...doc.theme } : null,
    styles: { ...doc.styles },
  };
}

export async function readPublicEdits(): Promise<SiteEdits> {
  if (!token()) return empty();
  try {
    return await loadPublic();
  } catch (error) {
    console.error("Nie udało się odczytać treści strony.");
    return publicFallback(publicCache?.data ?? null, error);
  }
}

async function readForWrite(): Promise<SiteEdits> {
  return clone(await loadPrivateFresh());
}

async function prune(prefix: string, keep: number, writtenPath: string) {
  const blobs = await blobList(prefix);
  const stamps: StampBlob[] = blobs.flatMap((blob) => {
    const url = blob.url || "";
    const pathname = blob.pathname || "";
    if (!url || !pathname) return [];
    return [{ pathname, url, uploadedAt: blobStamp(blob) }];
  });
  await blobDelete(urlsToPrune(stamps, keep, writtenPath));
}

async function lockAge(pathname: string) {
  const blobs = await blobList(LOCKS);
  const lock = blobs.find((blob) => blob.pathname === pathname);
  const url = lock ? readUrl(lock) : "";
  if (!url) return null;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return 0;
    const stamp = Number(await res.text());
    if (!Number.isFinite(stamp)) return 0;
    return Math.max(0, Date.now() - stamp);
  } catch {
    return 0;
  }
}

async function claimLock(revision: number) {
  const lockPath = `${LOCKS}${revision}.lock`;
  const first = await blobCreate(lockPath, String(Date.now()));
  if (lockDecision(first.status, first.body, 0) === "claimed" && first.url) return first.url;
  const decision = lockDecision(first.status, first.body, await lockAge(lockPath));
  if (decision === "fail") throw new Error(`Zapis nie powiódł się (${first.status}).`);
  if (decision === "busy") throw new Error("Ktoś zapisał w międzyczasie. Odśwież stronę.");
  const blobs = await blobList(LOCKS);
  const existing = blobs.find((blob) => blob.pathname === lockPath);
  if (existing?.url) await blobDelete([existing.url]);
  const second = await blobCreate(lockPath, String(Date.now()));
  if (second.status >= 200 && second.status < 300 && second.url) return second.url;
  throw new Error("Ktoś zapisał w międzyczasie. Odśwież stronę.");
}

async function writeEdits(doc: SiteEdits) {
  const lockPath = `${LOCKS}${doc.revision}.lock`;
  const lockUrl = await claimLock(doc.revision);
  const next: SiteEdits = { ...doc, revision: doc.revision + 1 };
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const privatePath = `${PRIVATE_DOCS}${id}.json`;
  const publicPath = `${PUBLIC_DOCS}${id}.json`;
  try {
    await blobPut(privatePath, sealJson(JSON.stringify(next)), "application/json");
    const published = toPublicDoc(next);
    await blobPut(publicPath, JSON.stringify(published), "application/json");
    publicCache = { at: Date.now(), data: published };
  } catch (error) {
    if (lockUrl) await blobDelete([lockUrl]);
    throw error;
  }
  try {
    await prune(PRIVATE_DOCS, PRIVATE_KEEP, privatePath);
    await prune(PUBLIC_DOCS, PUBLIC_KEEP, publicPath);
    await prune(LOCKS, 40, lockPath);
  } catch {
    // Starsze kopie zostają. Bieżący zapis już jest.
  }
  return next.revision;
}

export async function saveCopy(
  id: string,
  value: string,
  expectedRevision: number,
  style: unknown = undefined,
) {
  const doc = await readForWrite();
  assertRevision(doc.revision, expectedRevision);
  doc.copy[id] = value;
  if (style !== undefined) {
    const clean = sanitizeStyle(style);
    if (clean) doc.styles[id] = clean;
    else delete doc.styles[id];
  }
  return writeEdits(doc);
}

export async function saveTheme(theme: unknown, expectedRevision: number) {
  const doc = await readForWrite();
  assertRevision(doc.revision, expectedRevision);
  doc.theme = sanitizeTheme(theme);
  return writeEdits(doc);
}

export async function saveHerb(slug: string, copy: unknown, expectedRevision: number) {
  const doc = await readForWrite();
  assertRevision(doc.revision, expectedRevision);
  if (copy == null) delete doc.herbs[slug];
  else doc.herbs[slug] = copy;
  return writeEdits(doc);
}

async function storeImageBytes(id: string, dataUrl: string) {
  const match = /^data:image\/(?:jpeg|png|webp);base64,([a-z0-9+/=\s]+)$/i.exec(dataUrl);
  if (!match) throw new Error("To nie jest zdjęcie.");
  const bytes = Buffer.from(match[1].replace(/\s/g, ""), "base64");
  if (bytes.length < 32 || bytes.length > 2_500_000) throw new Error("Zdjęcie jest za duże.");
  const kind = imageKind(bytes);
  if (!kind) throw new Error("To nie jest zdjęcie.");
  const safe = id.replace(/[^a-z0-9_-]/gi, "").slice(0, 80) || "obraz";
  const ext = kind === "image/png" ? "png" : kind === "image/webp" ? "webp" : "jpg";
  const blob = await blobPut(`zielarka/images/${safe}-${Date.now()}.${ext}`, bytes, kind);
  return blob.url;
}

export async function saveImage(id: string, dataUrl: string, expectedRevision: number) {
  const url = await storeImageBytes(id, dataUrl);
  const doc = await readForWrite();
  assertRevision(doc.revision, expectedRevision);
  doc.images[id] = url;
  const revision = await writeEdits(doc);
  return { url, revision };
}

function imageKind(bytes: Buffer) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return "";
}

function takenSlugs(doc: SiteEdits, except?: string) {
  const taken = builtinSlugs();
  for (const entry of doc.entries) {
    if (entry.slug !== except) taken.add(entry.slug);
  }
  return taken;
}

export async function saveEntry(input: unknown, previousSlug: string | undefined, expectedRevision: number) {
  if (previousSlug && builtinSlugs().has(previousSlug)) {
    throw new Error("Tej rośliny nie da się podmienić. Jest częścią zielnika.");
  }
  const preview = await readForWrite();
  assertRevision(preview.revision, expectedRevision);
  const current = previousSlug ? preview.entries.find((entry) => entry.slug === previousSlug) : undefined;
  const raw = input && typeof input === "object" ? (input as { slug?: unknown }) : {};
  const wanted = slugify(String(raw.slug ?? ""));
  if (wanted && takenSlugs(preview, previousSlug).has(wanted) && wanted !== previousSlug) {
    throw new Error("Ten adres jest już zajęty. Wybierz inny.");
  }
  const next = normalizeEntry(input, takenSlugs(preview, previousSlug), previousSlug);
  if (!next) throw new Error("Podaj nazwę rośliny — co najmniej dwie litery.");
  const publishedBefore =
    current?.status === "published" || current?.history.some((item) => item.status === "published");
  if (publishedBefore && current) next.slug = current.slug;
  if (next.image.startsWith("data:")) {
    next.image = await storeImageBytes(`img.herb.${next.slug}`, next.image);
  } else if (!next.image && current) {
    next.image = current.image;
  }
  const doc = await readForWrite();
  if (doc.revision !== preview.revision) {
    throw new Error("Ktoś zapisał w międzyczasie. Odśwież stronę.");
  }
  next.history = current
    ? [
        ...current.history,
        {
          at: current.updatedAt,
          name: current.name,
          lead: current.lead.slice(0, 200),
          status: current.status,
        },
      ].slice(-8)
    : [];
  doc.entries = [
    ...doc.entries.filter((entry) => entry.slug !== previousSlug && entry.slug !== next.slug),
    next,
  ];
  const revision = await writeEdits(doc);
  return { entry: next, revision };
}

export async function deleteEntry(slug: string, expectedRevision: number) {
  if (builtinSlugs().has(slug)) throw new Error("Tej rośliny nie da się usunąć.");
  const doc = await readForWrite();
  assertRevision(doc.revision, expectedRevision);
  const found = doc.entries.some((entry) => entry.slug === slug);
  if (!found) throw new Error("Nie ma takiej karty.");
  doc.entries = doc.entries.filter((entry) => entry.slug !== slug);
  return writeEdits(doc);
}

export async function restorePrevious(expectedRevision: number) {
  const current = await readForWrite();
  assertRevision(current.revision, expectedRevision);
  const sorted = (await blobList(PRIVATE_DOCS))
    .filter((blob) => blob.pathname && readUrl(blob))
    .sort((a, b) => blobStamp(b) - blobStamp(a) || String(b.pathname).localeCompare(String(a.pathname)));
  const previous = sorted[1];
  if (!previous) throw new Error("Nie ma starszej kopii.");
  const restored = await fetchDoc(readUrl(previous));
  restored.revision = current.revision;
  const revision = await writeEdits(restored);
  return { revision };
}

export async function readEditorDoc() {
  const doc = await readForWrite();
  return doc;
}

export function publishedHerbs(doc: SiteEdits) {
  return doc.entries.filter((entry) => entry.status === "published");
}

async function readAttempt(id: string): Promise<AttemptRow | null> {
  const latest = newest(await blobList(`${AUTH}${id}/`));
  if (!latest) return null;
  const res = await fetch(readUrl(latest), { cache: "no-store" });
  if (!res.ok) return null;
  const data = (await res.json()) as Partial<AttemptRow>;
  if (typeof data.count !== "number" || typeof data.until !== "number") return null;
  return { count: data.count, until: data.until };
}

async function writeAttempt(id: string, row: AttemptRow) {
  const pathname = `${AUTH}${id}/${Date.now()}.json`;
  await blobPut(pathname, JSON.stringify(row), "application/json");
  try {
    await prune(`${AUTH}${id}/`, 1, pathname);
  } catch {
    // Licznik jest już zapisany.
  }
}

export { herbs };
