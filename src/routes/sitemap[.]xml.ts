import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const { loadSitemapXml } = await import("@/lib/site-api");
        const xml = await loadSitemapXml();
        return new Response(xml, {
          headers: {
            "content-type": "application/xml; charset=utf-8",
            "cache-control": "public, max-age=0, s-maxage=300, stale-while-revalidate=60",
          },
        });
      },
    },
  },
});