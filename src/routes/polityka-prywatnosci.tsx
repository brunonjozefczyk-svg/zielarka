import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "@/components/SiteShell";
import { privacyPolicy } from "@/lib/privacy-policy";

export const Route = createFileRoute("/polityka-prywatnosci")({
  head: () => ({ meta: [
    { title: "Polityka prywatności | Zielarka.pl" },
    ...(!privacyPolicy.ready ? [{ name: "robots", content: "noindex, nofollow" }] : []),
  ] }),
  component: () => (
    <SiteShell>
      <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="font-display text-4xl text-forest">Polityka prywatności</h1>
        {!privacyPolicy.ready ? <p role="status" className="mt-6 border border-line bg-cream p-4">Szkic do uzupełnienia i zatwierdzenia. Pomiar analityczny pozostaje wyłączony.</p> : null}
        {privacyPolicy.sections.map((section) => (
          <section key={section.title} className="mt-8">
            <h2 className="font-display text-2xl text-forest">{section.title}</h2>
            <p className="mt-3 leading-relaxed text-ink">{section.text}</p>
          </section>
        ))}
      </article>
    </SiteShell>
  ),
});
