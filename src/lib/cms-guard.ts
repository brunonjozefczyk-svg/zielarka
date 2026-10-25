export type StampBlob = { pathname: string; url: string; uploadedAt: number };
export type AttemptRow = { count: number; until: number };
export type KeptBlob = { pathname: string; url: string; uploadedAt: number; revision: number };

export function toPublicDoc<T extends { entries: { status: string; image?: string }[]; images?: Record<string, string> }>(
  doc: T,
): T {
  const images = doc.images
    ? Object.fromEntries(
        Object.entries(doc.images).filter(([, value]) => typeof value === "string" && !value.startsWith("seal:")),
      )
    : doc.images;
  return {
    ...doc,
    ...(doc.images ? { images } : {}),
    entries: doc.entries
      .filter((entry) => entry.status === "published")
      .map((entry) =>
        typeof entry.image === "string" && entry.image.startsWith("seal:") ? { ...entry, image: "" } : entry,
      ),
  };
}

export function assertRevision(current: number, expected: number) {
  if (!Number.isInteger(expected) || expected !== current) {
    throw new Error("Ktoś zapisał w międzyczasie. Odśwież stronę.");
  }
}

/** Keeps the newest copies. If the file just written is not in the list yet, deletes nothing. */
export function urlsToPrune(blobs: StampBlob[], keep: number, writtenPath: string) {
  if (!writtenPath || keep < 1) return [];
  const sorted = [...blobs].sort(
    (a, b) => b.uploadedAt - a.uploadedAt || b.pathname.localeCompare(a.pathname),
  );
  if (!sorted.some((blob) => blob.pathname === writtenPath)) return [];
  return sorted
    .slice(keep)
    .map((blob) => blob.url)
    .filter(Boolean);
}

/** 20 ostatnich zapisów, 30 dni i 12 miesięcy. Najnowsza kopia nigdy nie wypada. */
export function urlsToRetain(blobs: KeptBlob[]) {
  const sorted = [...blobs].sort((a, b) => b.revision - a.revision || b.uploadedAt - a.uploadedAt);
  if (!sorted.length) return [];
  const keep = new Set<string>();
  keep.add(sorted[0].pathname);
  for (const item of sorted.slice(0, 20)) keep.add(item.pathname);
  const days = new Set<string>();
  const months = new Set<string>();
  for (const item of sorted) {
    if (!Number.isFinite(item.uploadedAt) || item.uploadedAt <= 0) continue;
    const day = new Date(item.uploadedAt).toISOString().slice(0, 10);
    const month = day.slice(0, 7);
    if (!days.has(day) && days.size < 30) {
      days.add(day);
      keep.add(item.pathname);
    }
    if (!months.has(month) && months.size < 12) {
      months.add(month);
      keep.add(item.pathname);
    }
  }
  return sorted.filter((item) => !keep.has(item.pathname)).map((item) => item.url).filter(Boolean);
}

export function createAttemptLimiter(max = 8, windowMs = 15 * 60_000) {
  const rows = new Map<string, { count: number; until: number }>();
  return {
    blocked(key: string, now = Date.now()) {
      const row = rows.get(key);
      return Boolean(row && row.count >= max && row.until > now);
    },
    note(key: string, ok: boolean, now = Date.now()) {
      if (ok) {
        rows.delete(key);
        return;
      }
      const row = rows.get(key);
      if (!row || row.until <= now) {
        rows.set(key, { count: 1, until: now + windowMs });
        return;
      }
      row.count += 1;
      if (row.count >= max) row.until = now + windowMs;
    },
  };
}

export function attemptBlocked(row: AttemptRow | null, now = Date.now()) {
  return Boolean(row && row.count >= 8 && row.until > now);
}

export function nextAttempt(row: AttemptRow | null, ok: boolean, now = Date.now(), windowMs = 15 * 60_000) {
  if (ok) return { count: 0, until: 0 };
  if (!row || row.until <= now) return { count: 1, until: now + windowMs };
  const count = row.count + 1;
  return { count, until: count >= 8 ? now + windowMs : row.until };
}

export const LOCK_STALE_MS = 90_000;

