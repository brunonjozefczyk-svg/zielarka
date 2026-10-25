import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { editorRevision, readEditorPassword, setEditorRevision } from "@/lib/site-editor";
import { isSealedArchive, OFFSITE_NOTE, SERVER_PAYLOAD_LIMIT } from "@/lib/backup-wire";

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
  const [note, setNote] = useState("");

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
      if (!result.ok || !result.sealedManifest) throw new Error(result.message || "odmowa");
      const sealedParts: string[] = [];
      for (let index = 0; index < result.parts.length; index += 1) {
        const part = result.parts[index];
        if (!part) throw new Error("Kopia jest niepełna. Plik nie został zapisany.");
        setNote(`Pobieranie części ${index + 1} z ${result.parts.length}`);
        const { downloadBackupPartFn } = await import("@/lib/site-api");
        const piece = await downloadBackupPartFn({
          data: { password, sha256: part.sha256, slice: part.slice },
        });
        if (!piece.ok || !piece.sealed || piece.sha256 !== part.sha256 || piece.slice !== part.slice) {
          throw new Error(piece.message || "Część kopii nie pasuje. Plik nie został zapisany.");
        }
        sealedParts.push(piece.sealed);
      }
      if (sealedParts.length !== result.parts.length) throw new Error("Kopia jest niepełna. Plik nie został zapisany.");
      const archive = JSON.stringify({ format: 3, sealedManifest: result.sealedManifest, sealedParts });
      const blob = new Blob([archive], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename || "zielarka-kopia.json";
      link.click();
      URL.revokeObjectURL(url);
      setNote("");
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
        zastępuje pliku schowanego u Ciebie. Pobrany plik jest zaszyfrowany i ma w środku także zdjęcia,
        nawet gdy jest ich dużo. {OFFSITE_NOTE} Przywracanie działa nawet wtedy, gdy aktualna treść jest
        uszkodzona. Jeśli da się ją odczytać, najpierw powstaje jej kopia.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button type="button" disabled={busy} onClick={() => void makeCopy()}>
          Zrób kopię teraz
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void download()}>
          Pobierz zaszyfrowaną kopię
        </Button>
      </div>
      {note ? <p className="mt-3 text-sm text-muted">{note}</p> : null}
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
                const password = readEditorPassword();
                if (!password) return;
                const parsed = JSON.parse(body) as unknown;
                if (isSealedArchive(parsed)) {
                  if (parsed.sealedParts.some((part) => part.length > SERVER_PAYLOAD_LIMIT) || parsed.sealedManifest.length > SERVER_PAYLOAD_LIMIT) {
                    throw new Error("Część kopii jest za duża na jedno przesłanie. Nic nie zostało podmienione.");
                  }
                  const { restoreBeginFn, restoreFinishFn, restorePartFn } = await import("@/lib/site-api");
                  const started = await restoreBeginFn({ data: { password, manifest: parsed.sealedManifest } });
                  if (!started.ok || !started.session) throw new Error(started.message || "odmowa");
                  if (started.parts !== parsed.sealedParts.length) {
                    throw new Error("Liczba części nie zgadza się z manifestem. Nic nie zostało podmienione.");
                  }
                  for (let index = 0; index < parsed.sealedParts.length; index += 1) {
                    setNote(`Wysyłanie części ${index + 1} z ${parsed.sealedParts.length}`);
                    const saved = await restorePartFn({
                      data: { password, session: started.session, sealed: parsed.sealedParts[index] ?? "" },
                    });
                    if (!saved.ok) throw new Error(saved.message || "Część kopii nie weszła. Nic nie zostało podmienione.");
                  }
                  const restored = await restoreFinishFn({
                    data: { password, session: started.session, revision: editorRevision(), phrase },
                  });
                  if (!restored.ok) throw new Error(restored.message || "odmowa");
                  setEditorRevision(restored.revision);
                  setPhrase("");
                  setNote("");
                  toast.success(restored.message || "Przywrócono kopię z pliku.");
                  await load();
                  return;
                }
                if (body.length > SERVER_PAYLOAD_LIMIT) {
                  throw new Error("Ten plik jest za duży na jedno przesłanie, a nie jest kopią dzieloną. Nic nie zostało podmienione.");
                }
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
