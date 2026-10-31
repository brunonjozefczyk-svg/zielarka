import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/cron/backup")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { cronBackup } = await import("@/lib/site-api");
        const result = await cronBackup(request.headers.get("authorization") || "");
        return new Response(result.ok ? "ok" : "niedozwolone", { status: result.status });
      },
    },
  },
});
