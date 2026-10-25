import { useEffect, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const TOPICS = [
  { value: "konsultacja", label: "Konsultacja 1:1" },
  { value: "warsztat", label: "Warsztat" },
  { value: "spacer", label: "Spacer zielarski" },
  { value: "klub", label: "Klub Zielarski" },
  { value: "inne", label: "Inne" },
] as const;

type Draft = {
  name: string;
  email: string;
  topic: string;
  message: string;
};

const empty: Draft = { name: "", email: "", topic: "Konsultacja 1:1", message: "" };

export function ContactForm() {
  const [draft, setDraft] = useState<Draft>(empty);
  const [company, setCompany] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("wyslane") === "1") setSent(true);
  }, []);

  function onSubmit(e: FormEvent) {
    if (company) {
      e.preventDefault();
      setSent(true);
      return;
    }
    if (!draft.name.trim() || !draft.email.trim() || !draft.message.trim()) {
      e.preventDefault();
      toast("Uzupełnij imię, e-mail i wiadomość.");
      return;
    }
    if (draft.message.trim().length < 10) {
      e.preventDefault();
      toast("Napisz choć jedno zdanie. Wiadomość jest za krótka.");
    }
  }

  if (sent) {
    return (
      <div className="rounded-lg border border-line bg-cream p-8">
        <p className="font-display text-2xl text-forest">Dziękuję.</p>
        <p className="mt-3 max-w-md text-muted leading-relaxed">
          Wiadomość poszła na skrzynkę Sabiny. Odpowiedź przyjdzie na e-mail, który podałeś.
        </p>
        <Button className="mt-6" variant="outline" onClick={() => setSent(false)}>
          Napisz kolejną
        </Button>
      </div>
    );
  }

  return (
    <form
      action="https://formsubmit.co/kontakt@zielarka.pl"
      method="POST"
      onSubmit={onSubmit}
      className="space-y-5"
    >
      <input type="hidden" name="_captcha" value="false" />
      <input type="hidden" name="_template" value="table" />
      <input type="hidden" name="_next" value="https://zielarka.pl/kontakt?wyslane=1" />
      <input
        type="hidden"
        name="_subject"
        value={`Zielarka.pl — ${draft.topic} — ${draft.name.trim()}`}
      />
      <input type="hidden" name="_replyto" value={draft.email.trim()} />
      <div>
        <Label htmlFor="name">Imię</Label>
        <Input
          id="name"
          name="name"
          autoComplete="name"
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        />
      </div>
      <div>
        <Label htmlFor="email">E-mail</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          value={draft.email}
          onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
        />
      </div>
      <div>
        <Label htmlFor="topic">Temat</Label>
        <select
          id="topic"
          name="topic"
          value={draft.topic}
          onChange={(e) => setDraft((d) => ({ ...d, topic: e.target.value }))}
          className="flex h-11 w-full rounded-md border border-line bg-cream px-3 text-base text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
        >
          {TOPICS.map((t) => (
            <option key={t.value} value={t.label}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="message">Wiadomość</Label>
        <Textarea
          id="message"
          name="message"
          value={draft.message}
          onChange={(e) => setDraft((d) => ({ ...d, message: e.target.value }))}
          placeholder="Kilka zdań o tym, z czym przychodzisz."
        />
      </div>
      <input
        type="text"
        name="_honey"
        value={company}
        onChange={(e) => setCompany(e.target.value)}
        className="hidden"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
      />
      <Button type="submit" size="lg">
        Wyślij zgłoszenie
      </Button>
      <p className="text-sm leading-relaxed text-muted">
        Wiadomość idzie na skrzynkę Sabiny. To nie jest porada medyczna i nie zastępuje wizyty u lekarza. Możesz też napisać od razu na{" "}
        <a href="mailto:kontakt@zielarka.pl" className="text-forest underline">
          kontakt@zielarka.pl
        </a>
        .{" "}
        <Link to="/konsultacje" className="text-forest underline">
          Jak wygląda konsultacja
        </Link>
        .
      </p>
    </form>
  );
}
