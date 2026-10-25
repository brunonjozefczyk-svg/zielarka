import { EditableImage } from "@/components/EditableImage";
import { EditableText } from "@/components/EditableText";
import { HerbCopyEditor } from "@/components/HerbCopyEditor";
import { JsonLd } from "@/components/JsonLd";
import { SiteShell } from "@/components/SiteShell";
import { Button } from "@/components/ui/button";
import { getHerb, relatedHerbs, site } from "@/lib/content";
import { useMergedHerb } from "@/lib/herb-editor";
import { breadcrumbJsonLd, herbArticleJsonLd, herbFaqJsonLd } from "@/lib/seo";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";

export const Route = createFileRoute("/zielnik/$slug")({
  loader: ({ params }) => {
    const herb = getHerb(params.slug);
    if (!herb) throw notFound();
    return { herb, related: relatedHerbs(herb) };
  },
  head: ({ loaderData }) => {
    const herb = loaderData?.herb;
    if (!herb) return {};
    return {
      meta: [
        { title: herb.seoTitle },
        { name: "description", content: herb.seoDescription },
        { name: "author", content: site.person },
        { property: "og:title", content: herb.seoTitle },
        { property: "og:description", content: herb.seoDescription },
        { property: "og:image", content: `${site.url}${herb.image}` },
      ],
      links: [{ rel: "canonical", href: `${site.url}/zielnik/${herb.slug}` }],
    };
  },
  component: HerbPage,
});

function HerbPage() {
  const { herb: original, related } = Route.useLoaderData();
  const herb = useMergedHerb(original);

  return (
    <SiteShell>
      <JsonLd data={herbArticleJsonLd(herb)} />
      <JsonLd data={herbFaqJsonLd(herb)} />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Start", url: site.url },
          { name: "Zielnik", url: `${site.url}/zielnik` },
          { name: herb.name, url: `${site.url}/zielnik/${herb.slug}` },
        ])}
      />
      <article className="pb-20">
        <header className="mx-auto max-w-6xl px-4 pt-14 sm:px-6 sm:pt-20">
          <nav aria-label="Okruszki" className="text-sm text-muted">
            <Link to="/" className="hover:text-forest">
              Start
            </Link>
            <span className="mx-2 text-line">/</span>
            <Link to="/zielnik" className="hover:text-forest">
              Zielnik
            </Link>
            <span className="mx-2 text-line">/</span>
            <span className="text-ink">{herb.name}</span>
          </nav>
          <p className="mt-8 text-xs uppercase tracking-[0.22em] text-clay">Zielnik</p>
          <h1 className="mt-3 max-w-3xl font-display text-4xl font-medium leading-tight text-forest sm:text-5xl">
            {herb.name}{" "}
            <span className="block text-2xl italic font-normal text-muted sm:text-3xl">
              {herb.latin}
            </span>
          </h1>
          <EditableText
            id={`herb.${herb.slug}.lead`}
            defaultValue={herb.lead}
            className="mt-5 max-w-2xl text-lg leading-relaxed text-muted"
          />
          <HerbCopyEditor herb={herb} />
        </header>

        <div className="mx-auto mt-10 grid max-w-6xl items-start gap-10 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <EditableImage
            id={`img.herb.${herb.slug}`}
            src={herb.image}
            alt={herb.alt}
            width={900}
            height={720}
            className="h-[420px] w-full rounded-lg object-cover"
          />
          <dl className="grid gap-6 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-[0.16em] text-clay">Część rośliny</dt>
              <dd className="mt-1 text-ink">{herb.part}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.16em] text-clay">Sezon zbioru</dt>
              <dd className="mt-1 text-ink">{herb.season}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs uppercase tracking-[0.16em] text-clay">Gdzie rośnie</dt>
              <dd className="mt-1 text-ink">{herb.habitat}</dd>
            </div>
            <div className="sm:col-span-2 rounded-lg border border-line bg-cream p-5 text-sm leading-relaxed text-muted">
              Pisze {site.person}, zielarka-fitoterapeutka. {site.education}. Opis ma charakter
              edukacyjny i tradycyjny — nie zastępuje konsultacji lekarskiej.
            </div>
          </dl>
        </div>

        <div className="mx-auto mt-16 max-w-3xl space-y-12 px-4 sm:px-6">
          <section>
            <h2 className="font-display text-3xl text-forest">Jak rozpoznać</h2>
            <p className="mt-4 leading-relaxed text-muted">{herb.recognize}</p>
          </section>
          <section>
            <h2 className="font-display text-3xl text-forest">Sezon i zbiór</h2>
            <p className="mt-4 leading-relaxed text-muted">{herb.harvest}</p>
          </section>
          <section>
            <h2 className="font-display text-3xl text-forest">Napar i kuchnia</h2>
            <p className="mt-4 leading-relaxed text-muted">{herb.prepare}</p>
          </section>
          <section>
            <h2 className="font-display text-3xl text-forest">W tradycji</h2>
            <p className="mt-4 leading-relaxed text-muted">{herb.tradition}</p>
          </section>
          <section>
            <h2 className="font-display text-3xl text-forest">Ostrożność</h2>
            <p className="mt-4 leading-relaxed text-muted">{herb.caution}</p>
          </section>

          <section>
            <h2 className="font-display text-3xl text-forest">Pytania</h2>
            <dl className="mt-6 space-y-6">
              {herb.faqs.map((item) => (
                <div key={item.q} className="border-b border-line pb-6">
                  <dt className="font-medium text-ink">{item.q}</dt>
                  <dd className="mt-2 leading-relaxed text-muted">{item.a}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>

        {related.length > 0 ? (
          <aside className="mx-auto mt-16 max-w-6xl px-4 sm:px-6">
            <h2 className="font-display text-2xl text-forest">Obok w zielniku</h2>
            <ul className="mt-6 grid gap-4 sm:grid-cols-2">
              {related.map((item) => (
                <li key={item.slug}>
                  <Link
                    to="/zielnik/$slug"
                    params={{ slug: item.slug }}
                    className="flex gap-4 rounded-lg border border-line bg-cream p-3 hover:border-forest"
                  >
                    <img
                      src={item.image}
                      alt={item.alt}
                      width={160}
                      height={120}
                      loading="lazy"
                      className="size-20 rounded-md object-cover"
                    />
                    <span>
                      <span className="block font-display text-xl text-forest">{item.name}</span>
                      <span className="mt-1 block text-sm italic text-muted">{item.latin}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </aside>
        ) : null}

        <div className="mx-auto mt-16 max-w-3xl px-4 sm:px-6">
          <div className="rounded-lg border border-line bg-cream p-8">
            <p className="text-xs uppercase tracking-[0.18em] text-clay">Dalej</p>
            <p className="mt-3 font-display text-2xl text-forest">
              Roślina z zielnika to nie konsultacja.
            </p>
            <p className="mt-3 leading-relaxed text-muted">
              Jeśli ciało prosi o uwagę — napisz. Dobierzemy formę: opiekę 1:1, warsztat albo
              spacer.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild>
                <Link to="/konsultacje">Konsultacje</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/warsztaty">Warsztaty</Link>
              </Button>
            </div>
          </div>
        </div>
      </article>
    </SiteShell>
  );
}