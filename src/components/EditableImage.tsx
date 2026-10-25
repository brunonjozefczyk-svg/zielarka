import { useRef, useState } from "react";
import { toast } from "sonner";
import { resizeImageFile, saveImage, useEditMode, useLiveImage } from "@/lib/site-editor";
import { cn } from "@/lib/utils";

export function EditableImage({
  id,
  src,
  alt,
  className,
  wrapClassName,
  width,
  height,
  loading,
  scrim,
  control = "bottom",
}: {
  id: string;
  src: string;
  alt: string;
  className?: string;
  wrapClassName?: string;
  width?: number;
  height?: number;
  loading?: "lazy" | "eager";
  scrim?: boolean;
  control?: "bottom" | "top";
}) {
  const { editing } = useEditMode();
  const live = useLiveImage(id, src);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Wybierz zdjęcie.");
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await resizeImageFile(file);
      await saveImage(id, dataUrl);
      toast.success("Zdjęcie zmienione na tym telefonie.");
    } catch {
      toast.error("Nie udało się wczytać zdjęcia.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className={cn("relative block", wrapClassName)}>
      <img
        src={live}
        alt={alt}
        width={width}
        height={height}
        loading={loading}
        className={className}
      />
      {scrim ? (
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-forest-deep/90 via-forest-deep/40 to-forest/25" />
      ) : null}
      {editing ? (
        <>
          <button
            type="button"
            className={cn(
              "absolute z-10 min-h-11 rounded-md bg-forest px-3 text-sm text-cream",
              control === "top" ? "right-3 top-24" : "bottom-3 right-3",
            )}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              inputRef.current?.click();
            }}
          >
            {busy ? "Wczytuję…" : "Zmień zdjęcie"}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </>
      ) : null}
    </span>
  );
}