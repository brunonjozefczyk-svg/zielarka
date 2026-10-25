import { createFileRoute, Link } from "@tanstack/react-router";
import { EditableImage } from "@/components/EditableImage";
import { EditableText } from "@/components/EditableText";
import { PageIntro } from "@/components/PageIntro";
import { SiteShell } from "@/components/SiteShell";
import { Button } from "@/components/ui/button";
import { site } from "@/lib/content";
import { metaFor } from "@/lib/seo";

export const Route = createFileRoute("/o-mnie")({
  head: () =>
    metaFor({
      title: "Sabina Józefczyk — zielarka-fitoterapeutka | Zielarka.pl",
      description:
        "Sabina Józefczyk prowadzi Zielarka.pl od 2024 roku. Kurs zielarz-fitoterapeuta, studia podyplomowe i kurs fitoterapii. Konsultacje, warsztaty i spacery.",
      path: "/o-mnie",
    }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <SiteShell>
      <PageIntro
        kicker="O mnie"
        title="Sabina Józefczyk"
        lead="Zielarka-fitoterapeutka od 2024 roku. Zielarka.pl — wiedza, tradycja i natura."
        edit={{ title: "about.title", lead: "about.lead" }}
      />
      <div className="mx-auto grid max-w-6xl gap-10 px-4 pb-20 sm:px-6 lg:grid-cols-2">
        <EditableImage
          id="img.about"
          src="/images/workshop.jpg"
          alt="Stół zielarski z słoikami i notatnikiem"
          className="h-[480px] w-full rounded-lg object-cover"
        />
        <div className="space-y-5 text-base leading-relaxed text-muted">
          <EditableText
            id="about.p1"
            defaultValue="Prowadzę zielarka.pl jako praktykę, nie sklep z cudownymi mieszankami. Zioła są konkretne: mają smak, sezon, przeciwwskazania i historię. Moja praca polega na tym, żeby tę konkretność oddać dalej — na konsultacji, na warsztacie, na spacerze."
          />
          <EditableText
            id="about.p2"
            defaultValue="Jestem zielarką-fitoterapeutką od 2024 roku. Skończyłam kurs zawodowy „Zielarz-fitoterapeuta” i studia podyplomowe „Zioła, suplementy diety i kosmetyki naturalne”, a aktualnie jestem w trakcie kursu u dr. Henryka Różańskiego „Fitoterapia szczegółowa człowieka”. Konsultacje prowadzę indywidualnie, także na odległość. Warsztaty i spacery — tam, gdzie rośliny rosną."
          />
          <p>
            Najwięcej osób jest ze mną na{" "}
            <a href={site.facebook} className="text-forest underline" target="_blank" rel="noreferrer">
              Facebooku
            </a>{" "}
            ({site.facebookFollowers}) oraz jako{" "}
            <a href={site.instagram} className="text-forest underline" target="_blank" rel="noreferrer">
              @zielarka.pl
            </a>{" "}
            na Instagramie ({site.instagramFollowers}) i TikToku. Tam codzienność. Tutaj — spokojniejsze
            miejsce: oferta, zielnik, zgłoszenie na opiekę.
          </p>
          <EditableText
            id="about.p4"
            defaultValue="Jeśli szukasz kogoś, kto „przepisze ziółka na wszystko”, nie jestem tą osobą. Jeśli chcesz nauczyć się korzystać z roślin z głową i wrócić do równowagi — zapraszam."
          />
          <div className="flex flex-wrap gap-3 pt-4">
            <Button asChild>
              <Link to="/kontakt">Napisz</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/konsultacje">Konsultacje</Link>
            </Button>
          </div>
        </div>
      </div>
    </SiteShell>
  );
}