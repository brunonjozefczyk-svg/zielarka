import type { ReactNode } from "react";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <a
        href="#tresc"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-forest focus:px-3 focus:py-2 focus:text-cream"
      >
        Przejdź do treści
      </a>
      <SiteHeader />
      <main id="tresc" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
