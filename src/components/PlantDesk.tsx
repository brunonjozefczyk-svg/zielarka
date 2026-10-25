import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { slugify, type EntryStatus, type ManagedEntry } from "@/lib/entries";
import { herbs } from "@/lib/herbs";
import {
  adoptServerCopy,
  applyRemoteImages,
  clearEditorPassword,
  readEditorPassword,
  resizeImageFile,
  setEditorRevision,
  writeEditMode,
} from "@/lib/site-editor";
import { adoptServerHerbs } from "@/lib/herb-editor";
import { useEdits } from "@/lib/edits-context";

type Faq = { q: string; a: string };

type Draft = {
  previousSlug: string;
  slug: string;
  slugTouched: boolean;
  locked: boolean;
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
  faqs: Faq[];
  related: string[];
  history: ManagedEntry["history"];
};

const emptyDraft = (): Draft => ({
  previousSlug: "",
  slug: "",
  slugTouched: false,
  locked: false,
  status: "draft",
  name: "",
  latin: "",
  lead: "",
  note: "",
  season: "",
  part: "",
  habitat: "",
  recognize: "",
  harvest: "",
  prepare: "",
  tradition: "",
  caution: "",
  seoTitle: "",
  seoDescription: "",
  alt: "",
  image: "",
  faqs: [],
  related: [],
  history: [],
});

function fromEntry(entry: ManagedEntry): Draft {
  const locked =
    entry.status === "published" || entry.history.some((item) => item.status === "published");
  return {
    previousSlug: entry.slug,
    slug: entry.slug,
    slugTouched: true,
    locked,
    status: entry.status,
    name: entry.name,
    latin: entry.latin,
    lead: entry.lead,
    note: entry.note,
    season: entry.season,
    part: entry.part,
    habitat: entry.habitat,
    recognize: entry.recognize,
    harvest: entry.harvest,
    prepare: entry.prepare,
    tradition: entry.tradition,
    caution: entry.caution,
    seoTitle: entry.seoTitle,
    seoDescription: entry.seoDescription,
    alt: entry.alt,
    image: entry.image,
    faqs: entry.faqs.map((item) => ({ ...item })),
    related: [...entry.related],
    history: entry.history,
  };
}

function errorText(error: unknown) {
  const text = error instanceof Error ? error.message : "";
  if (text && text.length < 200 && !text.includes("\n")) return text;
  return "Nie udało się zapisać. Sprawdź sieć i hasło.";
}

