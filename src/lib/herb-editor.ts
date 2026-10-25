import { useEffect, useState } from "react";
import { herbs, type Herb, type HerbFaq } from "./herbs";

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

export function applyRemoteHerbs(herbsCopy: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  const current = readAll();
  for (const [slug, copy] of Object.entries(herbsCopy)) {
    if (copy && typeof copy === "object") current[slug] = copy as HerbCopy;
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
    const apply = () => {
      const base = herbs.find((item) => item.slug === herb.slug) ?? herb;
      setLive(mergeHerb(base));
    };
    apply();
    window.addEventListener("zielarka-herb-copy", apply);
    window.addEventListener("storage", apply);
    return () => {
      window.removeEventListener("zielarka-herb-copy", apply);
      window.removeEventListener("storage", apply);
    };
  }, [herb.slug]);

  return live;
}

export function useMergedHerbs() {
  const [list, setList] = useState(herbs);

  useEffect(() => {
    const apply = () => setList(herbs.map(mergeHerb));
    apply();
    window.addEventListener("zielarka-herb-copy", apply);
    window.addEventListener("storage", apply);
    return () => {
      window.removeEventListener("zielarka-herb-copy", apply);
      window.removeEventListener("storage", apply);
    };
  }, []);

  return list;
}