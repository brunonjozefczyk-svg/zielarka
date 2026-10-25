import { createFileRoute, Link } from "@tanstack/react-router";
import { EditableImage } from "@/components/EditableImage";
import { EditableText } from "@/components/EditableText";
import { PageIntro } from "@/components/PageIntro";
import { SiteShell } from "@/components/SiteShell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/warsztaty")({ component: WorkshopsPage });

const items = [
  {
    slug: "stol",
    title: "Warsztat przy stole",
    image: "/images/workshop.jpg",
    alt: "Warsztat zielarski — słoiki, nożyce, napar",
    body: "Suszenie, mieszanki, napary, octy, oleje. Mała grupa, ręce w materiale, zero slajdów „na później”. Wynosisz wiedzę i zwykle słoik.",
  },
  {
    slug: "spacer",
    title: "Spacer zielarski",
    image: "/images/forest-walk.jpg",
    alt: "Koszyk na leśnej ścieżce",
    body: "Łąka, skraj lasu, pobocze — tam, gdzie rośliny naprawdę rosną. Uczymy się patrzeć: liść, zapach, siedlisko, pomyłka, której nie warto zbierać.",
  },
  {
    slug: "sezon",
    title: "Sezon",
    image: "/images/hero-meadow.jpg",
    alt: "Łąka o świcie",
    body: "Program idzie za kalendarzem, nie za algorytmem. Wiosna to pokrzywa i pąki. Czerwiec — lipa. Lato — zbiór. Jesień — spiżarnia. Terminy ogłaszam na Instagramie i tutaj, gdy strona stanie się stałym adresem.",
  },
];

function WorkshopsPage() {
  return (
    <SiteShell>
      <PageIntro
        kicker="Nauka przez praktykę"
        title="Warsztaty i spacery"
        lead="Zielarstwo, które da się zrobić rękami. W terenie i przy kuchennym stole."
        edit={{ title: "warsztaty.title", lead: "warsztaty.lead" }}
      />
      <div className="mx-auto max-w-6xl space-y-16 px-4 pb-20 sm:px-6">
        {items.map((item, i) => (
          <article key={item.slug} className="grid items-center gap-8 lg:grid-cols-2">
            <EditableImage
              id={`img.warsztaty.${item.slug}`}
              src={item.image}
              alt={item.alt}
              wrapClassName={i % 2 ? "lg:order-2" : undefined}
              className="h-[340px] w-full rounded-lg object-cover"
            />
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-clay">
                {String(i + 1).padStart(2, "0")}
              </p>
              <EditableText
                id={`warsztaty.${item.slug}.title`}
                as="h2"
                defaultValue={item.title}
                className="mt-2 font-display text-3xl text-forest"
              />
              <EditableText
                id={`warsztaty.${item.slug}.body`}
                defaultValue={item.body}
                className="mt-4 leading-relaxed text-muted"
              />
            </div>
          </article>
        ))}
        <div className="rounded-lg border border-line bg-cream p-8">
          <EditableText
            id="warsztaty.ctaTitle"
            as="h2"
            defaultValue="Chcesz dostać się na kolejny?"
            className="font-display text-2xl text-forest"
          />
          <EditableText
            id="warsztaty.ctaLead"
            defaultValue="Napisz, czy bliżej Ci do stołu, czy do łąki. Dam znać, kiedy zbieram grupę."
            className="mt-3 max-w-xl text-muted leading-relaxed"
          />
          <Button asChild className="mt-6">
            <Link to="/kontakt">Zgłoś się</Link>
          </Button>
        </div>
      </div>
    </SiteShell>
  );
}