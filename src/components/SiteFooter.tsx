import { Link } from "@tanstack/react-router";
import { Mark } from "@/components/Mark";
import { site } from "@/lib/content";

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-forest text-cream">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-3">
        <div>
          <div className="flex items-center gap-2">
            <Mark className="size-7 brightness-0 invert" />
            <span className="font-display text-2xl">Zielarka.pl</span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-cream/80">
            {site.person}, zielarka-fitoterapeutka. Kraków.{" "}
            <Link to="/o-mnie" className="underline">
              Kwalifikacje
            </Link>
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-cream/60">Na stronie</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link to="/konsultacje" className="hover:underline">
                Konsultacje 1:1
              </Link>
            </li>
            <li>
              <Link to="/warsztaty" className="hover:underline">
                Warsztaty i spacery
              </Link>
            </li>
            <li>
              <Link to="/klub" className="hover:underline">
                Klub Zielarski
              </Link>
            </li>
            <li>
              <Link to="/zielnik" className="hover:underline">
                Zielnik
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-cream/60">W sieci</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <a href={site.facebook} className="hover:underline" target="_blank" rel="noreferrer">
                Facebook · {site.facebookFollowers}
              </a>
            </li>
            <li>
              <a href={site.instagram} className="hover:underline" target="_blank" rel="noreferrer">
                Instagram @zielarka.pl · {site.instagramFollowers}
              </a>
            </li>
            <li>
              <a href={site.tiktok} className="hover:underline" target="_blank" rel="noreferrer">
                TikTok @zielarka.pl
              </a>
            </li>
            <li>
              <Link to="/kontakt" className="hover:underline">
                Napisz
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-cream/15">
        <p className="mx-auto max-w-6xl px-4 py-6 text-xs leading-relaxed text-cream/65 sm:px-6">
          Natura jest niezastąpionym wsparciem, natomiast konsultacja zielarska nie zastępuje
          konsultacji lekarskiej.
        </p>
      </div>
    </footer>
  );
}
