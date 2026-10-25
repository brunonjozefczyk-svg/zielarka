import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { herbs } from "./herbs";
import { builtinSlugs, type ManagedEntry, normalizeEntry, parseStoredEntry, slugify } from "./entries";
import {
  assertRevision,
  attemptBlocked,
  canonicalEdits,
  createAttemptLimiter,
  expiredInboxUrls,
  nextAttempt,
  publicJournalFailure,
  readFailureAction,
  STORE_OUTAGE,
  throwIfUncertain,
  toPublicDoc,
  selectPublicRevision,
  urlsToPrune,
  writeAfterReread,
  lockDecision,
  publicFallback,
  type AttemptRow,
  type StampBlob,
} from "./cms-guard";
import { BLOB_PAGE_LIMIT, listAllBlobs } from "./blob-pages";
import { openJson, payloadSha, sealConfigured, sealJson, activeSealKid } from "./draft-seal.server";
import {
  attachManifestParts,
  buildPayload,
  bundledAsset,
  confirmBackupRoundtrip,
  fileFromBytes,
  imageGoesToPrivateStore,
  joinSliceText,
  parseDataUrl,
  planBackupRetention,
  plannedRefs,
  partPath,
  partCandidates,
  canReuseSlice,
  recoverBackup,
  sliceBytes,
  sliceEnvelope,
  sniffImage,
  sha256Bytes,
  toManifest,
  SERVER_PAYLOAD_LIMIT,
  type BackupDoc,
  type BackupFile,
  type BackupManifest,
} from "./backup-bundle";
import { offsiteDecision, offsiteExportAllowed } from "./backup-wire";
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
const LOCKS = "zielarka/locks/";
const AUTH = "zielarka/auth/";
const JOURNAL_PUBLIC = "zielarka/journal/public/";
const JOURNAL_PRIVATE = "zielarka/journal/private/";
const PUBLIC_CURRENT = "zielarka/journal/public/current.json";
const BACKUPS = "zielarka/backups/";
const INBOX = "zielarka/restore-inbox/";
const SEALED_IMAGES = "zielarka/sealed-images/";

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
  return listAllBlobs(async (cursor) => {
    const params = new URLSearchParams({ prefix, limit: String(BLOB_PAGE_LIMIT) });
    if (cursor) params.set("cursor", cursor);
    const url = `https://vercel.com/api/blob/?${params}`;
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${key}`, "x-api-version": BLOB_API },
    });
    if (!res.ok) throw new Error(`Odczyt nie powiódł się (${res.status}).`);
    return res.json() as Promise<unknown>;
  });
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
  let res: Response;
  try {
    res = await fetch("https://vercel.com/api/blob/delete", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "x-api-version": BLOB_API,
        "content-type": "application/json",
      },
      body: JSON.stringify({ urls: clean }),
    });
  } catch {
    console.error("Kasowanie w magazynie nie powiodło się (sieć).");
    throw new Error("Kasowanie w magazynie nie powiodło się. Nic więcej nie zostało skasowane.");
  }
  if (!res.ok) {
    console.error(`Kasowanie w magazynie nie powiodło się (${res.status}).`);
    throw new Error(`Kasowanie w magazynie nie powiodło się (${res.status}).`);
  }
}

function blobStamp(blob: BlobMeta) {
  const value = typeof blob.uploadedAt === "number" ? blob.uploadedAt : Date.parse(String(blob.uploadedAt ?? ""));
  return Number.isFinite(value) ? value : 0;
}

function readUrl(blob: BlobMeta) {
  return blob.downloadUrl || blob.url || "";
}

function isNumberedJournal(pathname: string) {
  return /\/\d+\.json$/.test(pathname);
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

function stamped(doc: SiteEdits) {
  const body = canonicalEdits(doc);
  return { text: JSON.stringify({ ...JSON.parse(body), sha: payloadSha(body) }), sha: payloadSha(body) };
}

function unwrapDoc(raw: unknown): SiteEdits {
  const opened = openJson(raw);
  if (!opened || typeof opened !== "object") return parseDoc({});
  const record = { ...(opened as Record<string, unknown>) };
  const sha = typeof record.sha === "string" ? record.sha : "";
  delete record.sha;
  const doc = parseDoc(record as Partial<SiteEdits>);
  if (sha && payloadSha(canonicalEdits(doc)) !== sha) throw new Error("Kopia jest uszkodzona.");
  return doc;
}

function revisionFromPath(pathname: string) {
  const match = /(\d+)\.json$/.exec(pathname);
  return match ? Number(match[1]) : 0;
}

function padRevision(revision: number) {
  return String(revision).padStart(8, "0");
}

async function fetchJson(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Odczyt treści nie powiódł się (${res.status}).`);
  return (await res.json()) as unknown;
}

async function fetchDoc(url: string) {
  return unwrapDoc(await fetchJson(url));
}

function highestRevision(blobs: BlobMeta[]) {
  return blobs
    .filter((blob) => blob.pathname && isNumberedJournal(blob.pathname) && readUrl(blob))
    .sort((a, b) => revisionFromPath(String(b.pathname)) - revisionFromPath(String(a.pathname)))[0];
}

