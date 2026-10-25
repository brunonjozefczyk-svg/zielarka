import { createFileRoute, Link } from "@tanstack/react-router";
import { EditableImage } from "@/components/EditableImage";
import { EditableText } from "@/components/EditableText";
import { PageIntro } from "@/components/PageIntro";
import { SiteShell } from "@/components/SiteShell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/konsultacje")({ component: ConsultPage });

const steps = [
  {
    title: "List",
    body: "Piszesz, z czym przychodzisz: sen, trawienie, cykle, odporność, zmęczenie, „coś jest nie tak”. Bez formularza na pięć stron — kilka szczerych zdań wystarczy.",
  },
  {
    title: "Rozmowa",
    body: "Spotykamy się online albo umawiamy głos. Słucham, pytam, układam obraz. Nie stawiając diagnozy lekarskiej — szukając, gdzie rośliny mogą realnie pomóc.",
  },
  {
    title: "Plan",
    body: "Dostajesz konkret: które zioła, w jakiej formie, na jak długo, czego nie łączyć. Prosto, do wykonania w domu.",
  },
  {
    title: "Opieka",
    body: "Jeśli potrzeba, zostajemy w kontakcie. Ziołowa opieka 1:1 to nie jednorazowa lista zakupów — to towarzyszenie, kiedy ciało się przestawia.",
  },
];

function ConsultPage() {
  return (
    <SiteShell>
      <PageIntro
        kicker="Konsultacje"
        title="Ziołowa opieka 1:1"
        lead="Indywidualna praca z roślinami. Spokojna, konkretna, bez obietnic cudu."
        edit={{ title: "consult.title", lead: "consult.lead" }}
      />
      <div className="mx-auto max-w-6xl px-4 pb-8 sm:px-6">
        <EditableImage
          id="img.consult"
          src="/images/tea.jpg"
          alt="Napar ziołowy w ceramicznej filiżance"
          className="h-[380px] w-full rounded-lg object-cover"
        />
      </div>
      <ol className="mx-auto grid max-w-6xl gap-6 px-4 py-12 sm:px-6 md:grid-cols-2">
        {steps.map((step, i) => (
          <li key={step.title} className="rounded-lg border border-line bg-cream p-6">
            <p className="text-xs uppercase tracking-[0.18em] text-clay">
              {String(i + 1).padStart(2, "0")}
            </p>
            <EditableText
              id={`consult.step.${i}.title`}
              as="h2"
              defaultValue={step.title}
              className="mt-2 font-display text-2xl text-forest"
            />
            <EditableText
              id={`consult.step.${i}.body`}
              defaultValue={step.body}
              className="mt-3 leading-relaxed text-muted"
            />
          </li>
        ))}
      </ol>
      <div className="mx-auto max-w-3xl px-4 pb-20 sm:px-6">
        <p className="leading-relaxed text-muted">
          Konsultacja nie zastępuje wizyty u lekarza. Jeśli masz rozpoznaną chorobę, bierzesz
          leki, jesteś w ciąży albo karmisz — powiedz o tym na początku. Rośliny są mocne. Dlatego
          dobieram je ostrożnie.
        </p>
        <Button asChild size="lg" className="mt-8">
          <Link to="/kontakt">Umów konsultację</Link>
        </Button>
      </div>
    </SiteShell>
  );
}
