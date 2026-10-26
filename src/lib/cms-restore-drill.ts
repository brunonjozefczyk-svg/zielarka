/**
 * Próba odzyskania na interfejsie magazynu (funkcje z backup-bundle).
 * To nie jest site-store.server.ts. Nie zna ścieżek produkcyjnych zielarka/
 * i nie wysyła nic poza podany magazyn.
 */
import {
  buildPayload,
  confirmBackupRoundtrip,
  fileFromBytes,
  plannedRefs,
  recoverBackup,
  sha256Bytes,
  sliceBytes,
  sliceEnvelope,
  toManifest,
  verifyPayload,
  type BackupDoc,
  type BackupFile,
  type BackupManifest,
  type BackupPayload,
} from "./backup-bundle";
import { toPublicDoc } from "./cms-guard";
import { openJson, sealJson } from "./draft-seal.server";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const TOKEN_RE = /^vercel_blob_rw_([a-z0-9]{4,})_([a-z0-9_-]{8,})$/i;
const KID_RE = /^k[1-9]\d{0,2}$/;

export const DRILL_DELETE_CAP = 80;

export type DrillStore = {
  put(key: string, body: string): Promise<void>;
  get(key: string): Promise<string | null>;
  list(prefix: string): Promise<string[]>;
  delete(keys: string[]): Promise<void>;
};

export type DrillConfig =
  | { status: "SKIPPED"; message: string; exitCode: 2 }
  | { status: "FAILED"; message: string; exitCode: 1 }
  | { status: "READY"; token: string; storeId: string; testKey: string; exitCode: 0 };

export function assertDrillKey(key: string) {
  if (
    typeof key !== "string" ||
    key.length === 0 ||
    key.length > 240 ||
    key.startsWith("/") ||
    key.startsWith("zielarka/") ||
    key.includes("/zielarka/") ||
    key.includes("..") ||
    key.includes("\\") ||
    key.includes("\0")
  ) {
    throw new Error("Odmawiam ścieżki spoza próby. Nic więcej nie ruszam.");
  }
}

export function capDrillDeletes(keys: string[]) {
  const unique = [...new Set(keys)];
  if (unique.length > DRILL_DELETE_CAP) {
    throw new Error("Za dużo plików do skasowania. Nic nie zostało skasowane.");
  }
  for (const key of unique) assertDrillKey(key);
  return unique;
}

export function createMemoryDrillStore(): DrillStore & { keys(): string[] } {
  const files = new Map<string, string>();
  return {
    keys() {
      return [...files.keys()];
    },
    async put(key, body) {
      assertDrillKey(key);
      files.set(key, body);
    },
    async get(key) {
      assertDrillKey(key);
      return files.has(key) ? (files.get(key) as string) : null;
    },
    async list(prefix) {
      if (prefix.includes("..") || prefix.startsWith("zielarka/") || prefix.includes("/zielarka/")) {
        throw new Error("Odmawiam ścieżki spoza próby. Nic więcej nie ruszam.");
      }
      return [...files.keys()].filter((key) => key.startsWith(prefix));
    },
    async delete(keys) {
      for (const key of capDrillDeletes(keys)) files.delete(key);
    },
  };
}

function rawKey(value: string) {
  const trimmed = value.trim();
  const colon = trimmed.indexOf(":");
  if (colon > 0 && KID_RE.test(trimmed.slice(0, colon))) return trimmed.slice(colon + 1).trim();
  return trimmed;
}

function fail(message: string): DrillConfig {
  return { status: "FAILED", message, exitCode: 1 };
}

