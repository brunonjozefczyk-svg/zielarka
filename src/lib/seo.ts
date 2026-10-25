import { herbs, type Herb } from "./herbs";
import { site } from "./content";

export function metaFor(opts: { title: string; description: string; path: string }) {
  const url = opts.path === "/" ? site.url : `${site.url}${opts.path}`;
  return {
    meta: [
      { title: opts.title },
      { name: "description", content: opts.description },
      { name: "author", content: site.person },
      { property: "og:title", content: opts.title },
      { property: "og:description", content: opts.description },
      { property: "og:url", content: url },
      { property: "og:image", content: `${site.url}/og.jpg` },
      { property: "og:type", content: "website" },
      { property: "og:locale", content: "pl_PL" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}

export function homeJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    name: site.name,
    url: site.url,
    image: `${site.url}/og.jpg`,
    description:
      "Sabina Józefczyk, zielarka-fitoterapeutka. Konsultacje, warsztaty, spacery i Klub Zielarski. Kraków i okolice.",
    areaServed: {
      "@type": "AdministrativeArea",
      name: "Kraków i województwo małopolskie",
    },
    founder: personJsonLd(),
    sameAs: [site.facebook, site.instagram, site.tiktok],
    inLanguage: "pl-PL",
  };
}

export function personJsonLd() {
  return {
    "@type": "Person",
    name: site.person,
    jobTitle: "Zielarka-fitoterapeutka",
    url: `${site.url}/o-mnie`,
    sameAs: [site.facebook, site.instagram, site.tiktok],
    address: {
      "@type": "PostalAddress",
      addressLocality: site.region,
      addressCountry: "PL",
    },
  };
}

function absoluteImage(image: string) {
  if (image.startsWith("https://") || image.startsWith("http://")) return image;
  return `${site.url}${image.startsWith("/") ? image : `/${image}`}`;
}

export function herbariumJsonLd(list: Herb[] = herbs) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Zielnik — rośliny w codzienności",
    description:
      "Praktyczny zielnik: sezon, zbiór, napar i tradycja. Opisy edukacyjne, nie porada medyczna.",
    url: `${site.url}/zielnik`,
    inLanguage: "pl-PL",
    author: personJsonLd(),
    isPartOf: { "@type": "WebSite", name: site.name, url: site.url },
    mainEntity: {
      "@type": "ItemList",
      itemListElement: list.map((herb, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: `${site.url}/zielnik/${herb.slug}`,
        name: herb.latin && herb.latin !== "—" ? `${herb.name} (${herb.latin})` : herb.name,
      })),
    },
  };
}

export function herbArticleJsonLd(herb: Herb) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: `${herb.name} (${herb.latin}) w tradycji zielarskiej`,
    description: herb.seoDescription,
    image: absoluteImage(herb.image),
    inLanguage: "pl-PL",
    author: personJsonLd(),
    publisher: {
      "@type": "Organization",
      name: site.name,
      url: site.url,
    },
    mainEntityOfPage: `${site.url}/zielnik/${herb.slug}`,
    about: {
      "@type": "Thing",
      name: herb.name,
      alternateName: herb.latin,
    },
  };
}

export function herbFaqJsonLd(herb: Herb) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: herb.faqs.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

export function breadcrumbJsonLd(items: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}