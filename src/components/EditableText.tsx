import { lazy, Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { useEdits } from "@/lib/edits-context";
import { getCopy, notedTextStyle, saveCopy, useCopy, useEditMode } from "@/lib/site-editor";
import { textInline, type TextStyle } from "@/lib/theme";
import { cn } from "@/lib/utils";

const TextFormatDialog = lazy(() =>
  import("@/components/TextFormatDialog").then((mod) => ({ default: mod.TextFormatDialog })),
);

type Tag = "p" | "h1" | "h2" | "h3" | "span";

function useTextStyle(id: string) {
  const saved = useEdits().styles?.[id] ?? null;
  const [noted, setNoted] = useState<TextStyle | null | undefined>(undefined);
  useEffect(() => {
    const apply = () => setNoted(notedTextStyle(id));
    apply();
    window.addEventListener("zielarka-site-editor", apply);
    return () => window.removeEventListener("zielarka-site-editor", apply);
  }, [id]);
  return noted === undefined ? saved : noted;
}

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
  const style = useTextStyle(id);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [draftStyle, setDraftStyle] = useState<TextStyle | null>(style);
  const Tag = as;
  const inline = textInline(style);

  if (!editing) {
    return (
      <Tag className={className} style={inline}>
        {value}
      </Tag>
    );
  }

  return (
    <>
      <button
        type="button"
        className={cn("w-full rounded-sm text-left outline-2 outline-dashed outline-clay/80", className)}
        style={inline}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDraft(getCopy(id, value));
          setDraftStyle(style);
          setOpen(true);
        }}
      >
        {value}
      </button>
      {open ? (
        <Suspense fallback={null}>
          <TextFormatDialog
            draft={draft}
            draftStyle={draftStyle}
            onDraft={setDraft}
            onStyle={setDraftStyle}
            onClose={() => setOpen(false)}
            onSave={() => {
              const next = draft.trim();
              if (!next) {
                toast.error("Tekst nie może być pusty.");
                return;
              }
              void saveCopy(id, next, draftStyle)
                .then(() => {
                  setOpen(false);
                  toast.success("Zapisane. Widać to też na innych telefonach.");
                })
                .catch((error: unknown) => {
                  const text = error instanceof Error ? error.message : "";
                  toast.error(text && text.length < 180 ? text : "Nie udało się zapisać. Sprawdź hasło i sieć.");
                });
            }}
          />
        </Suspense>
      ) : null}
    </>
  );
}
