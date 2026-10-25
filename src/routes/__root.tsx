import { useEffect, useState, type ComponentType } from "react";
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { EditsProvider, type PublicEdits } from "@/lib/edits-context";
import { themeAttrs, themeVars } from "@/lib/theme";
import { Toaster } from "sonner";
import appCss from "../styles.css?url";

const APP_NAME = "Zielarka.pl — zioła w codzienności";
const DESCRIPTION =
  "Sabina Józefczyk, zielarka-fitoterapeutka. Konsultacje 1:1, warsztaty, spacery i Klub Zielarski. Wiedza, tradycja i natura.";

export const Route = createRootRoute({
  loader: async (): Promise<{ edits: PublicEdits }> => {
    try {
      const { loadSiteEdits } = await import("@/lib/site-api");
      return { edits: await loadSiteEdits() };
    } catch {
      return {
        edits: { revision: 0, copy: {}, images: {}, herbs: {}, entries: [], theme: null, styles: {}, storeOk: false },
      };
    }
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      { name: "description", content: DESCRIPTION },
      { name: "theme-color", content: "#2A4A38" },
    ],
    links: [
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  headers: () => ({
    "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=120",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "SAMEORIGIN",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  }),
  component: function Root() {
    const { edits } = Route.useLoaderData();
    return (
    <html
      lang="pl"
      className="antialiased"
      {...themeAttrs(edits.theme)}
      style={themeVars(edits.theme)}
      suppressHydrationWarning
    >
      <head>
        <HeadContent />
      </head>
      <body className="min-h-screen bg-paper text-ink font-sans">
        <PreviewHostBridge />
        <EditsProvider value={edits}>
          <AuthProvider>
            <Outlet />
          </AuthProvider>
        </EditsProvider>
        <AnalyticsSlot />
        <Toaster
          position="bottom-center"
          toastOptions={{
            className:
              "font-sans! bg-forest! text-cream! border-forest-deep! rounded-md!",
          }}
        />
        <Scripts />
      </body>
    </html>
    );
  },
});

function AnalyticsSlot() {
  const measurementId = import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined;
  const [View, setView] = useState<ComponentType<{ measurementId: string }> | null>(null);
  useEffect(() => {
    if (!measurementId || !/^G-[A-Za-z0-9]+$/.test(measurementId)) return;
    let live = true;
    void import("@/components/AnalyticsConsent").then((mod) => {
      if (live) setView(() => mod.AnalyticsConsent);
    });
    return () => {
      live = false;
    };
  }, [measurementId]);
  if (!measurementId || !View) return null;
  return <View measurementId={measurementId} />;
}