/** True only when the store rejected the create because that path is already taken. */
export function blobConflict(status: number, body: string) {
  if (status === 409 || status === 412) return true;
  return /already exists|allowoverwrite|precondition failed|blob_already_exists/i.test(body);
}

export function lockDecision(
  status: number,
  body: string,
  ageMs: number | null,
): "claimed" | "busy" | "steal" | "fail" {
  if (status >= 200 && status < 300) return "claimed";
  if (!blobConflict(status, body)) return "fail";
  if (ageMs == null || ageMs >= LOCK_STALE_MS) return "steal";
  return "busy";
}

/** A store failure must not look like an empty database. */
export function publicFallback<T>(cached: T | null, error: unknown): T {
  if (cached) return cached;
  if (error instanceof Error) throw error;
  throw new Error("Magazyn treści jest chwilowo niedostępny.");
}

export function herbOutageAction(isBuiltin: boolean): "show-builtin" | "unavailable" {
  return isBuiltin ? "show-builtin" : "unavailable";
}

export function canonicalEdits(doc: {
  revision: number;
  copy: unknown;
  images: unknown;
  herbs: unknown;
  entries: unknown;
  theme: unknown;
  styles: unknown;
}) {
  return JSON.stringify({
    revision: doc.revision,
    copy: doc.copy,
    images: doc.images,
    herbs: doc.herbs,
    entries: doc.entries,
    theme: doc.theme,
    styles: doc.styles,
  });
}

export type MemStore = {
  lock: number | null;
  privateRev: number;
  publicRev: number;
  privateBody: string;
  publicBody: string;
};

/** Ten sam porządek co zapis w magazynie: publiczna wersja zmienia się na końcu. */
export function memWrite(
  mem: MemStore,
  expected: number,
  nextPrivate: string,
  nextPublic: string,
  failAt?: "private" | "public" | "public-commit",
): { ok: true; revision: number } | { ok: false; message: string } {
  const current = mem.privateRev;
  if (expected !== current || mem.lock === expected) {
    return { ok: false, message: "Ktoś zapisał w międzyczasie. Odśwież stronę." };
  }
  mem.lock = expected;
  if (failAt === "private") {
    mem.lock = null;
    return { ok: false, message: "Zapis nie powiódł się." };
  }
  const revision = expected + 1;
  mem.privateRev = revision;
  mem.privateBody = nextPrivate;
  if (failAt === "public" || failAt === "public-commit") {
    mem.lock = null;
    return { ok: false, message: "Zapis nie powiódł się." };
  }
  mem.publicRev = revision;
  mem.publicBody = nextPublic;
  mem.lock = null;
  return { ok: true, revision };
}

export function classifyLegacy(pathname: string, json: unknown): "plaintext-private" | "sealed" | "public" | "ignore" {
  if (pathname.startsWith("zielarka/public/") || pathname.startsWith("zielarka/journal/public/")) return "public";
  if (pathname.startsWith("zielarka/images/") || pathname.startsWith("zielarka/sealed-images/")) return "ignore";
  if (pathname.startsWith("zielarka/backups/") || pathname.startsWith("zielarka/locks/")) return "ignore";
  const privatePlace =
    pathname === "zielarka/content.json" ||
    pathname.startsWith("zielarka/docs/") ||
    pathname.startsWith("zielarka/private/") ||
    pathname.startsWith("zielarka/journal/private/");
  if (!privatePlace) return "ignore";
  const sealed = Boolean(json && typeof json === "object" && (json as { sealed?: unknown }).sealed === 1);
  return sealed ? "sealed" : "plaintext-private";
}

export function draftImageUrls(doc: { entries?: { status?: string; image?: string }[] }) {
  const urls: string[] = [];
  for (const entry of doc.entries ?? []) {
    if (entry.status === "published") continue;
    if (typeof entry.image === "string" && entry.image.startsWith("https://")) urls.push(entry.image);
  }
  return urls;
}

export function migrationAllowed(backupOk: boolean) {
  return backupOk;
}

export const RESTORE_PHRASE = "PRZYWRÓĆ";

export function restoreAllowed(phrase: string) {
  return phrase.trim() === RESTORE_PHRASE;
}
