import { timingSafeEqual } from "node:crypto";

export type SiteEdits = {
  copy: Record<string, string>;
  images: Record<string, string>;
  herbs: Record<string, unknown>;
};

const DOC = "zielarka/content.json";

function empty(): SiteEdits {
  return { copy: {}, images: {}, herbs: {} };
}

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
  if (!key) return null;
  const url = `https://vercel.com/api/blob/head?pathname=${encodeURIComponent(pathname)}`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${key}`, "x-api-version": "7" },
  });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return (await res.json()) as { url?: string };
}

export async function readEdits(): Promise<SiteEdits> {
  try {
    const meta = await blobHead(DOC);
    if (!meta?.url) return empty();
    const res = await fetch(meta.url, { cache: "no-store" });
    if (!res.ok) return empty();
    const data = (await res.json()) as Partial<SiteEdits>;
    return {
      copy: data.copy && typeof data.copy === "object" ? data.copy : {},
      images: data.images && typeof data.images === "object" ? data.images : {},
      herbs: data.herbs && typeof data.herbs === "object" ? data.herbs : {},
    };
  } catch {
    return empty();
  }
}

async function writeEdits(doc: SiteEdits) {
  await blobPut(DOC, JSON.stringify(doc), "application/json");
}

export async function saveCopy(id: string, value: string) {
  const doc = await readEdits();
  doc.copy[id] = value;
  await writeEdits(doc);
}

export async function saveHerb(slug: string, copy: unknown) {
  const doc = await readEdits();
  if (copy == null) delete doc.herbs[slug];
  else doc.herbs[slug] = copy;
  await writeEdits(doc);
}

export async function saveImage(id: string, dataUrl: string) {
  const match = /^data:image\/(?:jpeg|png|webp);base64,([a-z0-9+/=\s]+)$/i.exec(dataUrl);
  if (!match) throw new Error("To nie jest zdjęcie.");
  const bytes = Buffer.from(match[1].replace(/\s/g, ""), "base64");
  if (bytes.length < 32 || bytes.length > 2_500_000) throw new Error("Zdjęcie jest za duże.");
  const safe = id.replace(/[^a-z0-9_-]/gi, "").slice(0, 80) || "obraz";
  const blob = await blobPut(`zielarka/images/${safe}.jpg`, bytes, "image/jpeg");
  const doc = await readEdits();
  doc.images[id] = blob.url;
  await writeEdits(doc);
  return blob.url;
}