async function readPointer(prefix: string): Promise<{ revision: number; url: string; sha: string } | null> {
  const latest = highestRevision(await blobList(prefix));
  if (!latest) return null;
  const opened = openJson(await fetchJson(readUrl(latest)));
  if (!opened || typeof opened !== "object") return null;
  const pointer = opened as { url?: unknown; sha?: unknown };
  if (typeof pointer.url !== "string" || !pointer.url) return null;
  return {
    revision: revisionFromPath(String(latest.pathname)),
    url: pointer.url,
    sha: typeof pointer.sha === "string" ? pointer.sha : "",
  };
}

async function readAny(blobs: BlobMeta[]): Promise<{ doc: SiteEdits | null; saw: boolean }> {
  let saw = false;
  for (const blob of blobs) {
    const url = readUrl(blob);
    if (!url) continue;
    saw = true;
    try {
      return { doc: await fetchDoc(url), saw: true };
    } catch (error) {
      throwIfUncertain(error);
    }
  }
  return { doc: null, saw };
}

async function loadLegacy(): Promise<SiteEdits | null> {
  const docs = (await blobList(DOCS))
    .filter((blob) => blob.pathname && readUrl(blob))
    .sort((a, b) => blobStamp(b) - blobStamp(a) || String(b.pathname).localeCompare(String(a.pathname)));
  const fromDocs = await readAny(docs);
  if (fromDocs.doc) return fromDocs.doc;
  const legacy = await blobHead(DOC);
  if (!legacy || !readUrl(legacy)) {
    if (fromDocs.saw) throw new Error("Aktywna treść jest uszkodzona.");
    return null;
  }
  try {
    return await fetchDoc(readUrl(legacy));
  } catch (error) {
    throwIfUncertain(error);
    throw new Error("Aktywna treść jest uszkodzona.");
  }
}

async function loadPrivateFresh(): Promise<SiteEdits> {
  let saw = false;
  const journals = (await blobList(JOURNAL_PRIVATE))
    .filter((blob) => blob.pathname && isNumberedJournal(blob.pathname) && readUrl(blob))
    .sort((a, b) => revisionFromPath(String(b.pathname)) - revisionFromPath(String(a.pathname)));
  for (const blob of journals) {
    saw = true;
    try {
      const opened = openJson(await fetchJson(readUrl(blob)));
      if (!opened || typeof opened !== "object") throw new Error("Kopia jest uszkodzona.");
      const url = (opened as { url?: unknown }).url;
      if (typeof url !== "string" || !url) throw new Error("Kopia jest uszkodzona.");
      return await fetchDoc(url);
    } catch (error) {
      throwIfUncertain(error);
    }
  }
  const sorted = (await blobList(PRIVATE_DOCS))
    .filter((blob) => blob.pathname && readUrl(blob))
    .sort((a, b) => blobStamp(b) - blobStamp(a) || String(b.pathname).localeCompare(String(a.pathname)));
  const fromPrivate = await readAny(sorted);
  if (fromPrivate.doc) return fromPrivate.doc;
  saw = saw || fromPrivate.saw;
  try {
    const legacy = await loadLegacy();
    if (legacy) return legacy;
  } catch (error) {
    if (error instanceof Error && error.message === "Aktywna treść jest uszkodzona.") throw error;
    throwIfUncertain(error);
    saw = true;
  }
  if (saw) throw new Error("Aktywna treść jest uszkodzona.");
  return empty();
}

async function writePublicPointer(revision: number, url: string, sha: string) {
  try {
    const head = await blobHead(PUBLIC_CURRENT);
    if (head && readUrl(head)) {
      const prev = (await fetchJson(readUrl(head))) as { revision?: unknown };
      if (typeof prev.revision === "number" && prev.revision > revision) return;
    }
    await blobPut(PUBLIC_CURRENT, JSON.stringify({ revision, url, sha }), "application/json");
  } catch {
    // Dziennik publiczny jest już zapisany. Odczyt bierze najwyższy numer, nie ten skrót.
    // Skrót nie cofa strony, nawet gdy jego zapis się nie uda albo spóźni.
  }
}

