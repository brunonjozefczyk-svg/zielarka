import { Link } from "@tanstack/react-router";
import { EditableImage } from "@/components/EditableImage";
import { EditableText } from "@/components/EditableText";
import type { Herb } from "@/lib/herbs";
import { useEditMode } from "@/lib/site-editor";

export function HerbCard({ herb }: { herb: Herb }) {
  const { editing } = useEditMode();
  const body = (
    <>
      <EditableImage
        id={`img.herb.${herb.slug}`}
        src={herb.image}
        alt={herb.alt}
        width={800}
        height={520}
        loading="lazy"
        className="h-52 w-full object-cover"
      />
      <div className="p-5">
        <h2 className="font-display text-2xl text-forest group-hover:underline">{herb.name}</h2>
        <p className="mt-1 text-sm italic text-muted">{herb.latin}</p>
        <EditableText
          id={`herb.${herb.slug}.note`}
          defaultValue={herb.note}
          className="mt-3 line-clamp-3 text-sm leading-relaxed text-muted"
        />
        <p className="mt-4 text-xs uppercase tracking-[0.16em] text-clay">{herb.season}</p>
      </div>
    </>
  );

  if (editing) {
    return (
      <div className="flex flex-col overflow-hidden rounded-lg border border-line bg-cream">{body}</div>
    );
  }

  return (
    <Link
      to="/zielnik/$slug"
      params={{ slug: herb.slug }}
      className="group flex flex-col overflow-hidden rounded-lg border border-line bg-cream transition-colors hover:border-forest"
    >
      {body}
    </Link>
  );
}