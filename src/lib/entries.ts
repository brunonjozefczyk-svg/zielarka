import { herbs, type Herb, type HerbFaq } from "./herbs";

export type EntryStatus = "draft" | "published";

export type ManagedEntry = {
  slug: string;
  status: EntryStatus;
  name: string;
  latin: string;
  lead: string;
  note: string;
  season: string;
  part: string;
  habitat: string;
  recognize: string;
  harvest: string;
  prepare: string;
  tradition: string;
  caution: string;
  seoTitle: string;
  seoDescription: string;
  alt: string;
  image: string;
  faqs: HerbFaq[];
  related: string[];
  updatedAt: string;
  history: { at: string; name: string; lead: string; status: EntryStatus }[];
};

const LETTERS: Record<string, string> = {
  ą: "a",
  ć: "c",
  ę: "e",
  ł: "l",
  ń: "n",
  ó: "o",
  ś: "s",
  ź: "z",
  ż: "z",
};

export function slugify(title: string) {
  const raw = title
    .trim()
    .toLowerCase()
    .split("")
    .map((char) => LETTERS[char] ?? char)
    .join("");
  return raw
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function plainText(value: unknown, max: number) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim()
    .slice(0, max);
}

export function builtinSlugs() {
  return new Set(herbs.map((herb) => herb.slug));
}

export function uniqueSlug(title: string, taken: Set<string>, requested?: string) {
  const base = slugify(requested || title) || "roslina";
  if (!taken.has(base)) return base;
  if (requested && slugify(requested) === base) return "";
  for (let n = 2; n < 50; n += 1) {
    const next = `${base.slice(0, 56)}-${n}`;
    if (!taken.has(next)) return next;
  }
  return `${base.slice(0, 50)}-${Date.now().toString(36)}`;
}

function imageValue(value: unknown) {
  const raw = String(value ?? "").trim();
  if (raw.startsWith("data:image/")) return raw.slice(0, 3_400_000);
  if (
    raw.startsWith("seal:") ||
    raw.startsWith("https://") ||
    raw.startsWith("http://") ||
    raw.startsWith("/")
  ) {
    return raw.slice(0, 2000);
  }
  return plainText(raw, 400);
}

export function normalizeEntry(input: unknown, taken: Set<string>, previousSlug?: string): ManagedEntry | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<ManagedEntry>;
  const name = plainText(raw.name, 80);
  if (name.length < 2) return null;
  const reserved = new Set(taken);
  if (previousSlug) reserved.delete(previousSlug);
  const requested = plainText(raw.slug, 60);
  let slug = uniqueSlug(name, reserved, requested);
  if (!slug) slug = uniqueSlug(name, reserved);
  if (builtinSlugs().has(slug)) return null;
  const status: EntryStatus = raw.status === "published" ? "published" : "draft";
  const faqs = Array.isArray(raw.faqs)
    ? raw.faqs
        .slice(0, 6)
        .map((item) => ({
          q: plainText(item?.q, 160),
          a: plainText(item?.a, 600),
        }))
        .filter((item) => item.q && item.a)
    : [];
  return {
    slug,
    status,
    name,
    latin: plainText(raw.latin, 80),
    lead: plainText(raw.lead, 600),
    note: plainText(raw.note, 240) || plainText(raw.lead, 240),
    season: plainText(raw.season, 80),
    part: plainText(raw.part, 80),
    habitat: plainText(raw.habitat, 160),
    recognize: plainText(raw.recognize, 2000),
    harvest: plainText(raw.harvest, 2000),
    prepare: plainText(raw.prepare, 2000),
    tradition: plainText(raw.tradition, 2000),
    caution: plainText(raw.caution, 2000),
    seoTitle: plainText(raw.seoTitle, 70) || `${name} | Zielarka.pl`.slice(0, 70),
    seoDescription: plainText(raw.seoDescription, 160) || plainText(raw.lead, 160),
    alt: plainText(raw.alt, 160) || name,
    image: imageValue(raw.image),
    faqs,
    related: Array.isArray(raw.related)
      ? raw.related.map((item) => slugify(String(item))).filter((item) => item && item !== slug).slice(0, 6)
      : [],
    updatedAt: new Date().toISOString(),
    history: [],
  };
}

export function parseStoredEntry(input: unknown): ManagedEntry | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<ManagedEntry>;
  const slug = slugify(String(raw.slug ?? ""));
  const name = plainText(raw.name, 80);
  if (!slug || name.length < 2 || builtinSlugs().has(slug)) return null;
  const status: EntryStatus = raw.status === "published" ? "published" : "draft";
  return {
    slug,
    status,
    name,
    latin: plainText(raw.latin, 80),
    lead: plainText(raw.lead, 600),
    note: plainText(raw.note, 240),
    season: plainText(raw.season, 80),
    part: plainText(raw.part, 80),
    habitat: plainText(raw.habitat, 160),
    recognize: plainText(raw.recognize, 2000),
    harvest: plainText(raw.harvest, 2000),
    prepare: plainText(raw.prepare, 2000),
    tradition: plainText(raw.tradition, 2000),
    caution: plainText(raw.caution, 2000),
    seoTitle: plainText(raw.seoTitle, 70) || `${name} | Zielarka.pl`.slice(0, 70),
    seoDescription: plainText(raw.seoDescription, 160),
    alt: plainText(raw.alt, 160) || name,
    image: imageValue(raw.image),
    faqs: Array.isArray(raw.faqs)
      ? raw.faqs
          .slice(0, 6)
          .map((item) => ({ q: plainText(item?.q, 160), a: plainText(item?.a, 600) }))
          .filter((item) => item.q && item.a)
      : [],
    related: Array.isArray(raw.related)
      ? raw.related.map((item) => slugify(String(item))).filter(Boolean).slice(0, 6)
      : [],
    updatedAt: plainText(raw.updatedAt, 40) || new Date().toISOString(),
    history: Array.isArray(raw.history)
      ? raw.history.slice(-8).map((item) => ({
          at: plainText(item?.at, 40),
          name: plainText(item?.name, 80),
          lead: plainText(item?.lead, 200),
          status: item?.status === "published" ? ("published" as const) : ("draft" as const),
        }))
      : [],
  };
}

export function entryToHerb(entry: ManagedEntry): Herb {
  const image =
    entry.image.startsWith("https://") || entry.image.startsWith("/")
      ? entry.image
      : "/images/still-life.webp";
  return {
    slug: entry.slug,
    name: entry.name,
    latin: entry.latin || "—",
    image,
    alt: entry.alt || entry.name,
    season: entry.season,
    part: entry.part,
    habitat: entry.habitat,
    seoTitle: entry.seoTitle,
    seoDescription: entry.seoDescription,
    note: entry.note || entry.lead,
    lead: entry.lead,
    recognize: entry.recognize,
    harvest: entry.harvest,
    prepare: entry.prepare,
    tradition: entry.tradition,
    caution: entry.caution,
    faqs: entry.faqs,
    related: entry.related,
  };
}
