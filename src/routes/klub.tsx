import { createFileRoute, Link } from "@tanstack/react-router";
import { EditableImage } from "@/components/EditableImage";
import { EditableText } from "@/components/EditableText";
import { PageIntro } from "@/components/PageIntro";
import { SiteShell } from "@/components/SiteShell";
import { Button } from "@/components/ui/button";
import { site } from "@/lib/content";
import { metaFor } from "@/lib/seo";

export const Route = createFileRoute("/klub")({
  head: () =>
    metaFor({
      title: "Klub Zielarski — wiedza o ziołach w telefonie | Zielarka.pl",
      description:
        "Internetowy Klub Zielarski Sabiny Józefczyk: ziołowa wiedza, spacery i przepisy na preparaty i potrawy, z jej wsparciem.",
      path: "/klub",
    }),
  component: ClubPage,
});

function ClubPage() {
  return (
    <SiteShell>
      <PageIntro
        kicker="Społeczność"
        title="Klub Zielarski"
        lead="Twoje miejsce w internecie, gdzie nauczysz się, jak korzystać z ziół. Ziołowa wiedza, spacery i przepisy — z moim wsparciem."
        edit={{ title: "klub.title", lead: "klub.lead" }}
      />
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-20 sm:px-6 lg:grid-cols-2">
        <EditableImage
          id="img.klub"
          src="/images/still-life.jpg"
          alt="Suszone zioła na lnie"
          className="h-[420px] w-full rounded-lg object-cover"
        />
        <div className="space-y-5 leading-relaxed text-muted">
          <EditableText
            id="klub.p1"
            defaultValue="Klub Zielarski to Twoje miejsce w internecie: ziołowa wiedza, spacery zielarskie i przepisy na ziołowe preparaty i potrawy. I to wszystko z moim wsparciem."
          />
          <EditableText
            id="klub.p2"
            defaultValue="Jeśli dopiero zaczynasz, klub nie zastąpi warsztatu w terenie. Jeśli już zbierasz, suszysz i gubisz się w ilości informacji — tu jest porządek i ktoś, kto odpowie."
          />
          <div className="flex flex-wrap gap-3 pt-2">
            <Button asChild>
              <a href={site.klub} target="_blank" rel="noreferrer">
                Wejdź do Klubu
              </a>
            </Button>
            <Button asChild variant="outline">
              <Link to="/kontakt">Zapytaj o dołączenie</Link>
            </Button>
          </div>
        </div>
      </div>
    </SiteShell>
  );
}
