import { herbs, type Herb } from "./herbs";
import { site } from "./content";

export function pageTitle(title: string) {
  return `${title} | ${site.name}`;
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

export function herbariumJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Zielnik — rośliny w codzienności",
    description:
      "Praktyczny zielnik: pokrzywa, rumianek, krwawnik, kwiat lipy, melisa i szałwia. Sezon, zbiór, napar i tradycja.",
    url: `${site.url}/zielnik`,
    inLanguage: "pl-PL",
    author: personJsonLd(),
    isPartOf: { "@type": "WebSite", name: site.name, url: site.url },
    mainEntity: {
      "@type": "ItemList",
      itemListElement: herbs.map((herb, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: `${site.url}/zielnik/${herb.slug}`,
        name: `${herb.name} (${herb.latin})`,
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
    image: `${site.url}${herb.image}`,
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