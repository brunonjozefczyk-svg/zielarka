import { EditableText } from "@/components/EditableText";

export function PageIntro({
  kicker,
  title,
  lead,
  edit,
}: {
  kicker: string;
  title: string;
  lead: string;
  edit?: { title: string; lead: string };
}) {
  return (
    <header className="mx-auto max-w-3xl px-4 pb-12 pt-14 sm:px-6 sm:pt-20">
      <p className="text-xs uppercase tracking-[0.22em] text-clay">{kicker}</p>
      {edit ? (
        <EditableText
          id={edit.title}
          as="h1"
          defaultValue={title}
          className="mt-3 font-display text-4xl font-medium leading-tight text-forest sm:text-5xl"
        />
      ) : (
        <h1 className="mt-3 font-display text-4xl font-medium leading-tight text-forest sm:text-5xl">
          {title}
        </h1>
      )}
      {edit ? (
        <EditableText
          id={edit.lead}
          defaultValue={lead}
          className="mt-5 text-lg leading-relaxed text-muted"
        />
      ) : (
        <p className="mt-5 text-lg leading-relaxed text-muted">{lead}</p>
      )}
    </header>
  );
}