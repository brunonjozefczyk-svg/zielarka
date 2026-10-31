import { useEffect, type ReactNode } from "react";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { useEdits } from "@/lib/edits-context";
import { setEditorRevision } from "@/lib/site-editor";

export function SiteShell({ children }: { children: ReactNode }) {
  const edits = useEdits();
  useEffect(() => {
    if (edits.storeOk === false) return;
    setEditorRevision(edits.revision ?? 0);
  }, [edits.revision, edits.storeOk]);
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      {edits.storeOk === false ? (
        <p className="bg-cream px-4 py-3 text-center text-sm text-ink">
          Magazyn treści jest chwilowo niedostępny. To nie jest pusta baza — widać treść z kodu strony, a
          zapisane karty wrócą po odświeżeniu.
        </p>
      ) : null}
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
