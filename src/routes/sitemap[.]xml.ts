import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { loadSitemapXml } = await import("@/lib/site-api");
          const xml = await loadSitemapXml();
          return new Response(xml, {
            status: 200,
            headers: {
              "content-type": "application/xml; charset=utf-8",
              "cache-control": "public, max-age=0, s-maxage=120",
            },
          });
        } catch {
          return new Response("Magazyn treści jest chwilowo niedostępny.", {
            status: 503,
            headers: {
              "content-type": "text/plain; charset=utf-8",
              "cache-control": "no-store",
              "x-robots-tag": "noindex, nofollow",
            },
          });
        }
      },
    },
  },
});