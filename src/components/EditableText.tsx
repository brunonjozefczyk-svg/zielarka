import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getCopy, saveCopy, useCopy, useEditMode } from "@/lib/site-editor";
import { cn } from "@/lib/utils";

type Tag = "p" | "h1" | "h2" | "h3" | "span";

export function EditableText({
  id,
  as = "p",
  defaultValue,
  className,
}: {
  id: string;
  as?: Tag;
  defaultValue: string;
  className?: string;
}) {
  const { editing } = useEditMode();
  const value = useCopy(id, defaultValue);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const Tag = as;

  if (!editing) {
    return <Tag className={className}>{value}</Tag>;
  }

  return (
    <>
      <button
        type="button"
        className={cn(
          "w-full rounded-sm text-left outline-2 outline-dashed outline-clay/80",
          className,
        )}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDraft(getCopy(id, defaultValue));
          setOpen(true);
        }}
      >
        {value}
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-[60] bg-ink/40"
          onClick={() => setOpen(false)}
        >
          <div
            className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-auto rounded-t-lg bg-paper p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-xs uppercase tracking-[0.16em] text-clay">Edycja tekstu</p>
            <Textarea
              className="mt-3 min-h-40"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
            />
            <div className="mt-4 flex flex-wrap gap-3">
              <Button
                type="button"
                onClick={() => {
                  const next = draft.trim();
                  if (!next) {
                    toast.error("Tekst nie może być pusty.");
                    return;
                  }
                  void saveCopy(id, next)
                    .then(() => {
                      setOpen(false);
                      toast.success("Zapisane. Widać to też na innych telefonach.");
                    })
                    .catch(() => toast.error("Nie udało się zapisać. Sprawdź hasło i sieć."));
                }}
              >
                Zapisz
              </Button>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Anuluj
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}