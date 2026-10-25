export const site = {
  name: "Zielarka.pl",
  person: "Sabina Józefczyk",
  url: "https://zielarka.pl",
  tagline: "Zioła w codzienności. Wiedza, tradycja i natura.",
  bio: "Jestem zielarką-fitoterapeutką od 2024 roku. Skończyłam kurs zawodowy „Zielarz-fitoterapeuta” i studia podyplomowe „Zioła, suplementy diety i kosmetyki naturalne”, a aktualnie jestem w trakcie kursu u dr. Henryka Różańskiego „Fitoterapia szczegółowa człowieka”.",
  instagram: "https://www.instagram.com/zielarka.pl/",
  tiktok: "https://www.tiktok.com/@zielarka.pl",
  facebook: "https://www.facebook.com/zielarka.pl",
  klub: "https://klub-zielarski.circle.so/klub-zielarki",
  region: "Kraków",
  education:
    "Zielarka-fitoterapeutka od 2024. Kurs zawodowy Zielarz-fitoterapeuta. Studia podyplomowe: Zioła, suplementy diety i kosmetyki naturalne. Kurs u dr. Henryka Różańskiego: Fitoterapia szczegółowa człowieka.",
  facebookFollowers: "41 tys. obserwujących",
  instagramFollowers: "11,6 tys. obserwujących",
};

export { herbs, getHerb, relatedHerbs } from "./herbs";
export type { Herb, HerbFaq } from "./herbs";

export type Offer = {
  slug: string;
  title: string;
  kicker: string;
  lead: string;
  href: "/konsultacje" | "/warsztaty" | "/klub";
  image: string;
  alt: string;
};

export const offers: Offer[] = [
  {
    slug: "opieka",
    title: "Ziołowa opieka 1:1",
    kicker: "Konsultacje",
    lead: "Indywidualna rozmowa o tym, co dzieje się w ciele i jak naturalne metody mogą Cię wesprzeć. Kliknij, żeby sprawdzić, czy mogę Ci pomóc.",
    href: "/konsultacje",
    image: "/images/consult-table.jpg",
    alt: "Stół konsultacji: dwa kubki naparu, notes i suszone zioła",
  },
  {
    slug: "warsztaty",
    title: "Warsztaty i spacery",
    kicker: "Nauka przez praktykę",
    lead: "Chcesz wziąć udział w warsztatach lub spacerze zielarskim? Napisz do mnie, a powiem Ci, gdzie zaplanowane są najbliższe wydarzenia. A może chcesz, żebym przyjechała na wydarzenie organizowane przez Ciebie? Zapraszam do kontaktu.",
    href: "/warsztaty",
    image: "/images/forest-walk.jpg",
    alt: "Koszyk z zebranymi ziołami na leśnej ścieżce",
  },
  {
    slug: "klub",
    title: "Klub Zielarski",
    kicker: "Wiedza w Twoim telefonie",
    lead: "Twoje miejsce w internecie, gdzie nauczysz się, jak korzystać z ziół. Znajdziesz tu ziołową wiedzę, spacery zielarskie i przepisy na ziołowe preparaty i potrawy. I to wszystko z moim wsparciem.",
    href: "/klub",
    image: "/images/klub-phone.jpg",
    alt: "Telefon z wiedzą zielarską obok notesu i świeżej mięty",
  },
];

export const nav = [
  { to: "/", label: "Start" },
  { to: "/o-mnie", label: "O mnie" },
  { to: "/konsultacje", label: "Konsultacje" },
  { to: "/warsztaty", label: "Warsztaty" },
  { to: "/klub", label: "Klub Zielarski" },
  { to: "/zielnik", label: "Zielnik" },
  { to: "/kontakt", label: "Kontakt" },
] as const;
