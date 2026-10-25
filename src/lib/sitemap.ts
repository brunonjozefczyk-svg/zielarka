const ORIGIN = "https://zielarka.pl";

const PAGES: { path: string; changefreq: string; priority: string }[] = [
  { path: "/", changefreq: "monthly", priority: "1.0" },
  { path: "/o-mnie", changefreq: "yearly", priority: "0.6" },
  { path: "/konsultacje", changefreq: "monthly", priority: "0.8" },
  { path: "/warsztaty", changefreq: "monthly", priority: "0.7" },
  { path: "/klub", changefreq: "monthly", priority: "0.6" },
  { path: "/zielnik", changefreq: "weekly", priority: "0.9" },
  { path: "/kontakt", changefreq: "yearly", priority: "0.5" },
];

function escapeXml(value: string) {
  return value.replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">");
}

export function sitemapXml(opts: {
  herbs: string[];
  entries: { slug: string; updatedAt?: string }[];
}) {
  const seen = new Set<string>();
  const herbs = [...opts.herbs, ...opts.entries.map((entry) => entry.slug)].filter((slug) => {
    if (!slug || seen.has(slug)) return false;
    seen.add(slug);
    return true;
  });
  const lastmod = new Map(
    opts.entries
      .filter((entry) => entry.updatedAt && /^\d{4}-\d{2}-\d{2}/.test(entry.updatedAt))
      .map((entry) => [entry.slug, entry.updatedAt!.slice(0, 10)]),
  );
  const urls = [
    ...PAGES.map((page) => ({ loc: `${ORIGIN}${page.path === "/" ? "/" : page.path}`, ...page, lastmod: "" })),
    ...herbs.map((slug) => ({
      loc: `${ORIGIN}/zielnik/${slug}`,
      changefreq: "monthly",
      priority: "0.8",
      lastmod: lastmod.get(slug) ?? "",
    })),
  ];
  const body = urls
    .map((url) => {
      const mod = url.lastmod ? `\n    <lastmod>${url.lastmod}</lastmod>` : "";
      return `  <url>\n    <loc>${escapeXml(url.loc)}</loc>${mod}\n    <changefreq>${url.changefreq}</changefreq>\n    <priority>${url.priority}</priority>\n  </url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}