/** Osobny magazyn albo nic. SKIPPED nie jest sukcesem. Wymuszony bieg bez konfiguracji jest błędem. */
export function classifyDrillConfig(env: Record<string, string | undefined>): DrillConfig {
  const requireRun = env.ZIELARKA_REQUIRE_BLOB_DRILL === "tak";
  const opted = env.ZIELARKA_TEST_BLOB_OK === "tak";
  const token = (env.ZIELARKA_TEST_BLOB_TOKEN || "").trim();
  const production = (env.BLOB_READ_WRITE_TOKEN || "").trim();
  const storeName = (env.ZIELARKA_TEST_BLOB_STORE || "").trim().toLowerCase();
  const testKey = (env.ZIELARKA_TEST_CMS_SEAL_KEY || "").trim();
  const skip = (message: string): DrillConfig =>
    requireRun ? fail(message) : { status: "SKIPPED", message, exitCode: 2 };

  if (!opted || !token) {
    return skip(
      requireRun
        ? "Test adaptera odzyskania na Vercel Blob był wymagany, ale brak osobnego magazynu. Nic nie zostało zapisane."
        : "Próba odzyskania na Vercel Blob nie została uruchomiona. Brak osobnego magazynu testowego. To nie jest potwierdzenie poprawności. Produkcja nie była ruszana.",
    );
  }
  const match = TOKEN_RE.exec(token);
  if (!match?.[1]) {
    return fail("Token testowy nie ma postaci vercel_blob_rw_<magazyn>_<sekret>. Nic nie zostało zapisane.");
  }
  const storeId = match[1].toLowerCase();
  if (!storeName || storeName !== storeId) {
    return fail("ZIELARKA_TEST_BLOB_STORE musi być identyfikatorem z tokenu testowego. Nic nie zostało zapisane.");
  }
  if (production) {
    if (production === token) return fail("Token testowy jest taki sam jak BLOB_READ_WRITE_TOKEN. Nic nie zostało zapisane.");
    const prod = TOKEN_RE.exec(production);
    if (!prod?.[1]) return fail("Nie da się odczytać identyfikatora BLOB_READ_WRITE_TOKEN. Próba zatrzymana. Nic nie zostało zapisane.");
    if (prod[1].toLowerCase() === storeId) {
      return fail("Magazyn testowy ma ten sam identyfikator co produkcja. Nic nie zostało zapisane.");
    }
  }
  if (!testKey || Buffer.from(testKey, "base64").length !== 32) {
    return fail("Brak osobnego ZIELARKA_TEST_CMS_SEAL_KEY o długości 32 bajtów. Nic nie zostało zapisane.");
  }
  const banned = [env.CMS_SEAL_KEY || "", ...(env.CMS_SEAL_KEYS || "").split(",")]
    .map((item) => rawKey(item))
    .filter(Boolean);
  if (banned.includes(testKey)) {
    return fail("Klucz testowy jest taki sam jak klucz produkcji. Nic nie zostało zapisane.");
  }
  return { status: "READY", token, storeId, testKey, exitCode: 0 };
}

type SealSnapshot = {
  CMS_SEAL_KEY?: string;
  CMS_SEAL_KEYS?: string;
  CMS_SEAL_LEGACY_PASSWORD?: string;
  EDITOR_PASSWORD?: string;
};

function snapshotSeal(): SealSnapshot {
  return {
    CMS_SEAL_KEY: process.env.CMS_SEAL_KEY,
    CMS_SEAL_KEYS: process.env.CMS_SEAL_KEYS,
    CMS_SEAL_LEGACY_PASSWORD: process.env.CMS_SEAL_LEGACY_PASSWORD,
    EDITOR_PASSWORD: process.env.EDITOR_PASSWORD,
  };
}

