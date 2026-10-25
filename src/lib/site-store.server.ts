import { timingSafeEqual } from "node:crypto";
import { herbs } from "./herbs";
import { builtinSlugs, type ManagedEntry, normalizeEntry, parseStoredEntry, slugify } from "./entries";

export type SiteEdits = {
  copy: Record<string, string>;
  images: Record<string, string>;
  herbs: Record<string, unknown>;
  entries: ManagedEntry[];
};

const DOC = "zielarka/content.json";

function empty(): SiteEdits {
  return { copy: {}, images: {}, herbs: {}, entries: [] };
}

let cache: { at: number; data: SiteEdits } | null = null;

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

async function blobPut(pathname: string, body: BodyInit, contentType: string) {
  const key = token();
  if (!key) throw new Error("Brak magazynu zdjęć.");
  const url = `https://vercel.com/api/blob/?pathname=${encodeURIComponent(pathname)}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${key}`,
      "x-api-version": "7",
      "x-content-type": contentType,
      "x-add-random-suffix": "0",
      "x-allow-overwrite": "1",
      "x-cache-control-max-age": "60",
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Zapis nie powiódł się (${res.status}).`);
  }
  return (await res.json()) as { url: string };
}

async function blobHead(pathname: string) {
  const key = token();
  if (!key) throw new Error("Brak magazynu treści.");
  const url = `https://vercel.com/api/blob/head?pathname=${encodeURIComponent(pathname)}`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${key}`, "x-api-version": "7" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Odczyt nie powiódł się (${res.status}).`);
  return (await res.json()) as { url?: string };
}

function parseDoc(data: Partial<SiteEdits>): SiteEdits {
  return {
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

async function loadDoc(): Promise<SiteEdits> {
  if (cache && Date.now() - cache.at < 5000) return cache.data;
  const meta = await blobHead(DOC);
  if (!meta?.url) {
    const doc = empty();
    cache = { at: Date.now(), data: doc };
    return doc;
  }
  const res = await fetch(meta.url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Odczyt treści nie powiódł się (${res.status}).`);
  const doc = parseDoc((await res.json()) as Partial<SiteEdits>);
  cache = { at: Date.now(), data: doc };
  return doc;
}

export async function readEdits(): Promise<SiteEdits> {
  if (!token()) return empty();
  try {
    return await loadDoc();
  } catch {
    console.error("Nie udało się odczytać treści strony.");
    return empty();
  }
}

async function readForWrite(): Promise<SiteEdits> {
  const doc = await loadDoc();
  return {
    copy: { ...doc.copy },
    images: { ...doc.images },
    herbs: { ...doc.herbs },
    entries: doc.entries.map((entry) => ({ ...entry })),
  };
}

export async function readPublicEdits(): Promise<SiteEdits> {
  const doc = await readEdits();
  return { ...doc, entries: doc.entries.filter((entry) => entry.status === "published") };
}

async function writeEdits(doc: SiteEdits) {
  cache = null;
  await blobPut(DOC, JSON.stringify(doc), "application/json");
  cache = { at: Date.now(), data: doc };
}

export async function saveCopy(id: string, value: string) {
  const doc = await readForWrite();
  doc.copy[id] = value;
  await writeEdits(doc);
}

export async function saveHerb(slug: string, copy: unknown) {
  const doc = await readForWrite();
  if (copy == null) delete doc.herbs[slug];
  else doc.herbs[slug] = copy;
  await writeEdits(doc);
}

export async function saveImage(id: string, dataUrl: string) {
  const match = /^data:image\/(?:jpeg|png|webp);base64,([a-z0-9+/=\s]+)$/i.exec(dataUrl);
  if (!match) throw new Error("To nie jest zdjęcie.");
  const bytes = Buffer.from(match[1].replace(/\s/g, ""), "base64");
  if (bytes.length < 32 || bytes.length > 2_500_000) throw new Error("Zdjęcie jest za duże.");
  const kind = imageKind(bytes);
  if (!kind) throw new Error("To nie jest zdjęcie.");
  const safe = id.replace(/[^a-z0-9_-]/gi, "").slice(0, 80) || "obraz";
  const ext = kind === "image/png" ? "png" : kind === "image/webp" ? "webp" : "jpg";
  const blob = await blobPut(`zielarka/images/${safe}.${ext}`, bytes, kind);
  const doc = await readForWrite();
  doc.images[id] = blob.url;
  await writeEdits(doc);
  return blob.url;
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

export async function saveEntry(input: unknown, previousSlug?: string) {
  if (previousSlug && builtinSlugs().has(previousSlug)) {
    throw new Error("Tej rośliny nie da się podmienić. Jest częścią zielnika.");
  }
  const preview = await readForWrite();
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
    next.image = await saveImage(`img.herb.${next.slug}`, next.image);
  } else if (!next.image && current) {
    next.image = current.image;
  }
  const doc = await readForWrite();
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
  await writeEdits(doc);
  return next;
}

export async function deleteEntry(slug: string) {
  if (builtinSlugs().has(slug)) throw new Error("Tej rośliny nie da się usunąć.");
  const doc = await readForWrite();
  const found = doc.entries.some((entry) => entry.slug === slug);
  if (!found) throw new Error("Nie ma takiej karty.");
  doc.entries = doc.entries.filter((entry) => entry.slug !== slug);
  await writeEdits(doc);
}

export function publishedHerbs(doc: SiteEdits) {
  return doc.entries.filter((entry) => entry.status === "published");
}

export { herbs };
