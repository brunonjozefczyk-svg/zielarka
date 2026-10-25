import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Menu, Pencil, X } from "lucide-react";
import { Mark } from "@/components/Mark";
import { Button } from "@/components/ui/button";
import { nav } from "@/lib/content";
import { useEditMode } from "@/lib/site-editor";
import { cn } from "@/lib/utils";

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { editing, setEditing } = useEditMode();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur-md">
      {editing ? (
        <p className="bg-forest px-4 py-2 text-center text-sm text-cream">
          Tryb edycji: stuknij tekst albo przycisk „Zmień zdjęcie”. Potem u góry: Gotowe.
        </p>
      ) : null}
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link
          to="/"
          className="flex items-center gap-2 text-forest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
        >
          <Mark className="size-7" />
          <span className="font-display text-xl font-medium tracking-tight">Zielarka.pl</span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Główne">
          {nav.map((item) => {
            const active = pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "px-3 py-2 text-sm tracking-wide transition-colors",
                  active ? "text-forest font-semibold" : "text-muted hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className={cn(
              "inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-medium",
              editing ? "bg-forest text-cream" : "border border-forest text-forest",
            )}
            onClick={() => setEditing(!editing)}
          >
            <Pencil className="size-4" />
            {editing ? "Gotowe" : "Edytuj"}
          </button>
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link to="/kontakt">Umów konsultację</Link>
          </Button>
          <button
            type="button"
            className="inline-flex size-11 items-center justify-center rounded-md text-ink lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Zamknij menu" : "Otwórz menu"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-6" /> : <Menu className="size-6" />}
          </button>
        </div>
      </div>

      {open ? (
        <div id="mobile-nav" className="border-t border-line bg-paper px-4 py-4 lg:hidden">
          <nav className="flex flex-col" aria-label="Mobilne">
            {nav.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex min-h-11 items-center border-b border-line text-base",
                  pathname === item.to ? "text-forest font-semibold" : "text-ink",
                )}
              >
                {item.label}
              </Link>
            ))}
            <Button asChild className="mt-4 w-full">
              <Link to="/kontakt">Umów konsultację</Link>
            </Button>
          </nav>
        </div>
      ) : null}
    </header>
  );
}