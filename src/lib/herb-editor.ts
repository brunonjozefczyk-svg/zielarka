import { useEffect, useMemo, useState } from "react";
import { herbs, type Herb, type HerbFaq } from "./herbs";
import { entryToHerb } from "./entries";
import { useEdits } from "./edits-context";
import { readEditMode } from "./site-editor";

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

export function adoptServerHerbs(herbsCopy: Record<string, HerbCopy>) {
  if (typeof window === "undefined") return;
  const next: Record<string, HerbCopy> = {};
  for (const [slug, copy] of Object.entries(herbsCopy)) {
    if (copy && typeof copy === "object") next[slug] = copy;
  }
  writeAll(next);
}

export function applyRemoteHerbs(herbsCopy: Record<string, HerbCopy>) {
  adoptServerHerbs(herbsCopy);
}

export async function saveHerbCopy(slug: string, copy: HerbCopy) {
  const { readEditorPassword, editorRevision, setEditorRevision } = await import("./site-editor");
  const password = readEditorPassword();
  if (!password) throw new Error("brak hasła");
  const { saveHerbFn } = await import("./site-api");
  const result = await saveHerbFn({ data: { password, slug, copy, revision: editorRevision() } });
  if (!result.ok) throw new Error(result.message || "odmowa");
  setEditorRevision(result.revision);
  const all = readAll();
  all[slug] = copy;
  writeAll(all);
}

export function mergeHerb(herb: Herb): Herb {
  const over = readAll()[herb.slug];
  if (!over) return herb;
  return { ...herb, ...over };
}

export async function resetHerbCopy(slug: string) {
  const { readEditorPassword, editorRevision, setEditorRevision } = await import("./site-editor");
  const password = readEditorPassword();
  if (!password) throw new Error("brak hasła");
  const { saveHerbFn } = await import("./site-api");
  const result = await saveHerbFn({ data: { password, slug, copy: null, revision: editorRevision() } });
  if (!result.ok) throw new Error(result.message || "odmowa");
  setEditorRevision(result.revision);
  const all = readAll();
  delete all[slug];
  writeAll(all);
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
  const edits = useEdits();
  const copy = edits.herbs[herb.slug];
  const image = edits.images[`img.herb.${herb.slug}`];
  const [live, setLive] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const apply = () => {
      setLive(readEditMode());
      setTick((value) => value + 1);
    };
    apply();
    window.addEventListener("zielarka-herb-copy", apply);
    window.addEventListener("storage", apply);
    window.addEventListener("zielarka-site-editor", apply);
    return () => {
      window.removeEventListener("zielarka-herb-copy", apply);
      window.removeEventListener("storage", apply);
      window.removeEventListener("zielarka-site-editor", apply);
    };
  }, []);

  return useMemo(() => {
    const over = overlayHerb(herb, copy, image);
    return live ? mergeHerb(over) : over;
  }, [herb, copy, image, live, tick]);
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
  const [live, setLive] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const apply = () => {
      setLive(readEditMode());
      setTick((value) => value + 1);
    };
    apply();
    window.addEventListener("zielarka-herb-copy", apply);
    window.addEventListener("storage", apply);
    window.addEventListener("zielarka-site-editor", apply);
    return () => {
      window.removeEventListener("zielarka-herb-copy", apply);
      window.removeEventListener("storage", apply);
      window.removeEventListener("zielarka-site-editor", apply);
    };
  }, []);

  return useMemo(
    () =>
      herbs.map((herb) => {
        const over = overlayHerb(herb, edits.herbs[herb.slug], edits.images[`img.herb.${herb.slug}`]);
        return live ? mergeHerb(over) : over;
      }),
    [edits, live, tick],
  );
}

export function useAllHerbs() {
  const extras = useEdits().entries.map(entryToHerb);
  const base = useMergedHerbs();
  const seen = new Set(base.map((herb) => herb.slug));
  return [...base, ...extras.filter((herb) => !seen.has(herb.slug))];
}