export function PlantDesk({ onLock }: { onLock: () => void }) {
  const navigate = useNavigate();
  const edits = useEdits();
  const [entries, setEntries] = useState<ManagedEntry[]>([]);
  const [revision, setRevision] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  async function reload() {
    const password = readEditorPassword();
    if (!password) {
      onLock();
      return;
    }
    const { listEntriesFn } = await import("@/lib/site-api");
    const result = await listEntriesFn({ data: { password } });
    if (!result.ok) {
      if (result.message?.includes("dużo")) {
        toast.error(result.message);
        return;
      }
      onLock();
      toast.error(result.message || "Hasło wygasło. Wpisz je jeszcze raz.");
      return;
    }
    setEntries(result.entries);
    setRevision(result.revision);
    setEditorRevision(result.revision);
  }

  useEffect(() => {
    void reload()
      .catch(() => toast.error("Nie udało się wczytać kart."))
      .finally(() => setLoading(false));
  }, []);

  const known = useMemo(() => {
    const slugs = new Map<string, string>();
    for (const herb of herbs) slugs.set(herb.slug, herb.name);
    for (const entry of entries) slugs.set(entry.slug, entry.name);
    if (draft?.previousSlug) slugs.delete(draft.previousSlug);
    return [...slugs.entries()];
  }, [entries, draft?.previousSlug]);

  function patch(partial: Partial<Draft>) {
    setDraft((current) => (current ? { ...current, ...partial } : current));
  }

  function onName(name: string) {
    setDraft((current) => {
      if (!current) return current;
      const slug = current.slugTouched || current.locked ? current.slug : slugify(name);
      return { ...current, name, slug };
    });
  }

  async function onImage(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      toast.error("Wybierz zdjęcie JPG, PNG albo WebP.");
      return;
    }
    try {
      const image = await resizeImageFile(file);
      patch({ image });
    } catch {
      toast.error("Nie udało się odczytać zdjęcia.");
    }
  }

  async function save(status: EntryStatus) {
    if (!draft || busy) return;
    if (draft.name.trim().length < 2) {
      toast.error("Podaj nazwę rośliny.");
      return;
    }
    if (status === "published") {
      if (draft.lead.trim().length < 20) {
        toast.error("Przed publikacją dopisz wstęp — co najmniej kilka zdań.");
        return;
      }
      if (draft.caution.trim().length < 10) {
        toast.error("Przed publikacją dopisz ostrożność. Karta nie zastępuje lekarza.");
        return;
      }
    }
    const password = readEditorPassword();
    if (!password) {
      onLock();
      return;
    }
    setBusy(true);
    try {
      const { saveEntryFn } = await import("@/lib/site-api");
      const result = await saveEntryFn({
        data: {
          password,
          previousSlug: draft.previousSlug,
          revision,
          entry: {
            slug: draft.slugTouched ? draft.slug : "",
            status,
            name: draft.name,
            latin: draft.latin,
            lead: draft.lead,
            note: draft.note || draft.lead,
            season: draft.season,
            part: draft.part,
            habitat: draft.habitat,
            recognize: draft.recognize,
            harvest: draft.harvest,
            prepare: draft.prepare,
            tradition: draft.tradition,
            caution: draft.caution,
            seoTitle: draft.seoTitle,
            seoDescription: draft.seoDescription,
            alt: draft.alt || draft.name,
            image: draft.image,
            faqs: draft.faqs,
            related: draft.related,
          },
        },
      });
      if (!result.ok || !result.entry) {
        if (result.message?.includes("dużo")) toast.error(result.message);
        else {
          onLock();
          toast.error(result.message || "Złe hasło.");
        }
        return;
      }
      const saved = result.entry;
      setRevision(result.revision);
      setEditorRevision(result.revision);
      toast.success(
        saved.status === "published"
          ? `Opublikowane: /zielnik/${saved.slug}`
          : "Szkic zapisany. Nie widać go na stronie.",
      );
      setDraft(fromEntry(saved));
      await reload();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function remove(slug: string, name: string) {
    if (!window.confirm(`Usunąć kartę „${name}”? Adres przestanie działać.`)) return;
    const password = readEditorPassword();
    if (!password) {
      onLock();
      return;
    }
    setBusy(true);
    try {
      const { deleteEntryFn } = await import("@/lib/site-api");
      const result = await deleteEntryFn({ data: { password, slug, revision } });
      if (!result.ok) {
        if (result.message?.includes("dużo")) toast.error(result.message);
        else {
          onLock();
          toast.error(result.message || "Złe hasło.");
        }
        return;
      }
      setRevision(result.revision);
      setEditorRevision(result.revision);
      if (draft?.previousSlug === slug) setDraft(null);
      toast.success("Karta usunięta.");
      await reload();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (!window.confirm("Przywrócić poprzedni zapis całej strony? Aktualna wersja zostanie kopią.")) return;
    const password = readEditorPassword();
    if (!password) {
      onLock();
      return;
    }
    setBusy(true);
    try {
      const { restoreEditsFn } = await import("@/lib/site-api");
      const result = await restoreEditsFn({ data: { password, revision } });
      if (!result.ok) {
        toast.error(result.message || "Nie udało się przywrócić.");
        return;
      }
      setRevision(result.revision);
      setEditorRevision(result.revision);
      toast.success("Przywrócono poprzedni zapis.");
      await reload();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  const previewSlug = draft ? draft.slug || slugify(draft.name) || "…" : "";

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <p className="text-xs uppercase tracking-[0.22em] text-clay">Panel</p>
      <h1 className="mt-2 font-display text-4xl text-forest">Karty zielnika</h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
        Sześć roślin z zielnika zostaje. Nową kartę dodajesz tutaj — najpierw jako szkic, potem
        jako opublikowany artykuł pod własnym adresem. Teksty i zdjęcia na istniejących stronach
        zmieniasz nadal na samej stronie.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button type="button" onClick={() => setDraft(emptyDraft())}>
          Nowa roślina
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            adoptServerCopy(edits.copy);
            adoptServerHerbs(edits.herbs);
            void applyRemoteImages(edits.images);
            writeEditMode(true);
            void navigate({ to: "/" });
          }}
        >
          Edytuj teksty na stronie
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            clearEditorPassword();
            onLock();
          }}
        >
          Wyloguj
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void restore()}>
          Przywróć poprzedni zapis
        </Button>
      </div>

      <section className="mt-10">
        <h2 className="font-display text-2xl text-forest">Już w zielniku</h2>
        <ul className="mt-4 divide-y divide-line border-y border-line">
          {herbs.map((herb) => (
            <li key={herb.slug} className="flex items-center justify-between gap-3 py-3">
              <span>
                <span className="block text-ink">{herb.name}</span>
                <span className="text-sm text-muted">/zielnik/{herb.slug}</span>
              </span>
              <Link to="/zielnik/$slug" params={{ slug: herb.slug }} className="text-sm text-forest underline">
                Otwórz
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-2xl text-forest">Twoje karty</h2>
        {loading ? <p className="mt-3 text-sm text-muted">Wczytuję…</p> : null}
        {!loading && entries.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Jeszcze nic nie dodano.</p>
        ) : null}
        <ul className="mt-4 space-y-3">
          {entries.map((entry) => (
            <li key={entry.slug} className="rounded-lg border border-line bg-cream p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-display text-xl text-forest">{entry.name}</p>
                  <p className="text-sm text-muted">/zielnik/{entry.slug}</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.14em] text-clay">
                    {entry.status === "published" ? "Opublikowana" : "Szkic"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => setDraft(fromEntry(entry))}>
                    Edytuj
                  </Button>
                  {entry.status === "published" ? (
                    <Link
                      to="/zielnik/$slug"
                      params={{ slug: entry.slug }}
                      className="inline-flex h-10 items-center px-2 text-sm text-forest underline"
                    >
                      Podgląd
                    </Link>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void remove(entry.slug, entry.name)}
                  >
                    Usuń
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {draft ? (
        <form
          className="mt-12 space-y-5 rounded-lg border border-line bg-cream p-5 sm:p-6"
          onSubmit={(event) => {
            event.preventDefault();
            void save(draft.status);
          }}
        >
          <div>
            <h2 className="font-display text-2xl text-forest">
              {draft.previousSlug ? "Edycja karty" : "Nowa karta"}
            </h2>
            <p className="mt-1 text-sm text-muted">
              Adres: /zielnik/{previewSlug}
              {draft.locked ? " — po publikacji adres zostaje na stałe." : " — możesz go zmienić przed publikacją."}
            </p>
          </div>

          <div>
            <Label htmlFor="plant-name">Nazwa</Label>
            <Input id="plant-name" value={draft.name} onChange={(event) => onName(event.target.value)} required />
          </div>
          <div>
            <Label htmlFor="plant-latin">Nazwa łacińska</Label>
            <Input
              id="plant-latin"
              value={draft.latin}
              onChange={(event) => patch({ latin: event.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="plant-slug">Adres</Label>
            <Input
              id="plant-slug"
              value={draft.slug}
              disabled={draft.locked}
              onChange={(event) => patch({ slug: slugify(event.target.value), slugTouched: true })}
            />
          </div>
          <div>
            <Label htmlFor="plant-lead">Wstęp</Label>
            <Textarea
              id="plant-lead"
              value={draft.lead}
              onChange={(event) => patch({ lead: event.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="plant-note">Krótki opis na liście</Label>
            <Textarea
              id="plant-note"
              className="min-h-20"
              value={draft.note}
              onChange={(event) => patch({ note: event.target.value })}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="plant-part">Część rośliny</Label>
              <Input id="plant-part" value={draft.part} onChange={(event) => patch({ part: event.target.value })} />
            </div>
            <div>
              <Label htmlFor="plant-season">Sezon</Label>
              <Input
                id="plant-season"
                value={draft.season}
                onChange={(event) => patch({ season: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="plant-habitat">Gdzie rośnie</Label>
              <Input
                id="plant-habitat"
                value={draft.habitat}
                onChange={(event) => patch({ habitat: event.target.value })}
              />
            </div>
          </div>
          {(
            [
              ["recognize", "Jak rozpoznać"],
              ["harvest", "Sezon i zbiór"],
              ["prepare", "Napar i kuchnia"],
              ["tradition", "W tradycji"],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <Label htmlFor={`plant-${key}`}>{label}</Label>
              <Textarea
                id={`plant-${key}`}
                value={draft[key]}
                onChange={(event) => patch({ [key]: event.target.value })}
              />
            </div>
          ))}
          <div>
            <Label htmlFor="plant-caution">Ostrożność</Label>
            <Textarea
              id="plant-caution"
              placeholder="Opis edukacyjny, nie porada medyczna. Kiedy odłożyć roślinę i kiedy iść do lekarza."
              value={draft.caution}
              onChange={(event) => patch({ caution: event.target.value })}
            />
          </div>

          <fieldset>
            <legend className="text-sm font-medium text-ink">Linki wewnętrzne</legend>
            <p className="mt-1 text-xs text-muted">Zaznaczone karty pojawią się jako „Obok w zielniku”.</p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {known.map(([slug, name]) => (
                <li key={slug}>
                  <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={draft.related.includes(slug)}
                      onChange={(event) => {
                        const related = event.target.checked
                          ? [...draft.related, slug]
                          : draft.related.filter((item) => item !== slug);
                        patch({ related });
                      }}
                    />
                    {name}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>

          <div>
            <Label htmlFor="plant-seo-title">Tytuł SEO</Label>
            <Input
              id="plant-seo-title"
              value={draft.seoTitle}
              maxLength={70}
              placeholder="Zostaw puste — powstanie z nazwy."
              onChange={(event) => patch({ seoTitle: event.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="plant-seo-desc">Opis SEO</Label>
            <Textarea
              id="plant-seo-desc"
              className="min-h-20"
              maxLength={160}
              value={draft.seoDescription}
              placeholder="Zostaw puste — powstanie ze wstępu."
              onChange={(event) => patch({ seoDescription: event.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="plant-alt">Tekst alternatywny zdjęcia</Label>
            <Input
              id="plant-alt"
              value={draft.alt}
              onChange={(event) => patch({ alt: event.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="plant-image">Zdjęcie</Label>
            <input
              id="plant-image"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="block min-h-11 w-full text-sm"
              onChange={(event) => void onImage(event.target.files?.[0])}
            />
            {draft.image ? (
              <img src={draft.image} alt="" className="mt-3 h-40 w-full rounded-md object-cover" />
            ) : null}
          </div>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-ink">Pytania</legend>
            {draft.faqs.map((item, index) => (
              <div key={index} className="space-y-2 rounded-md border border-line p-3">
                <Input
                  aria-label="Pytanie"
                  value={item.q}
                  onChange={(event) => {
                    const faqs = draft.faqs.map((faq, i) => (i === index ? { ...faq, q: event.target.value } : faq));
                    patch({ faqs });
                  }}
                />
                <Textarea
                  aria-label="Odpowiedź"
                  className="min-h-20"
                  value={item.a}
                  onChange={(event) => {
                    const faqs = draft.faqs.map((faq, i) => (i === index ? { ...faq, a: event.target.value } : faq));
                    patch({ faqs });
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => patch({ faqs: draft.faqs.filter((_, i) => i !== index) })}
                >
                  Usuń pytanie
                </Button>
              </div>
            ))}
            {draft.faqs.length < 6 ? (
              <Button type="button" variant="outline" size="sm" onClick={() => patch({ faqs: [...draft.faqs, { q: "", a: "" }] })}>
                Dodaj pytanie
              </Button>
            ) : null}
          </fieldset>

          {draft.history.length > 0 ? (
            <div>
              <p className="text-sm font-medium text-ink">Ostatnie zapisy</p>
              <ul className="mt-2 space-y-1 text-sm text-muted">
                {draft.history
                  .slice()
                  .reverse()
                  .map((item) => (
                    <li key={`${item.at}-${item.name}`}>
                      {item.at.slice(0, 16).replace("T", " ")} · {item.status === "published" ? "opublikowana" : "szkic"} ·{" "}
                      {item.name}
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3">
            {draft.status === "published" ? (
              <>
                <Button type="button" disabled={busy} onClick={() => void save("published")}>
                  Zapisz zmiany
                </Button>
                <Button type="button" variant="outline" disabled={busy} onClick={() => void save("draft")}>
                  Wycofaj publikację
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="outline" disabled={busy} onClick={() => void save("draft")}>
                  Zapisz szkic
                </Button>
                <Button type="button" disabled={busy} onClick={() => void save("published")}>
                  Opublikuj
                </Button>
              </>
            )}
            <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
              Zamknij
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
