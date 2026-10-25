import { createFileRoute } from "@tanstack/react-router";
import { ContactForm } from "@/components/ContactForm";
import { PageIntro } from "@/components/PageIntro";
import { SiteShell } from "@/components/SiteShell";
import { site } from "@/lib/content";

export const Route = createFileRoute("/kontakt")({ component: ContactPage });

function ContactPage() {
  return (
    <SiteShell>
      <PageIntro
        kicker="Kontakt"
        title="Napisz"
        lead="Konsultacja, warsztat, spacer albo klub — zacznij od kilku zdań. Wrócę z odpowiedzią."
        edit={{ title: "kontakt.title", lead: "kontakt.lead" }}
      />
      <div className="mx-auto grid max-w-6xl gap-12 px-4 pb-20 sm:px-6 lg:grid-cols-[1fr_minmax(0,28rem)]">
        <ContactForm />
        <aside className="h-fit rounded-lg border border-line bg-cream p-6">
          <p className="text-xs uppercase tracking-[0.18em] text-clay">W sieci</p>
          <ul className="mt-4 space-y-3 text-sm">
            <li>
              <a href={site.facebook} className="text-forest underline" target="_blank" rel="noreferrer">
                Facebook Zielarka.pl
              </a>
              <span className="block text-muted">{site.facebookFollowers}</span>
            </li>
            <li>
              <a href={site.instagram} className="text-forest underline" target="_blank" rel="noreferrer">
                Instagram @zielarka.pl
              </a>
              <span className="block text-muted">{site.instagramFollowers}</span>
            </li>
            <li>
              <a href={site.tiktok} className="text-forest underline" target="_blank" rel="noreferrer">
                TikTok @zielarka.pl
              </a>
            </li>
            <li>
              <a href={site.klub} className="text-forest underline" target="_blank" rel="noreferrer">
                Klub Zielarski
              </a>
            </li>
          </ul>
          <p className="mt-6 text-sm leading-relaxed text-muted">
            {site.region}. {site.education}. Konsultacje także online. Warsztaty i spacery —
            sezonowo, w terenie.
          </p>
        </aside>
      </div>
    </SiteShell>
  );
}
