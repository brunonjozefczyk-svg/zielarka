import { useState } from "react";
import { Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  copyFromHerb,
  exportHerbCopy,
  resetHerbCopy,
  saveHerbCopy,
  type HerbCopy,
} from "@/lib/herb-editor";
import { useEditMode } from "@/lib/site-editor";
import type { Herb } from "@/lib/herbs";

export function HerbCopyEditor({ herb }: { herb: Herb }) {
  const { editing } = useEditMode();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<HerbCopy>(() => copyFromHerb(herb));

  if (!editing) return null;

  function start() {
    setDraft(copyFromHerb(herb));
    setOpen(true);
  }

  function field<K extends keyof Omit<HerbCopy, "faqs">>(key: K) {
    return {
      value: draft[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setDraft((d) => ({ ...d, [key]: e.target.value })),
    };
  }

  function save() {
    const seoTitle = draft.seoTitle.trim();
    const seoDescription = draft.seoDescription.trim();
    const lead = draft.lead.trim();
    if (!seoTitle || !seoDescription || !lead) {
      toast.error("Tytuł SEO, opis SEO i wstęp nie mogą być puste.");
      return;
    }
    void saveHerbCopy(herb.slug, {
      ...draft,
      seoTitle,
      seoDescription,
      lead,
      note: draft.note.trim(),
      faqs: draft.faqs.map((item) => ({ q: item.q.trim(), a: item.a.trim() })),
    })
      .then(() => {
        toast.success("Zapisane. Widać to też na innych telefonach.");
        setOpen(false);
      })
      .catch(() => toast.error("Nie udało się zapisać. Sprawdź hasło i sieć."));
  }

  function revert() {
    void resetHerbCopy(herb.slug).then(() => {
      setDraft(copyFromHerb(herb));
      toast.success("Wraca oryginalny opis.");
      setOpen(false);
    });
  }

  return (
    <div className="mt-6">
      {!open ? (
        <Button type="button" variant="outline" size="sm" onClick={start}>
          <Pencil className="size-4" />
          Edytuj opis
        </Button>
      ) : (
        <form
          className="rounded-lg border border-line bg-cream p-5 sm:p-6"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-clay">Twoja edycja</p>
              <p className="mt-1 max-w-md text-sm text-muted">
                Zapis idzie na stronę. Po zapisaniu zobaczy go każdy.
              </p>
            </div>
            <button
              type="button"
              className="inline-flex size-11 items-center justify-center rounded-md text-ink"
              aria-label="Zamknij edycję"
              onClick={() => setOpen(false)}
            >
              <X className="size-5" />
            </button>
          </div>

          <div className="mt-6 grid gap-5">
            <Field label="Tytuł SEO (to, co w Google)" htmlFor="seoTitle">
              <Input id="seoTitle" maxLength={70} {...field("seoTitle")} />
            </Field>
            <Field label="Opis SEO (dwa zdania pod tytułem w Google)" htmlFor="seoDescription">
              <Textarea
                id="seoDescription"
                rows={3}
                className="min-h-24"
                maxLength={170}
                {...field("seoDescription")}
              />
            </Field>
            <Field label="Na karcie (krótki opis w zielniku)" htmlFor="note">
              <Textarea id="note" rows={3} className="min-h-24" {...field("note")} />
            </Field>
            <Field label="Wstęp" htmlFor="lead">
              <Textarea id="lead" rows={4} {...field("lead")} />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Część rośliny" htmlFor="part">
                <Input id="part" {...field("part")} />
              </Field>
              <Field label="Sezon zbioru" htmlFor="season">
                <Input id="season" {...field("season")} />
              </Field>
            </div>
            <Field label="Gdzie rośnie" htmlFor="habitat">
              <Input id="habitat" {...field("habitat")} />
            </Field>
            <Field label="Jak rozpoznać" htmlFor="recognize">
              <Textarea id="recognize" rows={5} {...field("recognize")} />
            </Field>
            <Field label="Sezon i zbiór" htmlFor="harvest">
              <Textarea id="harvest" rows={5} {...field("harvest")} />
            </Field>
            <Field label="Napar i kuchnia" htmlFor="prepare">
              <Textarea id="prepare" rows={5} {...field("prepare")} />
            </Field>
            <Field label="W tradycji" htmlFor="tradition">
              <Textarea id="tradition" rows={5} {...field("tradition")} />
            </Field>
            <Field label="Ostrożność" htmlFor="caution">
              <Textarea id="caution" rows={5} {...field("caution")} />
            </Field>

            <div>
              <p className="mb-3 text-sm font-medium text-ink">Pytania</p>
              <div className="grid gap-6">
                {draft.faqs.map((item, index) => (
                  <div key={index} className="grid gap-3 border-t border-line pt-4">
                    <Field label={`Pytanie ${index + 1}`}>
                      <Input
                        value={item.q}
                        onChange={(e) =>
                          setDraft((d) => {
                            const faqs = d.faqs.map((faq, i) =>
                              i === index ? { ...faq, q: e.target.value } : faq,
                            );
                            return { ...d, faqs };
                          })
                        }
                      />
                    </Field>
                    <Field label="Odpowiedź">
                      <Textarea
                        rows={3}
                        className="min-h-24"
                        value={item.a}
                        onChange={(e) =>
                          setDraft((d) => {
                            const faqs = d.faqs.map((faq, i) =>
                              i === index ? { ...faq, a: e.target.value } : faq,
                            );
                            return { ...d, faqs };
                          })
                        }
                      />
                    </Field>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Button type="submit">Zapisz</Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => exportHerbCopy(herb.slug, draft)}
            >
              Pobierz plik
            </Button>
            <Button type="button" variant="ghost" onClick={revert}>
              Cofnij do oryginału
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}