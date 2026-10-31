import { useEffect, useState, type ComponentType } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { PlantDesk } from "@/components/PlantDesk";
import { SiteShell } from "@/components/SiteShell";
import { Button } from "@/components/ui/button";
import { readEditorPassword, writeEditorPassword } from "@/lib/site-editor";

export const Route = createFileRoute("/edytuj")({
  headers: () => ({
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex, nofollow",
  }),
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
  const [password, setPassword] = useState("");
  const [checking, setChecking] = useState(false);
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    setUnlocked(Boolean(readEditorPassword()));
  }, []);

  return (
    <SiteShell>
      {unlocked ? (
        <Editor onLock={() => setUnlocked(false)} />
      ) : (
        <div className="mx-auto max-w-md px-4 py-16">
          <h1 className="font-display text-3xl text-forest">Edycja strony</h1>
          <p className="mt-3 text-sm text-muted">
            Ta strona nie jest w menu. Po haśle możesz zmieniać teksty, zdjęcia i karty zielnika.
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
                    toast.error(result.message || "Złe hasło.");
                    return;
                  }
                  writeEditorPassword(next);
                  setUnlocked(true);
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
      )}
    </SiteShell>
  );
}

function Editor({ onLock }: { onLock: () => void }) {
  const [tab, setTab] = useState<"content" | "stats">("content");
  return (
    <>
      <div className="mx-auto flex max-w-5xl flex-wrap gap-2 px-4 pt-8 sm:px-6">
        <Button type="button" variant={tab === "content" ? "forest" : "outline"} onClick={() => setTab("content")}>
          Treści
        </Button>
        <Button type="button" variant={tab === "stats" ? "forest" : "outline"} onClick={() => setTab("stats")}>
          Statystyki
        </Button>
      </div>
      <div hidden={tab !== "content"}>
        <PlantDesk onLock={onLock} />
      </div>
      {tab === "stats" ? <StatsGate /> : null}
    </>
  );
}

function StatsGate() {
  const [Panel, setPanel] = useState<ComponentType | null>(null);
  useEffect(() => {
    let live = true;
    void import("@/components/StatsPanel").then((mod) => {
      if (live) setPanel(() => mod.StatsPanel);
    });
    return () => {
      live = false;
    };
  }, []);
  if (!Panel) return <p className="mx-auto max-w-5xl px-4 py-10 text-sm text-muted">Wczytuję statystyki…</p>;
  return <Panel />;
}
