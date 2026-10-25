/**
 * Lista Vercel Blob: GET /api/blob?prefix&limit&cursor.
 * Kontrakt @vercel/blob: { blobs, hasMore, cursor? }. Domyślny limit strony to 1000.
 * Kolejność wyników nie jest gwarantowana, więc najnowszy plik może być na ostatniej stronie.
 * Niepełna lista nie wolno użyć do kasowania.
 */

export const BLOB_PAGE_LIMIT = 1000;
export const BLOB_LIST_MAX_PAGES = 200;

export type BlobListItem = {
  url?: string;
  downloadUrl?: string;
  pathname?: string;
  uploadedAt?: string | number;
};

export type BlobListPage = {
  blobs: BlobListItem[];
  cursor?: string;
  hasMore: boolean;
};

const INCOMPLETE = "Lista magazynu jest niepełna. Nic nie zostało skasowane.";

export function parseBlobListPage(data: unknown): { ok: true; page: BlobListPage } | { ok: false; error: string } {
  if (!data || typeof data !== "object") return { ok: false, error: INCOMPLETE };
  const row = data as { blobs?: unknown; cursor?: unknown; hasMore?: unknown };
  if (!Array.isArray(row.blobs)) return { ok: false, error: INCOMPLETE };
  if (typeof row.hasMore !== "boolean") return { ok: false, error: INCOMPLETE };
  for (const blob of row.blobs) {
    if (!blob || typeof blob !== "object") return { ok: false, error: INCOMPLETE };
  }
  if (row.hasMore && (typeof row.cursor !== "string" || !row.cursor)) return { ok: false, error: INCOMPLETE };
  return {
    ok: true,
    page: {
      blobs: row.blobs as BlobListItem[],
      hasMore: row.hasMore,
      cursor: typeof row.cursor === "string" ? row.cursor : undefined,
    },
  };
}

export async function listAllBlobs(
  fetchPage: (cursor: string | undefined) => Promise<unknown>,
  maxPages = BLOB_LIST_MAX_PAGES,
): Promise<BlobListItem[]> {
  const out: BlobListItem[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    let raw: unknown;
    try {
      raw = await fetchPage(cursor);
    } catch (error) {
      if (error instanceof Error && /Nie powiódł|skasowane|niepełna|zapętliła|za długa/i.test(error.message)) throw error;
      throw new Error("Odczyt listy magazynu nie powiódł się. Nic nie zostało skasowane.");
    }
    const parsed = parseBlobListPage(raw);
    if (!parsed.ok) throw new Error(parsed.error);
    out.push(...parsed.page.blobs);
    if (!parsed.page.hasMore) return out;
    const next = parsed.page.cursor || "";
    if (!next || seen.has(next)) throw new Error("Paginacja magazynu się zapętliła. Nic nie zostało skasowane.");
    seen.add(next);
    cursor = next;
  }
  throw new Error("Lista magazynu jest za długa. Nic nie zostało skasowane.");
}

export function newestRevisionPath(blobs: { pathname?: string }[]): string {
  let best = "";
  let revision = -1;
  for (const blob of blobs) {
    const pathname = blob.pathname || "";
    const match = /(\d+)\.json$/.exec(pathname);
    const value = match ? Number(match[1]) : -1;
    if (value >= revision) {
      revision = value;
      best = pathname;
    }
  }
  return best;
}

/** Pusta tablica, gdy lista nie jest kompletna. Kasowanie wymaga complete === true. */
export function urlsIfComplete(complete: boolean, urls: string[]): string[] {
  return complete ? urls.filter(Boolean) : [];
}
