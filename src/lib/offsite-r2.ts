/**
 * Przygotowanie kopii poza Vercel Blob. Nic z tego nie jest podłączone do crona
 * ani do zapisu kopii. deliverOffsite zawsze odmawia wysyłki.
 *
 * Cloudflare R2, stan cennika 2026-10-01 (https://developers.cloudflare.com/r2/pricing/):
 * próg Standard: 10 GB-miesiąc, 1 mln operacji klasy A, 10 mln klasy B, egress 0.
 * Powyżej: przechowywanie 0,015 USD/GB-miesiąc, klasa A 4,50 USD/mln, klasa B 0,36 USD/mln.
 * Klasa Infrequent Access ma opłatę za odczyt i nie wchodzi w ten próg. Konta nie zakładałem.
 *
 * Zmienne, gdy właściciel sam utworzy kubełek i dopiero po osobnym teście:
 *   R2_ENDPOINT=https://<id>.r2.cloudflarestorage.com
 *   R2_BUCKET=zielarka-kopie
 *   R2_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY
 * Samo ich ustawienie nie wysyła bajtów.
 */

export type OffsiteTarget = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export function readOffsiteTarget(env: NodeJS.ProcessEnv): OffsiteTarget | null {
  const endpoint = (env.R2_ENDPOINT || "").trim();
  const bucket = (env.R2_BUCKET || "").trim();
  const accessKeyId = (env.R2_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = (env.R2_SECRET_ACCESS_KEY || "").trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !url.hostname.endsWith(".r2.cloudflarestorage.com")) return null;
  if (bucket.includes("/") || bucket.includes("..") || bucket.length > 63) return null;
  return { endpoint: endpoint.replace(/\/$/, ""), bucket, accessKeyId, secretAccessKey };
}

/** Zawsze fałsz. Włączenie wysyłki wymaga osobnej zmiany po teście na prawdziwym R2. */
export function offsiteSendAllowed(_env: NodeJS.ProcessEnv = {}): false {
  return false;
}

export function offsiteObjectKey(kind: "daily" | "monthly" | "manual", at: string, sha256: string) {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("Zła suma kopii.");
  const day = /^\d{4}-\d{2}-\d{2}/.test(at) ? at.slice(0, 10) : "bez-daty";
  return `kopie/${kind}/${day}/${sha256}.json`;
}

/** Adres, który powstałby przy wysyłce. Ta funkcja nie otwiera połączenia. */
export function previewOffsitePut(target: OffsiteTarget, key: string, sha256: string) {
  if (key.includes("..") || key.startsWith("/") || key.startsWith("zielarka/")) {
    throw new Error("Klucz kopii poza Vercel jest niedozwolony.");
  }
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("Zła suma kopii.");
  return {
    method: "PUT" as const,
    url: `${target.endpoint}/${target.bucket}/${key}`,
    sha256,
  };
}

/**
 * Najnowsza kopia zostaje. Zostaje też jeden plik z każdego z 30 dni.
 * Plik bez daty nie jest kandydatem do skasowania. Plan nic nie kasuje sam.
 */
export function planOffsiteRetention(items: { key: string; uploadedAt: number }[]) {
  const sorted = [...items].sort((a, b) => b.uploadedAt - a.uploadedAt || a.key.localeCompare(b.key));
  const keep = new Set<string>();
  if (sorted[0]) keep.add(sorted[0].key);
  const days = new Set<string>();
  for (const item of sorted) {
    if (!Number.isFinite(item.uploadedAt) || item.uploadedAt <= 0) {
      keep.add(item.key);
      continue;
    }
    const day = new Date(item.uploadedAt).toISOString().slice(0, 10);
    if (!days.has(day) && days.size < 30) {
      days.add(day);
      keep.add(item.key);
    }
  }
  return {
    keep: sorted.filter((item) => keep.has(item.key)).map((item) => item.key),
    drop: sorted.filter((item) => !keep.has(item.key)).map((item) => item.key),
  };
}

export async function deliverOffsite(input: {
  armed: boolean;
  transport?: (request: { url: string; body: string }) => Promise<void>;
}): Promise<{ sent: false; reason: string }> {
  void input.transport;
  void input.armed;
  return { sent: false, reason: "Wysyłka poza Vercel nie jest podłączona. Nic nie zostało wysłane." };
}
