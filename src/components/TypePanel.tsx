import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useEdits } from "@/lib/edits-context";
import { editorRevision, readEditorPassword, setEditorRevision } from "@/lib/site-editor";
import {
  FONT_STACKS,
  sanitizeTheme,
  themeAttrs,
  themeVars,
  UNSET_THEME,
  type FontChoice,
  type FontWeight,
  type ThemeSettings,
} from "@/lib/theme";

const FONTS: { id: FontChoice; label: string }[] = [
  { id: "fraunces", label: "Fraunces — szeryfowa" },
  { id: "figtree", label: "Figtree — bezszeryfowa" },
  { id: "serif", label: "Systemowa szeryfowa" },
  { id: "sans", label: "Systemowa bezszeryfowa" },
];

const WEIGHTS: FontWeight[] = [400, 500, 600, 700];

function paint(theme: ThemeSettings | null) {
  const root = document.documentElement;
  const attrs = themeAttrs(theme);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) root.removeAttribute(key);
    else root.setAttribute(key, value);
  }
  const vars = themeVars(theme);
  if (!vars) root.removeAttribute("style");
  else root.setAttribute("style", Object.entries(vars).map(([key, value]) => `${key}:${value}`).join(";"));
}

function SizeField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number | null;
  min: number;
  max: number;
  step: number;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="text-sm text-ink">
      {label}
      <input
        className="mt-1 min-h-11 w-full rounded-md border border-line bg-paper px-3"
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        placeholder="Jak jest"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
      />
    </label>
  );
}

export function TypePanel() {
  const saved = useEdits().theme;
  const savedKey = JSON.stringify(saved);
  const router = useRouter();
  const [draft, setDraft] = useState<ThemeSettings>(saved ?? UNSET_THEME);
  const [seen, setSeen] = useState(savedKey);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (savedKey === seen) return;
    setDraft(saved ?? UNSET_THEME);
    setSeen(savedKey);
  }, [saved, savedKey, seen]);

  function patch(partial: Partial<ThemeSettings>) {
    setDraft((current) => ({ ...current, ...partial }));
  }

  async function save(theme: ThemeSettings | null) {
    const clean = theme == null ? null : sanitizeTheme(theme);
    if (JSON.stringify(clean) === JSON.stringify(saved ?? null)) {
      setDraft(saved ?? UNSET_THEME);
      toast.success("Wygląd zostaje taki jak teraz.");
      return;
    }
    const password = readEditorPassword();
    if (!password) {
      toast.error("Wpisz hasło jeszcze raz.");
      return;
    }
    setBusy(true);
    try {
      const { saveThemeFn } = await import("@/lib/site-api");
      const result = await saveThemeFn({ data: { password, theme: clean, revision: editorRevision() } });
      if (!result.ok) throw new Error(result.message || "odmowa");
      setEditorRevision(result.revision);
      setDraft(clean ?? UNSET_THEME);
      setSeen(JSON.stringify(clean));
      paint(clean);
      await router.invalidate();
      toast.success(clean ? "Wygląd zapisany." : "Przywrócono domyślny wygląd.");
    } catch (error) {
      const text = error instanceof Error ? error.message : "";
      toast.error(text && text.length < 180 ? text : "Nie udało się zapisać wyglądu.");
    } finally {
      setBusy(false);
    }
  }

  const previewFamily = FONT_STACKS[draft.display];
  const previewBody = FONT_STACKS[draft.body];

  return (
    <section className="mt-10 rounded-lg border border-line p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-clay">Wygląd strony</p>
      <h2 className="mt-1 font-display text-2xl text-forest">Czcionki i tekst</h2>
      <p className="mt-2 text-sm text-muted">
        Podgląd jest tylko tutaj. Puste pola zostawiają obecną wielkość. Publiczna strona zmienia się po zapisie.
      </p>
      <div className="mt-4 rounded-md border border-line bg-cream p-4">
        <p className="text-xs uppercase tracking-[0.16em] text-clay">Podgląd</p>
        <p
          style={{
            fontFamily: previewFamily,
            fontSize: draft.h1 != null ? `${draft.h1}rem` : "2rem",
            fontWeight: draft.headingWeight ?? 500,
            lineHeight: 1.05,
          }}
        >
          Nagłówek strony
        </p>
        <p
          className="mt-2"
          style={{
            fontFamily: previewBody,
            fontSize: draft.bodySize != null ? `${draft.bodySize}rem` : "1rem",
            fontWeight: draft.bodyWeight ?? 400,
            lineHeight: draft.leading ?? 1.6,
            fontStyle: "normal",
          }}
        >
          Zwykły tekst z polskimi znakami: zioła, łąka, mięta.
        </p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-ink">
          Czcionka nagłówków
          <select
            className="mt-1 min-h-11 w-full rounded-md border border-line bg-paper px-3"
            value={draft.display}
            onChange={(event) => patch({ display: event.target.value as FontChoice })}
          >
            {FONTS.map((font) => (
              <option key={font.id} value={font.id}>
                {font.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-ink">
          Czcionka tekstu
          <select
            className="mt-1 min-h-11 w-full rounded-md border border-line bg-paper px-3"
            value={draft.body}
            onChange={(event) => patch({ body: event.target.value as FontChoice })}
          >
            {FONTS.map((font) => (
              <option key={font.id} value={font.id}>
                {font.label}
              </option>
            ))}
          </select>
        </label>
        <SizeField label="Wielkość H1 (rem, puste = jak jest)" value={draft.h1} min={2} max={4.5} step={0.05} onChange={(h1) => patch({ h1 })} />
        <SizeField label="Wielkość H2 (rem, puste = jak jest)" value={draft.h2} min={1.4} max={3} step={0.05} onChange={(h2) => patch({ h2 })} />
        <SizeField label="Wielkość H3 (rem, puste = jak jest)" value={draft.h3} min={1.1} max={2.2} step={0.05} onChange={(h3) => patch({ h3 })} />
        <SizeField
          label="Wielkość akapitu (rem, puste = jak jest)"
          value={draft.bodySize}
          min={0.9}
          max={1.3}
          step={0.01}
          onChange={(bodySize) => patch({ bodySize })}
        />
        <label className="text-sm text-ink">
          Grubość nagłówków
          <select
            className="mt-1 min-h-11 w-full rounded-md border border-line bg-paper px-3"
            value={draft.headingWeight ?? ""}
            onChange={(event) =>
              patch({ headingWeight: event.target.value ? (Number(event.target.value) as FontWeight) : null })
            }
          >
            <option value="">Jak jest teraz</option>
            {WEIGHTS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-ink">
          Grubość tekstu
          <select
            className="mt-1 min-h-11 w-full rounded-md border border-line bg-paper px-3"
            value={draft.bodyWeight ?? ""}
            onChange={(event) =>
              patch({ bodyWeight: event.target.value ? (Number(event.target.value) as FontWeight) : null })
            }
          >
            <option value="">Jak jest teraz</option>
            {WEIGHTS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <SizeField
          label="Interlinia (puste = jak jest)"
          value={draft.leading}
          min={1.3}
          max={1.9}
          step={0.05}
          onChange={(leading) => patch({ leading })}
        />
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button type="button" disabled={busy} onClick={() => void save(draft)}>
          Zapisz
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => setDraft(saved ?? UNSET_THEME)}>
          Anuluj
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={() => void save(null)}>
          Przywróć domyślny wygląd
        </Button>
      </div>
    </section>
  );
}
