import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { editorRevision, readEditorPassword, setEditorRevision } from "@/lib/site-editor";

type Row = { id: string; at: string; kind: string; revision: number };

function when(value: string) {
  if (!value) return "jeszcze nie było";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pl-PL", { dateStyle: "medium", timeStyle: "short" });
}

export function BackupPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [at, setAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [chosen, setChosen] = useState("");

  async function load() {
    const password = readEditorPassword();
    if (!password) return;
    const { backupStatusFn } = await import("@/lib/site-api");
    const result = await backupStatusFn({ data: { password } });
    if (!result.ok) {
      toast.error(result.message || "Nie udało się odczytać kopii.");
      return;
    }
    setAt(result.at);
    setRows(result.rows);
  }

  useEffect(() => {
    void load().catch(() => toast.error("Nie udało się odczytać kopii."));
  }, []);

  async function makeCopy() {
    const password = readEditorPassword();
    if (!password) return;
    setBusy(true);
    try {
      const { createBackupFn } = await import("@/lib/site-api");
      const result = await createBackupFn({ data: { password } });
      if (!result.ok) throw new Error(result.message || "odmowa");
      toast.success("Kopia sprawdzona i zapisana.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error && error.message.length < 180 ? error.message : "Nie udało się zrobić kopii.");
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    const password = readEditorPassword();
    if (!password) return;
    setBusy(true);
    try {
      const { downloadBackupFn } = await import("@/lib/site-api");
      const result = await downloadBackupFn({ data: { password } });
      if (!result.ok || !result.body) throw new Error(result.message || "odmowa");
      const blob = new Blob([result.body], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename || "zielarka-kopia.json";
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Plik jest zaszyfrowany. Schowaj go poza serwerem.");
    } catch (error) {
      toast.error(error instanceof Error && error.message.length < 180 ? error.message : "Nie udało się pobrać kopii.");
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    const password = readEditorPassword();
    if (!password || !chosen) return;
    if (phrase.trim() !== "PRZYWRÓĆ") {
      toast.error("Wpisz PRZYWRÓĆ wielkimi literami.");
      return;
    }
    setBusy(true);
    try {
      const { restoreBackupFn } = await import("@/lib/site-api");
      const result = await restoreBackupFn({
        data: { password, id: chosen, revision: editorRevision(), phrase },
      });
      if (!result.ok) throw new Error(result.message || "odmowa");
      setEditorRevision(result.revision);
      setPhrase("");
      toast.success(result.message || "Przywrócono kopię.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error && error.message.length < 180 ? error.message : "Nie udało się przywrócić.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-10 rounded-lg border border-line p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-clay">Ustawienia</p>
      <h2 className="mt-1 font-display text-2xl text-forest">Kopie zapasowe</h2>
      <p className="mt-2 text-sm text-muted">
        Ostatnia sprawdzona kopia na serwerze: {when(at)}. Leży w tym samym magazynie co strona, więc nie
        zastępuje pliku schowanego u Ciebie. Pobrany plik jest zaszyfrowany i ma w środku także zdjęcia.
        Przywracanie działa nawet wtedy, gdy aktualna treść jest uszkodzona. Jeśli da się ją odczytać, najpierw
        powstaje jej kopia.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button type="button" disabled={busy} onClick={() => void makeCopy()}>
          Zrób kopię teraz
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void download()}>
          Pobierz zaszyfrowaną kopię
        </Button>
      </div>
      <ul className="mt-6 divide-y divide-line border-y border-line">
        {rows.length === 0 ? <li className="py-3 text-sm text-muted">Brak zapisanych wersji.</li> : null}
        {rows.map((row) => (
          <li key={row.id} className="flex items-center justify-between gap-3 py-3">
            <span>
              <span className="block text-ink">{when(row.at)}</span>
              <span className="text-sm text-muted">
                {row.kind}
                {row.revision ? ` · wersja ${row.revision}` : ""}
              </span>
            </span>
            <Button type="button" variant={chosen === row.id ? "forest" : "outline"} onClick={() => setChosen(row.id)}>
              Wybierz
            </Button>
          </li>
        ))}
      </ul>
      <label className="mt-4 block text-sm text-ink">
        Żeby przywrócić wybraną kopię, wpisz PRZYWRÓĆ
        <input
          className="mt-1 min-h-11 w-full rounded-md border border-line bg-paper px-3"
          value={phrase}
          onChange={(event) => setPhrase(event.target.value)}
          autoComplete="off"
        />
      </label>
      <label className="mt-4 block text-sm text-ink">
        Albo wgraj pobrany plik kopii
        <input
          className="mt-1 block w-full text-sm"
          type="file"
          accept="application/json,.json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            if (phrase.trim() !== "PRZYWRÓĆ") {
              toast.error("Wpisz PRZYWRÓĆ wielkimi literami.");
              return;
            }
            setBusy(true);
            void file
              .text()
              .then(async (body) => {
                if (body.length > 4_000_000) throw new Error("Plik kopii jest za duży na jedno przesłanie.");
                const password = readEditorPassword();
                if (!password) return;
                const { restoreUploadFn } = await import("@/lib/site-api");
                const result = await restoreUploadFn({
                  data: { password, body, revision: editorRevision(), phrase },
                });
                if (!result.ok) throw new Error(result.message || "odmowa");
                setEditorRevision(result.revision);
                setPhrase("");
                toast.success(result.message || "Przywrócono kopię z pliku.");
                await load();
              })
              .catch((error: unknown) => {
                toast.error(error instanceof Error && error.message.length < 180 ? error.message : "Nie udało się wgrać kopii.");
              })
              .finally(() => setBusy(false));
          }}
        />
      </label>
      <Button type="button" className="mt-3" variant="outline" disabled={busy || !chosen} onClick={() => void restore()}>
        Przywróć wybraną kopię
      </Button>
    </section>
  );
}
