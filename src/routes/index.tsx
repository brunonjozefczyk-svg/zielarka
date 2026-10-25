import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { EditableImage } from "@/components/EditableImage";
import { EditableText } from "@/components/EditableText";
import { HerbCard } from "@/components/HerbCard";
import { SiteShell } from "@/components/SiteShell";
import { Button } from "@/components/ui/button";
import { offers, site } from "@/lib/content";
import { useMergedHerbs } from "@/lib/herb-editor";
import { useEditMode } from "@/lib/site-editor";
import { homeJsonLd, metaFor } from "@/lib/seo";
import { JsonLd } from "@/components/JsonLd";

export const Route = createFileRoute("/")({
  head: () =>
    metaFor({
      title: "Zielarka.pl — konsultacje zielarskie, warsztaty i Klub Zielarski",
      description:
        "Sabina Józefczyk, zielarka-fitoterapeutka z Krakowa. Konsultacje 1:1, warsztaty, spacery zielarskie i internetowy Klub Zielarski.",
      path: "/",
    }),
  component: Home,
});

function Home() {
  const herbs = useMergedHerbs();
  const { editing } = useEditMode();

  return (
    <SiteShell>
      <JsonLd data={homeJsonLd()} />
      <section className="relative min-h-[88vh] overflow-hidden">
        <EditableImage
          id="img.home.hero"
          src="/images/hero-meadow.jpg"
          alt="Dzika łąka zielarska o świcie"
          wrapClassName="absolute inset-0 z-0"
          className="size-full object-cover"
          loading="eager"
          fetchPriority="high"
          width={1600}
          height={900}
          scrim
          control="top"
        />
        <div className="relative mx-auto flex min-h-[88vh] max-w-6xl flex-col justify-end px-4 pb-16 pt-32 sm:px-6 sm:pb-20">
          <EditableText
            id="home.person"
            as="p"
            defaultValue={site.person}
            className="text-xs uppercase tracking-[0.28em] text-cream/80"
          />
          <h1 className="mt-3 max-w-xl font-display text-5xl font-medium leading-[1.05] text-cream sm:text-7xl">
            Zielarka.pl
          </h1>
          <EditableText
            id="home.tagline"
            defaultValue={site.tagline}
            className="mt-5 max-w-md text-lg leading-relaxed text-cream/90"
          />
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild variant="cream" size="lg">
              <Link to="/konsultacje">Opieka 1:1</Link>
            </Button>
            <Button
              asChild
              size="lg"
              className="border border-cream/70 bg-forest-deep/70 text-cream hover:bg-cream hover:text-forest"
            >
              <Link to="/warsztaty">Warsztaty i spacery</Link>
            </Button>
            <Button
              asChild
              size="lg"
              className="border border-cream/70 bg-forest-deep/70 text-cream hover:bg-cream hover:text-forest"
            >
              <Link to="/klub">Klub Zielarski</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-clay">Jak mogę Cię wesprzeć?</p>
          <EditableText
            id="home.whyTitle"
            as="h2"
            defaultValue="Zioła mogą Cię wspierać dzień po dniu."
            className="mt-3 font-display text-3xl font-medium text-forest sm:text-4xl"
          />
          <EditableText
            id="home.whyLead"
            defaultValue="Uczę praktycznego zielarstwa — takiego, które może stać się częścią Twojego życia i wspierać Cię dzień po dniu. Konsultacje, warsztaty, spacery, internetowy Klub Zielarski."
            className="mt-5 text-lg leading-relaxed text-muted"
          />
          <Button asChild variant="outline" className="mt-8">
            <Link to="/o-mnie">
              O Sabinie
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
        <EditableImage
          id="img.home.paths.v2"
          src="/images/three-paths.jpg"
          alt="Stara mapa leśnych dróg zbiegających się przy Zdrowiu"
          className="h-[420px] w-full rounded-lg object-cover object-center"
        />
      </section>

      <section className="border-y border-line bg-cream">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <p className="text-xs uppercase tracking-[0.22em] text-clay">Oferta</p>
          <EditableText
            id="home.offersTitle"
            as="h2"
            defaultValue="Trzy drogi, jedna praktyka"
            className="mt-3 font-display text-3xl font-medium text-forest sm:text-4xl"
          />
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {offers.map((offer, i) => {
              const inner = (
                <>
                  <EditableImage
                    id={`img.offer.${offer.slug}.v2`}
                    src={offer.image}
                    alt={offer.alt}
                    className="h-48 w-full object-cover"
                  />
                  <div className="flex flex-1 flex-col p-6">
                    <p className="text-xs uppercase tracking-[0.18em] text-clay">
                      {String(i + 1).padStart(2, "0")} · {offer.kicker}
                    </p>
                    <EditableText
                      id={`offer.${offer.slug}.title`}
                      as="h3"
                      defaultValue={offer.title}
                      className="mt-2 font-display text-2xl text-forest"
                    />
                    <EditableText
                      id={`offer.${offer.slug}.lead`}
                      defaultValue={offer.lead}
                      className="mt-3 flex-1 text-sm leading-relaxed text-muted"
                    />
                    <span className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-forest">
                      Zobacz
                      <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </div>
                </>
              );
              return editing ? (
                <div
                  key={offer.slug}
                  className="flex flex-col overflow-hidden rounded-lg border border-line bg-paper"
                >
                  {inner}
                </div>
              ) : (
                <Link
                  key={offer.slug}
                  to={offer.href}
                  className="group flex flex-col overflow-hidden rounded-lg border border-line bg-paper transition-colors hover:border-forest"
                >
                  {inner}
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden">
        <EditableImage
          id="img.home.cta"
          src="/images/forest-walk.jpg"
          alt="Leśna ścieżka i koszyk ze zbiorem ziół"
          wrapClassName="absolute inset-0 z-0"
          className="size-full object-cover"
          scrim
          control="top"
        />
        <div className="relative mx-auto max-w-3xl px-4 py-24 text-center sm:px-6">
          <p className="text-xs uppercase tracking-[0.22em] text-cream/70">Następny krok</p>
          <EditableText
            id="home.ctaTitle"
            as="h2"
            defaultValue="Jeśli ciało prosi o uwagę — zacznijmy od rozmowy."
            className="mt-4 font-display text-3xl font-medium text-cream sm:text-5xl"
          />
          <EditableText
            id="home.ctaLead"
            defaultValue="Napisz, z czym przychodzisz. Dobierzemy formę: konsultację, warsztat albo miejsce w Klubie Zielarskim."
            className="mx-auto mt-5 max-w-lg text-cream/85 leading-relaxed"
          />
          <Button asChild variant="cream" size="lg" className="mt-8">
            <Link to="/kontakt">Napisz do mnie</Link>
          </Button>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-clay">Zielnik</p>
            <EditableText
              id="home.zielnikTitle"
              as="h2"
              defaultValue="Rośliny, które warto mieć pod ręką"
              className="mt-3 font-display text-3xl font-medium text-forest sm:text-4xl"
            />
          </div>
          <Button asChild variant="outline">
            <Link to="/zielnik">Cały zielnik</Link>
          </Button>
        </div>
        <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {herbs.map((herb) => (
            <li key={herb.slug}>
              <HerbCard herb={herb} />
            </li>
          ))}
        </ul>
      </section>
    </SiteShell>
  );
}