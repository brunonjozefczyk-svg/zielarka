import { createFileRoute, Link } from "@tanstack/react-router";
import { HerbCard } from "@/components/HerbCard";
import { JsonLd } from "@/components/JsonLd";
import { PageIntro } from "@/components/PageIntro";
import { SiteShell } from "@/components/SiteShell";
import { herbs, site } from "@/lib/content";
import { useMergedHerbs } from "@/lib/herb-editor";
import { breadcrumbJsonLd, herbariumJsonLd } from "@/lib/seo";

export const Route = createFileRoute("/zielnik/")({
  component: HerbalPage,
  head: () => ({
    meta: [
      { title: "Zielnik ziół: pokrzywa, rumianek, lipa | Zielarka" },
      {
        name: "description",
        content:
          "Zielnik Sabiny Józefczyk: pokrzywa, rumianek, krwawnik, kwiat lipy, melisa i szałwia. Sezon, zbiór, napar i tradycja — nie encyklopedia i nie porada medyczna.",
      },
      { name: "author", content: site.person },
    ],
    links: [{ rel: "canonical", href: `${site.url}/zielnik` }],
  }),
});

function HerbalPage() {
  const list = useMergedHerbs();
  return (
    <SiteShell>
      <JsonLd data={herbariumJsonLd()} />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Start", url: site.url },
          { name: "Zielnik", url: `${site.url}/zielnik` },
        ])}
      />
      <PageIntro
        kicker="Zielnik"
        title="Rośliny w polskiej codzienności"
        lead="Krótki, praktyczny wybór — nie encyklopedia. Każda karta to osobna strona: jak rozpoznać, kiedy zbierać, jak zaparzyć i kiedy odłożyć. Opisy tradycyjne, nie porada medyczna."
      />
      <div className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <nav aria-label="Okruszki" className="mb-10 text-sm text-muted">
          <Link to="/" className="hover:text-forest">
            Start
          </Link>
          <span className="mx-2 text-line">/</span>
          <span className="text-ink">Zielnik</span>
        </nav>
        <p className="mb-12 max-w-2xl text-base leading-relaxed text-muted">
          Szukasz konkretnej rośliny — wejdź w jej nazwę. To nie jest spis „właściwości
          leczniczych z internetu”. To zielnik praktyczny: sezon, zbiór, napar, ostrożność.
          Prowadzi go {site.person}, zielarka-fitoterapeutka z {site.region}.
        </p>
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((herb) => (
            <li key={herb.slug}>
              <HerbCard herb={herb} />
            </li>
          ))}
        </ul>
        <p className="mt-14 max-w-2xl text-sm leading-relaxed text-muted">
          Zbiór dzikich roślin wymaga pewności gatunku i czystego stanowiska. W razie
          wątpliwości — zostaw roślinę. Zielarstwo nie zastępuje lekarza.
        </p>
      </div>
    </SiteShell>
  );
}