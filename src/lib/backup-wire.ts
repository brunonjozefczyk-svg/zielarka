/** Limit jednej odpowiedzi i jednego żądania funkcji Vercel (poniżej 4,5 MB). */
export const SERVER_PAYLOAD_LIMIT = 3_500_000;

/** Jedna część przed szyfrowaniem. Po kopercie AES nadal mieści się w limicie funkcji. */
export const RAW_SLICE = 1_800_000;

export const OFFSITE_AUTOMATIC = false;

export const OFFSITE_NOTE =
  "Automatyczny zapis poza Vercel Blob nie jest włączony. Niezależną kopią jest plik pobrany na Twój komputer. Darmowy następny krok, dopiero po Twojej zgodzie, to Cloudflare R2 w darmowym progu albo prywatne repozytorium na same zaszyfrowane pliki.";

export const OFFSITE_SETUP =
  "Zewnętrzna kopia nie jest podłączona i nic nie jest wysyłane. Po zgodzie: konto Cloudflare R2 w darmowym progu (około 10 GB, bez opłaty za pobieranie w tym progu), osobny kubełek tylko na zaszyfrowane pliki, klucze wyłącznie w zmiennych Vercel. Do tego czasu niezależną kopią jest plik pobrany w edytorze. Do otwarcia potrzebny jest aktualny CMS_SEAL_KEY, schowany też poza Vercel.";

/** Sama zgoda w zmiennej nie wysyła danych. Wysyłka nie jest podłączona. */
export function offsiteExportAllowed(approved = "", destination = "") {
  return approved === "tak" && Boolean(destination.trim());
}

export type SealedArchive = {
  format: 3;
  sealedManifest: string;
  sealedParts: string[];
};

export function isSealedArchive(value: unknown): value is SealedArchive {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<SealedArchive>;
  return (
    row.format === 3 &&
    typeof row.sealedManifest === "string" &&
    Array.isArray(row.sealedParts) &&
    row.sealedParts.every((part) => typeof part === "string")
  );
}

/** Nigdy nie wysyła bajtów. Cel w zmiennej środowiska też nie włącza wysyłki. */
export function offsiteDecision(destination = ""): { automatic: false; sent: false; reason: string } {
  if (destination.trim()) {
    return {
      automatic: false,
      sent: false,
      reason: "Cel poza Vercel Blob jest wpisany, ale wysyłka nie jest włączona. Nic nie zostało wysłane.",
    };
  }
  return { automatic: false, sent: false, reason: OFFSITE_NOTE };
}
