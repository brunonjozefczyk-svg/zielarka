export type StampBlob = { pathname: string; url: string; uploadedAt: number };
export type AttemptRow = { count: number; until: number };

export function toPublicDoc<T extends { entries: { status: string }[] }>(doc: T): T {
  return {
    ...doc,
    entries: doc.entries.filter((entry) => entry.status === "published"),
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