async function loadPublic(): Promise<SiteEdits> {
  if (publicCache && Date.now() - publicCache.at < PUBLIC_CACHE_MS) return publicCache.data;
  try {
    const journals = (await blobList(JOURNAL_PUBLIC))
      .filter((blob) => blob.pathname && isNumberedJournal(blob.pathname) && readUrl(blob))
      .sort((a, b) => revisionFromPath(String(b.pathname)) - revisionFromPath(String(a.pathname)));
    const newest = selectPublicRevision(journals.map((blob) => revisionFromPath(String(blob.pathname))));
    // current.json nie rozstrzyga. Brak pliku N+1 nie znaczy, że nie ma N+2.
    for (const blob of journals) {
      const revision = revisionFromPath(String(blob.pathname));
      if (newest === null || revision > newest) continue;
      try {
        const pointer = (await fetchJson(readUrl(blob))) as { url?: string };
        if (!pointer?.url) {
          if (revision === newest) throw new Error("Kopia jest uszkodzona.");
          continue;
        }
        const doc = toPublicDoc(await fetchDoc(pointer.url));
        publicCache = { at: Date.now(), data: doc };
        return doc;
      } catch (error) {
        if (publicJournalFailure(revision === newest, error) === "stop") {
          throwIfUncertain(error);
          throw new Error(STORE_OUTAGE);
        }
      }
    }
    const pubs = (await blobList(PUBLIC_DOCS))
      .filter((blob) => blob.pathname && readUrl(blob))
      .sort((a, b) => blobStamp(b) - blobStamp(a) || String(b.pathname).localeCompare(String(a.pathname)));
    const fromPublic = await readAny(pubs);
    if (fromPublic.doc) {
      const doc = toPublicDoc(fromPublic.doc);
      publicCache = { at: Date.now(), data: doc };
      return doc;
    }
    let legacy: SiteEdits | null = null;
    try {
      legacy = await loadLegacy();
    } catch (error) {
      if (readFailureAction(error) === "stop") throw error instanceof Error ? error : new Error(STORE_OUTAGE);
      if (journals.length || fromPublic.saw) throw new Error("Aktywna treść jest uszkodzona.");
      throw error;
    }
    if (!legacy && (journals.length || fromPublic.saw)) throw new Error("Aktywna treść jest uszkodzona.");
    const doc = toPublicDoc(legacy ?? empty());
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

async function writeEdits(doc: SiteEdits, afterPrivate?: (written: SiteEdits) => Promise<void>) {
  if (!sealConfigured()) {
    throw new Error("Brak klucza szyfrowania CMS. Ustaw CMS_SEAL_KEY w Vercel. Zapis został zatrzymany.");
  }
  const lockPath = `${LOCKS}${doc.revision}.lock`;
  const lockUrl = await claimLock(doc.revision);
  const next: SiteEdits = { ...doc, revision: doc.revision + 1 };
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const privatePath = `${PRIVATE_DOCS}${id}.json`;
  const publicPath = `${PUBLIC_DOCS}${id}.json`;
  const privateStamp = stamped(next);
  const published = toPublicDoc(parseDoc(next));
  const publicStamp = stamped(published);
  let privateUrl = "";
  let publicUrl = "";
  try {
    let freshRevision: number | null = null;
    let damaged = false;
    try {
      freshRevision = (await loadPrivateFresh()).revision;
    } catch (error) {
      if (writeAfterReread(error instanceof Error ? error : new Error(STORE_OUTAGE), null, doc.revision) !== "write") {
        throw error instanceof Error ? error : new Error(STORE_OUTAGE);
      }
      damaged = true;
    }
    if (!damaged && writeAfterReread(null, freshRevision, doc.revision) === "conflict") {
      throw new Error("Ktoś zapisał w międzyczasie. Odśwież stronę.");
    }
    privateUrl = (await blobPut(privatePath, sealJson(privateStamp.text), "application/json")).url;
    const check = await fetchDoc(privateUrl);
    if (check.revision !== next.revision) throw new Error("Kopia prywatna nie zgadza się.");
    if (afterPrivate) await afterPrivate(check);
    publicUrl = (await blobPut(publicPath, publicStamp.text, "application/json")).url;
    const publicCheck = await fetchDoc(publicUrl);
    if (publicCheck.revision !== next.revision) throw new Error("Kopia publiczna nie zgadza się.");
    await blobPut(
      `${JOURNAL_PRIVATE}${padRevision(next.revision)}.json`,
      sealJson(JSON.stringify({ revision: next.revision, url: privateUrl, sha: privateStamp.sha })),
      "application/json",
    );
    await blobPut(
      `${JOURNAL_PUBLIC}${padRevision(next.revision)}.json`,
      JSON.stringify({ revision: next.revision, url: publicUrl, sha: publicStamp.sha }),
      "application/json",
    );
    await writePublicPointer(next.revision, publicUrl, publicStamp.sha);
    publicCache = { at: Date.now(), data: published };
  } catch (error) {
    if (lockUrl) await blobDelete([lockUrl]);
    throw error;
  }
  try {
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

async function storeSealedImage(id: string, dataUrl: string) {
  const match = /^data:image\/(?:jpeg|png|webp);base64,([a-z0-9+/=\s]+)$/i.exec(dataUrl);
  if (!match) throw new Error("To nie jest zdjęcie.");
  const bytes = Buffer.from(match[1].replace(/\s/g, ""), "base64");
  if (bytes.length < 32 || bytes.length > 2_500_000 || !imageKind(bytes)) throw new Error("Zdjęcie jest za duże.");
  const safe = id.replace(/[^a-z0-9_-]/gi, "").slice(0, 80) || "obraz";
  const blob = await blobPut(
    `${SEALED_IMAGES}${safe}-${Date.now()}.json`,
    sealJson(JSON.stringify({ dataUrl })),
    "application/json",
  );
  return `seal:${blob.url}`;
}

async function publishSealedImage(ref: string) {
  const opened = openJson(await fetchJson(ref.slice(5))) as { dataUrl?: string };
  if (!opened?.dataUrl) throw new Error("Nie da się odczytać zdjęcia szkicu.");
  return storeImageBytes("img.herb", opened.dataUrl);
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
  return sniffImage(bytes);
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
    next.image =
      next.status === "published"
        ? await storeImageBytes(`img.herb.${next.slug}`, next.image)
        : await storeSealedImage(`img.herb.${next.slug}`, next.image);
  } else if (next.image.startsWith("seal:") && next.status === "published") {
    next.image = await publishSealedImage(next.image);
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
  const journals = (await blobList(JOURNAL_PRIVATE))
    .filter((blob) => blob.pathname && isNumberedJournal(blob.pathname) && readUrl(blob))
    .sort((a, b) => revisionFromPath(String(b.pathname)) - revisionFromPath(String(a.pathname)));
  const previous = journals[1];
  if (previous) {
    const pointer = openJson(await fetchJson(readUrl(previous))) as { url?: string };
    if (!pointer.url) throw new Error("Nie ma starszej kopii.");
    const restored = await fetchDoc(pointer.url);
    restored.revision = current.revision;
    return { revision: await writeEdits(restored) };
  }
  const sorted = (await blobList(PRIVATE_DOCS))
    .filter((blob) => blob.pathname && readUrl(blob))
    .sort((a, b) => blobStamp(b) - blobStamp(a) || String(b.pathname).localeCompare(String(a.pathname)));
  const legacy = sorted[1];
  if (!legacy) throw new Error("Nie ma starszej kopii.");
  const restored = await fetchDoc(readUrl(legacy));
  restored.revision = current.revision;
  return { revision: await writeEdits(restored) };
}

async function healPublic() {
  const priv = await readPointer(JOURNAL_PRIVATE);
  const pub = await readPointer(JOURNAL_PUBLIC);
  if (!priv || (pub && pub.revision >= priv.revision)) return;
  const doc = await fetchDoc(priv.url);
  const published = toPublicDoc(parseDoc(doc));
  const stamp = stamped(published);
  const saved = await blobPut(`${PUBLIC_DOCS}heal-${Date.now()}.json`, stamp.text, "application/json");
  await blobPut(
    `${JOURNAL_PUBLIC}${padRevision(doc.revision)}.json`,
    JSON.stringify({ revision: doc.revision, url: saved.url, sha: stamp.sha }),
    "application/json",
  );
  await writePublicPointer(doc.revision, saved.url, stamp.sha);
  publicCache = { at: Date.now(), data: published };
}

async function expandSealedImages(doc: SiteEdits) {
  const entries = await Promise.all(
    doc.entries.map(async (entry) => {
      if (!entry.image.startsWith("seal:")) return entry;
      try {
        const opened = openJson(await fetchJson(entry.image.slice(5))) as { dataUrl?: string };
        return opened.dataUrl ? { ...entry, image: opened.dataUrl } : entry;
      } catch {
        return entry;
      }
    }),
  );
  return { ...doc, entries };
}

export async function readEditorDoc() {
  try {
    await healPublic();
  } catch {
    // Prywatna kopia zostaje. Publiczna dogoni się przy kolejnym zapisie.
  }
  return expandSealedImages(await readForWrite());
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

export async function backupStatus() {
  try {
    const head = await blobHead(`${BACKUPS}status.json`);
    if (!head || !readUrl(head)) return { ok: false, at: "", revision: 0, kind: "" };
    const data = (await fetchJson(readUrl(head))) as { ok?: boolean; at?: string; revision?: number; kind?: string };
    return {
      ok: Boolean(data.ok),
      at: data.at || "",
      revision: typeof data.revision === "number" ? data.revision : 0,
      kind: data.kind || "",
    };
  } catch {
    return { ok: false, at: "", revision: 0, kind: "" };
  }
}

export async function listBackupRows() {
  const rows: { id: string; at: string; kind: string; revision: number }[] = [];
  const journals = await blobList(JOURNAL_PRIVATE);
  for (const blob of journals) {
    const pathname = blob.pathname || "";
    if (!pathname || !isNumberedJournal(pathname)) continue;
    rows.push({
      id: pathname,
      at: new Date(blobStamp(blob) || Date.now()).toISOString(),
      kind: "zapis",
      revision: revisionFromPath(pathname),
    });
  }
  const backups = [
    ...(await blobList(`${BACKUPS}daily/`)),
    ...(await blobList(`${BACKUPS}monthly/`)),
    ...(await blobList(`${BACKUPS}manual/`)),
  ];
  for (const blob of backups) {
    const pathname = blob.pathname || "";
    if (!pathname || pathname.endsWith("status.json") || pathname.includes("/parts/")) continue;
    const kind = pathname.includes("/daily/") ? "dzienna" : pathname.includes("/monthly/") ? "miesięczna" : "ręczna";
    rows.push({
      id: pathname,
      at: new Date(blobStamp(blob) || Date.now()).toISOString(),
      kind,
      revision: 0,
    });
  }
  return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40);
}

async function bytesForRef(ref: string): Promise<Buffer | null> {
  if (bundledAsset(ref)) return null;
  if (ref.startsWith("data:")) return parseDataUrl(ref)?.bytes ?? null;
  if (ref.startsWith("seal:")) {
    try {
      const opened = openJson(await fetchJson(ref.slice(5))) as { dataUrl?: string };
      return opened?.dataUrl ? parseDataUrl(opened.dataUrl)?.bytes ?? null : null;
    } catch {
      return null;
    }
  }
  if (ref.startsWith("https://") || ref.startsWith("http://")) {
    try {
      const res = await fetch(ref, { cache: "no-store" });
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch {
      return null;
    }
  }
  return null;
}

async function filesForDoc(doc: SiteEdits): Promise<BackupFile[]> {
  const files: BackupFile[] = [];
  for (const plan of plannedRefs(doc as BackupDoc)) {
    const bytes = await bytesForRef(plan.ref);
    const file = bytes ? fileFromBytes(plan.ref, plan.use, bytes) : null;
    if (!file) throw new Error("Nie udało się dołączyć zdjęcia. Kopia nie została uznana za dobrą.");
    files.push(file);
  }
  return files;
}

async function putBackupImage(file: BackupFile) {
  const bytes = Buffer.from(file.base64, "base64");
  const made = fileFromBytes(file.ref, file.use, bytes);
  if (!made || made.sha256 !== file.sha256) throw new Error("Plik zdjęcia nie zgadza się z manifestem.");
  if (imageGoesToPrivateStore(file.use)) {
    const ref = await storeSealedImage(`restore-${file.sha256.slice(0, 12)}`, `data:${file.mime};base64,${file.base64}`);
    if (!ref.startsWith("seal:")) throw new Error("Zdjęcie szkicu wyszło poza prywatny magazyn. Strona nie została podmieniona.");
    return ref;
  }
  const ext = file.mime === "image/png" ? "png" : file.mime === "image/webp" ? "webp" : "jpg";
  const blob = await blobPut(`zielarka/images/restore-${file.sha256.slice(0, 16)}.${ext}`, bytes, file.mime);
  return blob.url;
}

async function revisionHint() {
  try {
    const top = highestRevision(await blobList(JOURNAL_PRIVATE));
    return top ? revisionFromPath(String(top.pathname)) : 0;
  } catch {
    return 0;
  }
}

function sessionOk(session: string) {
  return /^[a-f0-9]{32}$/.test(session);
}

function shaOk(sha256: string) {
  return /^[a-f0-9]{64}$/.test(sha256);
}

async function readSealed(url: string) {
  return openJson(await fetchJson(url));
}

async function findPart(sha256: string, slice: number, kid = "") {
  for (const pathname of partCandidates(sha256, slice, kid)) {
    const head = await blobHead(pathname);
    if (head && readUrl(head)) return head;
  }
  return null;
}

async function storeSlice(sha256: string, slice: number, slices: number, bytes: Buffer) {
  const kid = activeSealKid();
  const envelope = sliceEnvelope(sha256, slice, slices, bytes);
  const sealed = sealJson(envelope);
  if (sealed.length > SERVER_PAYLOAD_LIMIT) {
    throw new Error("Jedno zdjęcie nie mieści się w limicie Vercel. Kopia nie została uznana za dobrą.");
  }
  const pathname = partPath(sha256, slice, kid);
  const existing = await blobHead(pathname);
  if (existing && readUrl(existing)) {
    try {
      const raw = await fetchJson(readUrl(existing));
      const storedKid = raw && typeof raw === "object" ? (raw as { kid?: unknown }).kid : "";
      if (canReuseSlice(storedKid, kid)) {
        const opened = openJson(raw) as { sha256?: string; slice?: number; base64?: string };
        const got = Buffer.from(opened.base64 || "", "base64");
        if (opened.sha256 === sha256 && opened.slice === slice && got.equals(bytes)) return pathname;
      }
    } catch (error) {
      throwIfUncertain(error);
    }
  }
  const saved = await blobPut(pathname, sealed, "application/json");
  const opened = (await readSealed(saved.url)) as { sha256?: string; slice?: number; base64?: string };
  const got = Buffer.from(opened.base64 || "", "base64");
  if (opened.sha256 !== sha256 || opened.slice !== slice || !got.equals(bytes)) {
    throw new Error("Część kopii nie przeszła sprawdzenia. Kopia nie została uznana za dobrą.");
  }
  return pathname;
}

async function storeFileParts(file: BackupFile) {
  const bytes = Buffer.from(file.base64, "base64");
  if (sha256Bytes(bytes) !== file.sha256) throw new Error("Plik zdjęcia nie zgadza się z manifestem.");
  const slices = sliceBytes(bytes);
  for (let index = 0; index < slices.length; index += 1) {
    const slice = slices[index];
    if (!slice) continue;
    await storeSlice(file.sha256, index, slices.length, slice);
  }
  return slices.length;
}

async function readFileParts(sha256: string, slices: number, kid = "") {
  const parts: { slice: number; slices: number; base64: string }[] = [];
  for (let index = 0; index < slices; index += 1) {
    const head = await findPart(sha256, index, kid);
    if (!head || !readUrl(head)) throw new Error("W kopii brakuje pliku zdjęcia. Nic nie zostało podmienione.");
    const opened = (await readSealed(readUrl(head))) as { sha256?: string; slice?: number; slices?: number; base64?: string };
    if (opened.sha256 !== sha256 || opened.slice !== index || opened.slices !== slices || typeof opened.base64 !== "string") {
      throw new Error("Plik zdjęcia w kopii jest uszkodzony. Nic nie zostało podmienione.");
    }
    parts.push({ slice: index, slices, base64: opened.base64 });
  }
  const base64 = joinSliceText(parts);
  if (sha256Bytes(Buffer.from(base64, "base64")) !== sha256) {
    throw new Error("Plik zdjęcia w kopii jest uszkodzony. Nic nie zostało podmienione.");
  }
  return base64;
}

async function materializeBackup(opened: unknown): Promise<unknown> {
  if (!opened || typeof opened !== "object" || (opened as { format?: unknown }).format !== 3) return opened;
  const manifest = opened as BackupManifest;
  const bins: { sha256: string; base64: string }[] = [];
  for (const file of manifest.files || []) {
    if (!shaOk(file.sha256) || !Number.isInteger(file.slices) || file.slices < 1) {
      throw new Error("W kopii brakuje pliku zdjęcia. Nic nie zostało podmienione.");
    }
    bins.push({ sha256: file.sha256, base64: await readFileParts(file.sha256, file.slices, typeof file.kid === "string" ? file.kid : "") });
  }
  const attached = attachManifestParts(manifest, bins);
  if (!attached.ok) throw new Error(attached.error);
  return attached.payload;
}

async function referencedShas(blob: BlobMeta) {
  const url = readUrl(blob);
  if (!url) throw new Error("Nie da się odczytać zachowanej kopii. Przycinanie zostało zatrzymane.");
  const opened = await readSealed(url);
  if (!opened || typeof opened !== "object") throw new Error("Nie da się odczytać zachowanej kopii. Przycinanie zostało zatrzymane.");
  const record = opened as { format?: unknown; files?: { sha256?: unknown }[] };
  if (!Array.isArray(record.files)) {
    if (record.format === 3) throw new Error("Nie da się odczytać zachowanej kopii. Przycinanie zostało zatrzymane.");
    return [] as string[];
  }
  const shas: string[] = [];
  for (const file of record.files) {
    if (typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256)) {
      throw new Error("Nie da się odczytać zachowanej kopii. Przycinanie zostało zatrzymane.");
    }
    shas.push(file.sha256);
  }
  return shas;
}

async function pruneInbox(activeSession = "") {
  const blobs = await blobList(INBOX);
  const urls = expiredInboxUrls(
    blobs.map((blob) => ({
      pathname: blob.pathname || "",
      url: blob.url || blob.downloadUrl || "",
      uploadedAt: blobStamp(blob),
    })),
    Date.now(),
    activeSession,
  );
  await blobDelete(urls);
}

async function pruneBackups(protect: string[]) {
  const blobs = await blobList(BACKUPS);
  const manifests = blobs.filter((blob) => {
    const pathname = blob.pathname || "";
    return pathname && !pathname.includes("/parts/") && !pathname.endsWith("status.json") && !pathname.endsWith("/current.json");
  });
  const protectPaths = [...new Set(protect.filter(Boolean))];
  for (const path of protectPaths) {
    if (!manifests.some((blob) => blob.pathname === path)) {
      throw new Error("Chroniona kopia nie jest na kompletnej liście. Nic nie zostało skasowane.");
    }
  }
  const described = [];
  for (const blob of manifests) {
    described.push({
      pathname: blob.pathname || "",
      url: blob.url || "",
      uploadedAt: blobStamp(blob),
      shas: await referencedShas(blob),
    });
  }
  const parts = blobs.flatMap((blob) => {
    const match = /\/parts\/([a-f0-9]{64})\//.exec(blob.pathname || "");
    if (!match?.[1]) return [];
    return [{ url: blob.url || "", downloadUrl: blob.downloadUrl || "", sha256: match[1] }];
  });
  const plan = planBackupRetention({ manifests: described, parts, protectPathnames: protectPaths });
  await blobDelete(plan.deleteUrls);
}

async function readBackupRaw(id: string) {
  if (!id.startsWith("zielarka/") || id.includes("..")) throw new Error("Nie ma takiej kopii.");
  const allowed = id.startsWith(JOURNAL_PRIVATE) || id.startsWith(BACKUPS);
  if (!allowed || id.includes("/parts/") || id.endsWith("status.json")) throw new Error("Nie ma takiej kopii.");
  const found = await blobHead(id);
  if (!found || !readUrl(found)) throw new Error("Nie ma takiej kopii.");
  const opened = openJson(await fetchJson(readUrl(found)));
  if (opened && typeof opened === "object" && "url" in opened && !("doc" in opened) && !("format" in opened)) {
    const url = (opened as { url?: string }).url;
    if (!url) throw new Error("Kopia jest uszkodzona.");
    return materializeBackup(openJson(await fetchJson(url)));
  }
  return materializeBackup(opened);
}

async function runRecover(raw: unknown, expectedRevision: number, phrase: string, protectPath: string) {
  const result = await recoverBackup({
    phrase,
    expectedRevision,
    raw,
    readCurrent: async () => {
      try {
        return (await readForWrite()) as BackupDoc;
      } catch {
        return null;
      }
    },
    revisionHint,
    snapshot: async () => {
      await createVerifiedBackup("manual", protectPath ? [protectPath] : []);
    },
    legacyFiles: async (doc) => {
      try {
        return await filesForDoc(doc as SiteEdits);
      } catch {
        return null;
      }
    },
    putImage: putBackupImage,
    prepare: (doc) => parseDoc(doc as SiteEdits) as BackupDoc,
    writeDoc: async (doc, check) => {
      const parsed = parseDoc(doc as SiteEdits);
      return writeEdits(parsed, async (written) => {
        await check(written as BackupDoc);
      });
    },
    readBack: async () => (await readForWrite()) as BackupDoc,
    readImage: bytesForRef,
  });
  if (!result.ok) throw new Error(result.message);
  return result;
}

export async function createVerifiedBackup(kind: "manual" | "daily" | "monthly", protect: string[] = []) {
  if (!sealConfigured()) {
    throw new Error("Brak klucza szyfrowania CMS. Ustaw CMS_SEAL_KEY w Vercel. Kopia nie została zapisana.");
  }
  const doc = await readForWrite();
  const files = await filesForDoc(doc);
  const at = new Date().toISOString();
  const payload = buildPayload(kind, at, doc as BackupDoc, files);
  for (const file of payload.files) await storeFileParts(file);
  const kid = activeSealKid();
  const manifest = toManifest(payload);
  manifest.sealKid = kid;
  for (const file of manifest.files) file.kid = kid;
  const sealed = sealJson(JSON.stringify(manifest));
  if (sealed.length > SERVER_PAYLOAD_LIMIT) {
    throw new Error("Manifest kopii jest zbyt duży. Kopia nie została uznana za dobrą.");
  }
  const name =
    kind === "daily"
      ? `${BACKUPS}daily/${at.slice(0, 10)}.json`
      : kind === "monthly"
        ? `${BACKUPS}monthly/${at.slice(0, 7)}.json`
        : `${BACKUPS}manual/${Date.now()}.json`;
  const saved = await blobPut(name, sealed, "application/json");
  const opened = (await readSealed(saved.url)) as BackupManifest;
  if (!opened?.docSha || opened.docSha !== payload.docSha || opened.format !== 3 || opened.sealKid !== kid) {
    throw new Error("Kopia nie przeszła sprawdzenia. Nic nie zostało podmienione.");
  }
  if ((opened.files || []).some((file) => file.kid !== kid)) {
    throw new Error("Kopia nie zapisuje, którego klucza potrzebuje. Nic nie zostało podmienione.");
  }
  const bins: { sha256: string; base64: string }[] = [];
  for (const file of opened.files || []) {
    bins.push({
      sha256: file.sha256,
      base64: await readFileParts(file.sha256, file.slices, typeof file.kid === "string" ? file.kid : ""),
    });
  }
  const confirmed = confirmBackupRoundtrip(payload, opened, bins);
  if (!confirmed.ok) throw new Error(confirmed.error);
  const offsite = offsiteDecision(process.env.ZIELARKA_OFFSITE || "");
  if (offsite.sent || offsiteExportAllowed(process.env.ZIELARKA_OFFSITE_APPROVED || "", process.env.ZIELARKA_OFFSITE || "")) {
    console.error("Zewnętrzna kopia nie jest podłączona. Nic nie wysłano.");
  }
  const status = {
    ok: true,
    checked: true,
    at,
    revision: doc.revision,
    kind,
    sha: payload.docSha,
    images: files.length,
    offsite: false as const,
  };
  await blobPut(`${BACKUPS}status.json`, JSON.stringify(status), "application/json");
  try {
    await pruneBackups(protect);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Przycinanie kopii zostało zatrzymane.");
  }
  try {
    await pruneInbox();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Czyszczenie porzuconych wgrań zostało zatrzymane.");
  }
  return {
    ok: true as const,
    at,
    revision: doc.revision,
    kind,
    filename: `zielarka-kopia-${at.slice(0, 10)}.json`,
    sealedManifest: sealed,
    parts: manifest.files.flatMap((file) =>
      Array.from({ length: file.slices }, (_, slice) => ({ sha256: file.sha256, slice })),
    ),
  };
}

export async function downloadBackup() {
  const saved = await createVerifiedBackup("manual");
  return {
    filename: saved.filename,
    sealedManifest: saved.sealedManifest,
    parts: saved.parts,
  };
}

export async function downloadBackupPart(sha256: string, slice: number) {
  if (!shaOk(sha256) || !Number.isInteger(slice) || slice < 0 || slice > 1000) {
    throw new Error("Nie ma takiej części kopii.");
  }
  const head = await findPart(sha256, slice, activeSealKid());
  if (!head || !readUrl(head)) throw new Error("Nie ma takiej części kopii.");
  const res = await fetch(readUrl(head), { cache: "no-store" });
  if (!res.ok) throw new Error("Nie ma takiej części kopii.");
  const stored = await res.text();
  if (!stored || stored.length > SERVER_PAYLOAD_LIMIT) {
    throw new Error("Część kopii nie mieści się w limicie Vercel.");
  }
  const opened = openJson(JSON.parse(stored)) as { sha256?: string; slice?: number };
  if (opened.sha256 !== sha256 || opened.slice !== slice) throw new Error("Część kopii jest uszkodzona.");
  const sealed = sealJson(JSON.stringify(opened));
  if (!sealed || sealed.length > SERVER_PAYLOAD_LIMIT) {
    throw new Error("Część kopii nie mieści się w limicie Vercel.");
  }
  return { sha256, slice, sealed };
}

export async function beginRestoreUpload(sealedManifest: string) {
  if (sealedManifest.length > SERVER_PAYLOAD_LIMIT) {
    throw new Error("Manifest kopii jest zbyt duży. Nic nie zostało podmienione.");
  }
  try {
    await pruneInbox();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Czyszczenie porzuconych wgrań zostało zatrzymane.");
  }
  let manifest: BackupManifest;
  try {
    manifest = openJson(JSON.parse(sealedManifest)) as BackupManifest;
  } catch {
    throw new Error("Plik kopii jest nieczytelny. Nic nie zostało podmienione.");
  }
  if (!manifest || manifest.format !== 3 || !Array.isArray(manifest.files)) {
    throw new Error("Kopia jest uszkodzona. Nic nie zostało podmienione.");
  }
  const session = randomBytes(16).toString("hex");
  const saved = await blobPut(`${INBOX}${session}/manifest.json`, sealJson(JSON.stringify(manifest)), "application/json");
  const opened = (await readSealed(saved.url)) as BackupManifest;
  if (opened.docSha !== manifest.docSha || opened.files.length !== manifest.files.length) {
    throw new Error("Manifest kopii nie dał się odczytać. Nic nie zostało podmienione.");
  }
  return { session, parts: manifest.files.reduce((sum, file) => sum + file.slices, 0) };
}

export async function saveRestorePart(session: string, sealed: string) {
  if (!sessionOk(session)) throw new Error("Nie ma takiego wgrywania. Nic nie zostało podmienione.");
  if (sealed.length > SERVER_PAYLOAD_LIMIT) {
    throw new Error("Część kopii jest za duża na jedno przesłanie. Nic nie zostało podmienione.");
  }
  let opened: { sha256?: string; slice?: number; slices?: number; base64?: string };
  try {
    opened = openJson(JSON.parse(sealed)) as { sha256?: string; slice?: number; slices?: number; base64?: string };
  } catch {
    throw new Error("Część kopii jest nieczytelna. Nic nie zostało podmienione.");
  }
  if (!opened.sha256 || !shaOk(opened.sha256) || !Number.isInteger(opened.slice) || !Number.isInteger(opened.slices)) {
    throw new Error("Część kopii jest uszkodzona. Nic nie zostało podmienione.");
  }
  const pathname = `${INBOX}${session}/${opened.sha256}/${opened.slice}.json`;
  const saved = await blobPut(pathname, sealJson(JSON.stringify(opened)), "application/json");
  const check = (await readSealed(saved.url)) as { sha256?: string; slice?: number };
  if (check.sha256 !== opened.sha256 || check.slice !== opened.slice) {
    throw new Error("Część kopii nie dała się odczytać. Nic nie zostało podmienione.");
  }
  return { sha256: opened.sha256, slice: opened.slice };
}

export async function finishRestoreUpload(session: string, expectedRevision: number, phrase: string) {
  if (!sessionOk(session)) throw new Error("Nie ma takiego wgrywania. Nic nie zostało podmienione.");
  const head = await blobHead(`${INBOX}${session}/manifest.json`);
  if (!head || !readUrl(head)) throw new Error("Brak manifestu kopii. Nic nie zostało podmienione.");
  const manifest = (await readSealed(readUrl(head))) as BackupManifest;
  const bins: { sha256: string; base64: string }[] = [];
  for (const file of manifest.files || []) {
    const parts: { slice: number; slices: number; base64: string }[] = [];
    for (let index = 0; index < file.slices; index += 1) {
      const part = await blobHead(`${INBOX}${session}/${file.sha256}/${index}.json`);
      if (!part || !readUrl(part)) throw new Error("W kopii brakuje pliku zdjęcia. Nic nie zostało podmienione.");
      const opened = (await readSealed(readUrl(part))) as { slice?: number; slices?: number; base64?: string };
      if (opened.slice !== index || typeof opened.base64 !== "string") {
        throw new Error("Plik zdjęcia w kopii jest uszkodzony. Nic nie zostało podmienione.");
      }
      parts.push({ slice: index, slices: file.slices, base64: opened.base64 });
    }
    bins.push({ sha256: file.sha256, base64: joinSliceText(parts) });
  }
  const attached = attachManifestParts(manifest, bins);
  if (!attached.ok) throw new Error(attached.error);
  const restored = await runRecover(attached.payload, expectedRevision, phrase, "");
  try {
    const leftovers = await blobList(`${INBOX}${session}/`);
    await blobDelete(leftovers.flatMap((blob) => [blob.url || "", blob.downloadUrl || ""]));
  } catch {
    // Skrzynka tego wgrywania zostaje. Kopia źródłowa i strona nie są przez to kasowane.
  }
  try {
    await pruneInbox(session);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Czyszczenie porzuconych wgrań zostało zatrzymane.");
  }
  return restored;
}

export async function restoreBackup(id: string, expectedRevision: number, phrase: string) {
  const raw = await readBackupRaw(id);
  return runRecover(raw, expectedRevision, phrase, id);
}

export async function restoreUploadedBackup(body: string, expectedRevision: number, phrase: string) {
  if (body.length > SERVER_PAYLOAD_LIMIT) {
    throw new Error("Ten plik jest za duży na jedno przesłanie. Użyj kopii podzielonej na części. Nic nie zostało podmienione.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("Plik kopii jest nieczytelny. Nic nie zostało podmienione.");
  }
  return runRecover(openJson(parsed), expectedRevision, phrase, "");
}

export async function runScheduledBackup(now = new Date()) {
  const daily = await createVerifiedBackup("daily");
  if (now.getUTCDate() === 1) await createVerifiedBackup("monthly");
  return daily;
}

export { herbs };