function restoreSeal(saved: SealSnapshot) {
  for (const name of ["CMS_SEAL_KEY", "CMS_SEAL_KEYS", "CMS_SEAL_LEGACY_PASSWORD", "EDITOR_PASSWORD"] as const) {
    const value = saved[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function sampleDoc(): { doc: BackupDoc; published: Buffer; draft: Buffer } {
  const published = Buffer.from(PNG);
  const draft = Buffer.from(PNG);
  draft[draft.length - 1] ^= 0xff;
  const pubRef = "https://cdn.example/mieta.png";
  const draftRef = "https://cdn.example/szkic.png";
  return {
    published,
    draft,
    doc: {
      revision: 4,
      copy: { "home.h1": "Zioła" },
      images: { hero: pubRef },
      herbs: {},
      entries: [
        { slug: "mieta", status: "published", name: "Mięta", lead: "liść", image: pubRef },
        { slug: "szkic", status: "draft", name: "Sekretna mięta", lead: "ukryte", image: draftRef },
      ],
      theme: null,
      styles: {},
    },
  };
}

function filesFor(doc: BackupDoc, published: Buffer, draft: Buffer): BackupFile[] {
  return plannedRefs(doc).map((plan) => {
    const bytes = plan.use === "draft" ? draft : published;
    const file = fileFromBytes(plan.ref, plan.use, bytes);
    if (!file) throw new Error("Nie da się zapakować testowego zdjęcia.");
    return file;
  });
}

type Archive = { manifest: string; parts: { key: string; body: string }[] };

async function wipe(store: DrillStore) {
  const keys = await store.list("");
  if (keys.length) await store.delete(keys);
  const left = await store.list("");
  if (left.length) throw new Error("Po wyczyszczeniu próby zostały pliki.");
}

async function putArchive(store: DrillStore, payload: BackupPayload, files: BackupFile[]): Promise<Archive> {
  const manifest = toManifest(payload);
  const sealedManifest = sealJson(JSON.stringify(manifest));
  if (sealedManifest.includes("Sekretna") || sealedManifest.includes("ukryte")) {
    throw new Error("Zaszyfrowana kopia zawiera tekst szkicu.");
  }
  await store.put("archive/manifest.json", sealedManifest);
  const parts: { key: string; body: string }[] = [];
  for (const file of files) {
    const slices = sliceBytes(Buffer.from(file.base64, "base64"));
    for (let index = 0; index < slices.length; index += 1) {
      const body = sealJson(sliceEnvelope(file.sha256, index, slices.length, slices[index] as Buffer));
      const key = `archive/parts/${file.sha256}/${index}.json`;
      await store.put(key, body);
      parts.push({ key, body });
    }
  }
  const downloaded = await store.get("archive/manifest.json");
  if (downloaded !== sealedManifest) throw new Error("Pobrany manifest nie jest tym, który został zapisany.");
  for (const part of parts) {
    const back = await store.get(part.key);
    if (back !== part.body) throw new Error("Pobrana część zdjęcia nie jest tą, która została zapisana.");
  }
  return { manifest: downloaded, parts };
}

function openArchive(archive: Archive, source: BackupPayload) {
  const opened = openJson(JSON.parse(archive.manifest)) as BackupManifest;
  if (opened.docSha !== source.docSha || opened.textSha !== source.textSha) {
    throw new Error("Suma kontrolna manifestu nie pasuje.");
  }
  const bins = archive.parts.map((part) => {
    const row = openJson(JSON.parse(part.body)) as { sha256?: string; base64?: string };
    if (typeof row.sha256 !== "string" || typeof row.base64 !== "string") throw new Error("Część zdjęcia jest uszkodzona.");
    if (sha256Bytes(Buffer.from(row.base64, "base64")) !== row.sha256) throw new Error("Suma części zdjęcia nie pasuje.");
    return { sha256: row.sha256, base64: row.base64 };
  });
  const confirmed = confirmBackupRoundtrip(source, opened, bins);
  if (!confirmed.ok) throw new Error(confirmed.error);
  return confirmed.payload;
}

async function restoreDownloaded(store: DrillStore, payload: BackupPayload, published: Buffer, draft: Buffer) {
  const result = await recoverBackup({
    phrase: "PRZYWRÓĆ",
    expectedRevision: 0,
    raw: payload,
    readCurrent: async () => null,
    revisionHint: async () => 0,
    snapshot: async () => undefined,
    legacyFiles: async () => null,
    putImage: async (file) => {
      const bytes = Buffer.from(file.base64, "base64");
      await store.put(`restored/images/${file.use}/${file.sha256}`, bytes.toString("base64"));
      return file.use === "draft" ? `seal:mem://${file.sha256}` : `mem://${file.sha256}`;
    },
    writeDoc: async (doc, check) => {
      await check(doc);
      await store.put("restored/doc.json", JSON.stringify(doc));
      return doc.revision + 1;
    },
    readBack: async () => {
      const raw = await store.get("restored/doc.json");
      if (!raw) throw new Error("Brak odczytu przywróconego dokumentu.");
      return JSON.parse(raw) as BackupDoc;
    },
    readImage: async (url) => {
      const sha = url.slice(url.lastIndexOf("/") + 1);
      const use = url.startsWith("seal:") ? "draft" : "public";
      const raw = await store.get(`restored/images/${use}/${sha}`);
      return raw ? Buffer.from(raw, "base64") : null;
    },
  });
  if (!result.ok) throw new Error(result.message);
  const raw = await store.get("restored/doc.json");
  if (!raw) throw new Error("Przywrócony dokument zniknął.");
  const doc = JSON.parse(raw) as BackupDoc;
  const draftEntry = doc.entries.find((entry) => entry.slug === "szkic");
  if (!draftEntry || draftEntry.status !== "draft" || draftEntry.name !== "Sekretna mięta") {
    throw new Error("Szkic nie wrócił jako szkic.");
  }
  const pub = toPublicDoc({
    entries: doc.entries.map((entry) => ({
      status: String(entry.status ?? ""),
      image: typeof entry.image === "string" ? entry.image : "",
      slug: String(entry.slug ?? ""),
      name: String(entry.name ?? ""),
    })),
    images: Object.fromEntries(
      Object.entries(doc.images ?? {}).map(([id, value]) => [id, typeof value === "string" ? value : ""]),
    ),
  });
  if (pub.entries.some((entry) => entry.slug === "szkic" || entry.name === "Sekretna mięta")) {
    throw new Error("Szkic został opublikowany.");
  }
  if (!pub.entries.some((entry) => entry.slug === "mieta")) throw new Error("Opublikowany artykuł nie wrócił.");
  if (JSON.stringify(pub).includes("Sekretna") || JSON.stringify(pub).includes("ukryte")) {
    throw new Error("Publiczna treść zawiera szkic.");
  }
  const pubFile = payload.files.find((file) => file.use === "public");
  const draftFile = payload.files.find((file) => file.use === "draft");
  if (!pubFile || !draftFile) throw new Error("W kopii brakuje zdjęcia.");
  const pubRaw = await store.get(`restored/images/public/${pubFile.sha256}`);
  const draftRaw = await store.get(`restored/images/draft/${draftFile.sha256}`);
  const pubBytes = pubRaw ? Buffer.from(pubRaw, "base64") : null;
  const draftBytes = draftRaw ? Buffer.from(draftRaw, "base64") : null;
  if (!pubBytes || !draftBytes || !pubBytes.equals(published) || !draftBytes.equals(draft)) {
    throw new Error("Zdjęcia po odzyskaniu nie są identyczne bajt po bajcie.");
  }
  if (sha256Bytes(pubBytes) !== pubFile.sha256 || sha256Bytes(draftBytes) !== draftFile.sha256) {
    throw new Error("Suma zdjęcia po odzyskaniu nie pasuje.");
  }
  return raw;
}

async function refuseRestore(store: DrillStore, raw: unknown, before: string) {
  let writes = 0;
  const result = await recoverBackup({
    phrase: "PRZYWRÓĆ",
    expectedRevision: 0,
    raw,
    readCurrent: async () => JSON.parse(before) as BackupDoc,
    revisionHint: async () => 0,
    snapshot: async () => undefined,
    legacyFiles: async () => null,
    putImage: async () => {
      writes += 1;
      return "mem://nie";
    },
    writeDoc: async () => {
      writes += 1;
      return 1;
    },
    readBack: async () => JSON.parse(before) as BackupDoc,
    readImage: async () => null,
  });
  if (result.ok || writes !== 0) throw new Error("Uszkodzona kopia została przyjęta.");
  const still = await store.get("restored/doc.json");
  if (still !== before) throw new Error("Uszkodzona kopia zmieniła dokument.");
}

export async function runCmsRestoreDrill(store: DrillStore, keys: { k1: string; k2: string }): Promise<{ status: "PASSED" }> {
  if (Buffer.from(keys.k1, "base64").length !== 32 || Buffer.from(keys.k2, "base64").length !== 32 || keys.k1 === keys.k2) {
    throw new Error("Klucze próby są niepoprawne. Nic nie zostało zapisane.");
  }
  const saved = snapshotSeal();
  try {
    delete process.env.CMS_SEAL_KEYS;
    delete process.env.CMS_SEAL_LEGACY_PASSWORD;
    process.env.EDITOR_PASSWORD = "haslo-nieuzywane-w-probie";
    process.env.CMS_SEAL_KEY = keys.k1;
    const { doc, published, draft } = sampleDoc();
    const files = filesFor(doc, published, draft);
    const payload = buildPayload("próba", "2026-10-25T00:00:00.000Z", doc, files);
    const archive = await putArchive(store, payload, files);
    const opened = openArchive(archive, payload);
    await wipe(store);
    const live = await restoreDownloaded(store, opened, published, draft);
    const brokenFiles = { ...payload, files: payload.files.slice(0, 1) };
    if (verifyPayload(brokenFiles).ok) throw new Error("Brakująca część została uznana za dobrą.");
    await refuseRestore(store, brokenFiles, live);
    const corrupt = { ...payload, docSha: "0".repeat(64) };
    if (verifyPayload(corrupt).ok) throw new Error("Uszkodzony manifest został uznany za dobry.");
    await refuseRestore(store, corrupt, live);
    const format3 = toManifest(payload);
    await refuseRestore(store, format3, live);

    process.env.CMS_SEAL_KEY = `k2:${keys.k2}`;
    process.env.CMS_SEAL_KEYS = `k1:${keys.k1}`;
    await wipe(store);
    const rotated = openArchive(archive, payload);
    await restoreDownloaded(store, rotated, published, draft);
    const nextFiles = filesFor(doc, published, draft);
    const nextPayload = buildPayload("próba-k2", "2026-10-25T00:00:00.000Z", doc, nextFiles);
    const archiveK2 = await putArchive(store, nextPayload, nextFiles);
    if ((JSON.parse(archiveK2.manifest) as { kid?: string }).kid !== "k2") {
      throw new Error("Nowa kopia nie jest na kluczu k2.");
    }
    if ((JSON.parse(archive.manifest) as { kid?: string }).kid !== "k1") {
      throw new Error("Pierwsza kopia nie została zapisana kluczem k1.");
    }
    delete process.env.CMS_SEAL_KEYS;
    let oldLocked = false;
    try {
      openJson(JSON.parse(archive.manifest));
    } catch (error) {
      oldLocked = error instanceof Error && /Brak klucza k1/.test(error.message);
    }
    if (!oldLocked) throw new Error("Stare archiwum otworzyło się bez klucza k1.");
    await wipe(store);
    const finalPayload = openArchive(archiveK2, nextPayload);
    const finalDoc = await restoreDownloaded(store, finalPayload, published, draft);
    await refuseRestore(store, JSON.parse(archive.manifest) as unknown, finalDoc);
    await wipe(store);
    return { status: "PASSED" };
  } finally {
    restoreSeal(saved);
  }
}
