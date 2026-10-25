export type StampBlob = { pathname: string; url: string; uploadedAt: number };

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
