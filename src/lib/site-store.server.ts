import { timingSafeEqual } from "node:crypto";
import { herbs } from "./herbs";
import { builtinSlugs, type ManagedEntry, normalizeEntry, parseStoredEntry, slugify } from "./entries";
import { assertRevision, createAttemptLimiter, toPublicDoc, urlsToPrune, type StampBlob } from "./cms-guard";

export type SiteEdits = {
  revision: number;
  copy: Record<string, string>;
  images: Record<string, string>;
  herbs: Record<string, unknown>;
  entries: ManagedEntry[];
};

const DOC = "zielarka/content.json";
const DOCS = "zielarka/docs/";
const PRIVATE_DOCS = "zielarka/private/";
const PUBLIC_DOCS = "zielarka/public/";
const PUBLIC_CACHE_MS = 30_000;
const PRIVATE_KEEP = 8;
const PUBLIC_KEEP = 3;

function empty(): SiteEdits {
  return { revision: 0, copy: {}, images: {}, herbs: {}, entries: [] };
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

const attempts = createAttemptLimiter();

export function editorGate(password: string, key: string) {
  if (attempts.blocked(key || "local")) {
    return { ok: false as const, message: "Za dużo prób. Spróbuj za kwadrans." };
  }
  const ok = passwordOk(password);
  attempts.note(key || "local", ok);
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
  };
}

async function fetchDoc(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Odczyt treści nie powiódł się (${res.status}).`);
  return parseDoc((await res.json()) as Partial<SiteEdits>);
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
  };
}

export async function readPublicEdits(): Promise<SiteEdits> {
  if (!token()) return empty();
  try {
    return await loadPublic();
  } catch {
    console.error("Nie udało się odczytać treści strony.");
    return publicCache?.data ?? empty();
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

async function writeEdits(doc: SiteEdits) {
  const next: SiteEdits = { ...doc, revision: doc.revision + 1 };
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const privatePath = `${PRIVATE_DOCS}${id}.json`;
  const publicPath = `${PUBLIC_DOCS}${id}.json`;
  await blobPut(privatePath, JSON.stringify(next), "application/json");
  const published = toPublicDoc(next);
  await blobPut(publicPath, JSON.stringify(published), "application/json");
  publicCache = { at: Date.now(), data: published };
  try {
    await prune(PRIVATE_DOCS, PRIVATE_KEEP, privatePath);
    await prune(PUBLIC_DOCS, PUBLIC_KEEP, publicPath);
  } catch {
    // Starsze kopie zostają. Bieżący zapis już jest.
  }
  return next.revision;
}

export async function saveCopy(id: string, value: string, expectedRevision: number) {
  const doc = await readForWrite();
  assertRevision(doc.revision, expectedRevision);
  doc.copy[id] = value;
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

export { herbs };
