import { useState, type FormEvent } from "react";
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

const empty: Draft = { name: "", email: "", topic: "konsultacja", message: "" };

export function ContactForm() {
  const [draft, setDraft] = useState<Draft>(empty);
  const [sent, setSent] = useState(false);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.name.trim() || !draft.email.trim() || !draft.message.trim()) {
      toast("Uzupełnij imię, e-mail i wiadomość.");
      return;
    }
    const entry = { ...draft, at: new Date().toISOString() };
    const prev = JSON.parse(localStorage.getItem("zielarka-zgloszenia") || "[]") as unknown[];
    localStorage.setItem("zielarka-zgloszenia", JSON.stringify([entry, ...prev].slice(0, 20)));
    setSent(true);
    setDraft(empty);
  }

  if (sent) {
    return (
      <div className="rounded-lg border border-line bg-cream p-8">
        <p className="font-display text-2xl text-forest">Dziękuję.</p>
        <p className="mt-3 max-w-md text-muted leading-relaxed">
          Twoja wiadomość jest zapisana. Wrócę z odpowiedzią na podany e-mail — zwykle w ciągu
          kilku dni roboczych.
        </p>
        <Button className="mt-6" variant="outline" onClick={() => setSent(false)}>
          Napisz kolejną
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
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
            <option key={t.value} value={t.value}>
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
      <Button type="submit" size="lg">
        Wyślij zgłoszenie
      </Button>
    </form>
  );
}
