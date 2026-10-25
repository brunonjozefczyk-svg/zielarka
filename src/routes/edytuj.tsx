import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { SiteShell } from "@/components/SiteShell";
import { Button } from "@/components/ui/button";
import { writeEditMode, writeEditorPassword } from "@/lib/site-editor";

export const Route = createFileRoute("/edytuj")({
  head: () => ({
    meta: [
      { title: "Edycja — Zielarka.pl" },
      { name: "description", content: "Prywatne wejście do edycji strony." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: EditGate,
});

function EditGate() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [checking, setChecking] = useState(false);

  return (
    <SiteShell>
      <div className="mx-auto max-w-md px-4 py-16">
        <h1 className="font-display text-3xl text-forest">Edycja strony</h1>
        <p className="mt-3 text-sm text-muted">
          Ta strona nie jest w menu. Po haśle możesz zmieniać teksty i zdjęcia.
        </p>
        <form
          className="mt-8"
          onSubmit={(event) => {
            event.preventDefault();
            const next = password.trim();
            if (!next) return;
            setChecking(true);
            void import("@/lib/site-api")
              .then(({ checkEditorPassword }) => checkEditorPassword({ data: { password: next } }))
              .then((result) => {
                if (!result.ok) {
                  toast.error("Złe hasło.");
                  return;
                }
                writeEditorPassword(next);
                writeEditMode(true);
                void navigate({ to: "/" });
              })
              .catch(() => toast.error("Nie udało się sprawdzić hasła."))
              .finally(() => setChecking(false));
          }}
        >
          <label className="block text-sm text-ink" htmlFor="editor-password">
            Hasło
          </label>
          <input
            id="editor-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3"
          />
          <Button type="submit" className="mt-4" disabled={checking}>
            {checking ? "Sprawdzam…" : "Otwórz edycję"}
          </Button>
        </form>
      </div>
    </SiteShell>
  );
}
