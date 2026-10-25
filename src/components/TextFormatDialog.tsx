import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { textInline, type TextStyle } from "@/lib/theme";

export function TextFormatDialog({
  draft,
  draftStyle,
  onDraft,
  onStyle,
  onClose,
  onSave,
}: {
  draft: string;
  draftStyle: TextStyle | null;
  onDraft: (value: string) => void;
  onStyle: (value: TextStyle | null) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] bg-ink/40" onClick={onClose}>
      <div
        className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-auto rounded-t-lg bg-paper p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-xs uppercase tracking-[0.16em] text-clay">Edycja tekstu</p>
        <p className="mt-3 text-ink" style={textInline(draftStyle)}>
          {draft || "Podgląd"}
        </p>
        <Textarea className="mt-3 min-h-32" value={draft} onChange={(event) => onDraft(event.target.value)} autoFocus />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-ink">
            Czcionka
            <select
              className="mt-1 min-h-11 w-full rounded-md border border-line bg-paper px-3"
              value={draftStyle?.font ?? ""}
              onChange={(event) =>
                onStyle({
                  ...draftStyle,
                  font: (event.target.value || undefined) as TextStyle["font"],
                })
              }
            >
              <option value="">Jak na stronie</option>
              <option value="display">Nagłówkowa</option>
              <option value="body">Tekstowa</option>
              <option value="serif">Szeryfowa systemowa</option>
              <option value="sans">Bezszeryfowa systemowa</option>
            </select>
          </label>
          <label className="text-sm text-ink">
            Wielkość
            <select
              className="mt-1 min-h-11 w-full rounded-md border border-line bg-paper px-3"
              value={draftStyle?.size ?? ""}
              onChange={(event) =>
                onStyle({
                  ...draftStyle,
                  size: (event.target.value || undefined) as TextStyle["size"],
                })
              }
            >
              <option value="">Jak na stronie</option>
              <option value="sm">Mniejszy</option>
              <option value="md">Zwykły</option>
              <option value="lg">Większy</option>
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            variant={draftStyle?.bold ? "forest" : "outline"}
            onClick={() => onStyle({ ...draftStyle, bold: !draftStyle?.bold })}
          >
            Pogrubienie
          </Button>
          <Button
            type="button"
            variant={draftStyle?.italic ? "forest" : "outline"}
            onClick={() => onStyle({ ...draftStyle, italic: !draftStyle?.italic })}
          >
            Kursywa
          </Button>
          <Button type="button" variant="ghost" onClick={() => onStyle(null)}>
            Standardowe formatowanie
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button type="button" onClick={onSave}>
            Zapisz
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Anuluj
          </Button>
        </div>
      </div>
    </div>
  );
}
