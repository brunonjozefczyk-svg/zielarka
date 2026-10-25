import { useEffect, useState } from "react";
import { herbs, type Herb, type HerbFaq } from "./herbs";
import { entryToHerb } from "./entries";
import { useEdits } from "./edits-context";

const KEY = "zielarka.herb-copy.v2";

export type HerbCopy = {
  seoTitle: string;
  seoDescription: string;
  note: string;
  lead: string;
  part: string;
  season: string;
  habitat: string;
  recognize: string;
  harvest: string;
  prepare: string;
  tradition: string;
  caution: string;
  faqs: HerbFaq[];
};

export function copyFromHerb(herb: Herb): HerbCopy {
  return {
    seoTitle: herb.seoTitle,
    seoDescription: herb.seoDescription,
    note: herb.note,
    lead: herb.lead,
    part: herb.part,
    season: herb.season,
    habitat: herb.habitat,
    recognize: herb.recognize,
    harvest: herb.harvest,
    prepare: herb.prepare,
    tradition: herb.tradition,
    caution: herb.caution,
    faqs: herb.faqs.map((item) => ({ ...item })),
  };
}

function readAll(): Record<string, HerbCopy> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, HerbCopy>) : {};
  } catch {
    return {};
  }
}

function writeAll(data: Record<string, HerbCopy>) {
  localStorage.setItem(KEY, JSON.stringify(data));
  window.dispatchEvent(new Event("zielarka-herb-copy"));
}

export function applyRemoteHerbs(herbsCopy: Record<string, HerbCopy>) {
  if (typeof window === "undefined") return;
  const current = readAll();
  for (const [slug, copy] of Object.entries(herbsCopy)) {
    if (copy && typeof copy === "object") current[slug] = copy;
  }
  writeAll(current);
}

export async function saveHerbCopy(slug: string, copy: HerbCopy) {
  const all = readAll();
  all[slug] = copy;
  writeAll(all);
  const { readEditorPassword } = await import("./site-editor");
  const password = readEditorPassword();
  if (!password) throw new Error("brak hasła");
  const { saveHerbFn } = await import("./site-api");
  const result = await saveHerbFn({ data: { password, slug, copy } });
  if (!result.ok) throw new Error("odmowa");
}

export function mergeHerb(herb: Herb): Herb {
  const over = readAll()[herb.slug];
  if (!over) return herb;
  return { ...herb, ...over };
}

export async function resetHerbCopy(slug: string) {
  const all = readAll();
  delete all[slug];
  writeAll(all);
  const { readEditorPassword } = await import("./site-editor");
  const password = readEditorPassword();
  if (!password) return;
  const { saveHerbFn } = await import("./site-api");
  await saveHerbFn({ data: { password, slug, copy: null } });
}

export function hasHerbCopy(slug: string) {
  return Boolean(readAll()[slug]);
}

export function exportHerbCopy(slug: string, copy: HerbCopy) {
  const blob = new Blob([JSON.stringify({ slug, ...copy }, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `zielarka-${slug}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function useMergedHerb(herb: Herb) {
  const [live, setLive] = useState(herb);

  useEffect(() => {
    const apply = () => setLive(mergeHerb(herb));
    apply();
    window.addEventListener("zielarka-herb-copy", apply);
    window.addEventListener("storage", apply);
    return () => {
      window.removeEventListener("zielarka-herb-copy", apply);
      window.removeEventListener("storage", apply);
    };
  }, [herb]);

  return live;
}

function overlayHerb(herb: Herb, remote: unknown, image?: string): Herb {
  let next = herb;
  if (remote && typeof remote === "object") {
    const copy = remote as Partial<Herb>;
    next = {
      ...herb,
      ...copy,
      faqs: Array.isArray(copy.faqs) ? copy.faqs : herb.faqs,
      related: Array.isArray(copy.related) ? copy.related : herb.related,
    };
  }
  if (image) next = { ...next, image };
  return next;
}

export function useMergedHerbs() {
  const edits = useEdits();
  const serverList = herbs.map((herb) =>
    overlayHerb(herb, edits.herbs[herb.slug], edits.images[`img.herb.${herb.slug}`]),
  );
  const [list, setList] = useState(serverList);

  useEffect(() => {
    const apply = () =>
      setList(
        herbs.map((herb) =>
          mergeHerb(overlayHerb(herb, edits.herbs[herb.slug], edits.images[`img.herb.${herb.slug}`])),
        ),
      );
    apply();
    window.addEventListener("zielarka-herb-copy", apply);
    window.addEventListener("storage", apply);
    return () => {
      window.removeEventListener("zielarka-herb-copy", apply);
      window.removeEventListener("storage", apply);
    };
  }, [edits]);

  return list;
}

export function useAllHerbs() {
  const extras = useEdits().entries.map(entryToHerb);
  const base = useMergedHerbs();
  const seen = new Set(base.map((herb) => herb.slug));
  return [...base, ...extras.filter((herb) => !seen.has(herb.slug))];
}