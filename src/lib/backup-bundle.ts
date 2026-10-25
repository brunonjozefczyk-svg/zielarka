/**
 * Pełna kopia CMS: dokument i bajty zdjęć, nie same adresy.
 * Plik do pobrania jest szyfrowany przez pieczęć CMS. Sam ten moduł nie wysyła go do sieci.
 * Automatyczna kopia poza Vercel Blob nie jest tu włączona.
 */
import { createHash } from "node:crypto";
import { canonicalEdits, restoreAllowed, urlsToRetain, type KeptBlob } from "./cms-guard";
import { payloadSha } from "./draft-seal.server";
import { RAW_SLICE, SERVER_PAYLOAD_LIMIT } from "./backup-wire";

export type ImageUse = "public" | "draft";

export type BackupFile = {
  ref: string;
  use: ImageUse;
  mime: "image/jpeg" | "image/png" | "image/webp";
  sha256: string;
  base64: string;
};

export type BackupDoc = {
  revision: number;
  copy: Record<string, string>;
  images: Record<string, string>;
  herbs: Record<string, unknown>;
  entries: { status?: string; image?: string; [key: string]: unknown }[];
  theme: unknown;
  styles: Record<string, unknown>;
};

export type BackupPayload = {
  format: 2;
  kind: string;
  at: string;
  revision: number;
  docSha: string;
  textSha: string;
  doc: BackupDoc;
  files: BackupFile[];
};

export type RecoverResult =
  | { ok: true; revision: number; snapshotted: boolean; message: string }
  | { ok: false; message: string };

const MAX_IMAGE = 2_500_000;

export function sha256Bytes(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sniffImage(bytes: Buffer): BackupFile["mime"] | "" {
  if (bytes.length < 12) return "";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return "";
}

export function bundledAsset(ref: string) {
  return ref.startsWith("/images/") || ref.startsWith("/fonts/") || ref === "";
}

export function parseDataUrl(value: string): { mime: BackupFile["mime"]; bytes: Buffer } | null {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=\s]+)$/i.exec(value);
  if (!match?.[2]) return null;
  const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  const mime = sniffImage(bytes);
  if (!mime) return null;
  return { mime, bytes };
}

export function fileFromBytes(ref: string, use: ImageUse, bytes: Buffer): BackupFile | null {
  const mime = sniffImage(bytes);
  if (!mime || bytes.length < 32 || bytes.length > MAX_IMAGE) return null;
  return { ref, use, mime, sha256: sha256Bytes(bytes), base64: bytes.toString("base64") };
}

export function plannedRefs(doc: BackupDoc): { ref: string; use: ImageUse }[] {
  const seen = new Set<string>();
  const out: { ref: string; use: ImageUse }[] = [];
  const add = (ref: unknown, use: ImageUse) => {
    if (typeof ref !== "string" || bundledAsset(ref)) return;
    const key = `${use}\0${ref}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ref, use });
  };
  for (const ref of Object.values(doc.images ?? {})) add(ref, "public");
  for (const entry of doc.entries ?? []) {
    add(entry.image, entry.status === "published" ? "public" : "draft");
  }
  return out;
}

export function textCanon(doc: BackupDoc) {
  return JSON.stringify({
    copy: doc.copy ?? {},
    herbs: doc.herbs ?? {},
    theme: doc.theme ?? null,
    styles: doc.styles ?? {},
    entries: (doc.entries ?? []).map((entry) => {
      const { image: _image, ...rest } = entry;
      return rest;
    }),
    imageSlots: Object.keys(doc.images ?? {}).sort(),
  });
}

export function isBlankDoc(doc: BackupDoc) {
  return (
    doc.revision === 0 &&
    (doc.entries?.length ?? 0) === 0 &&
    Object.keys(doc.copy ?? {}).length === 0 &&
    Object.keys(doc.images ?? {}).length === 0 &&
    Object.keys(doc.herbs ?? {}).length === 0
  );
}

export function restoreGate(current: BackupDoc | null, expected: number): "proceed" | "conflict" {
  if (!current || isBlankDoc(current)) return "proceed";
  if (!Number.isInteger(expected) || current.revision !== expected) return "conflict";
  return "proceed";
}

export function buildPayload(kind: string, at: string, doc: BackupDoc, files: BackupFile[]): BackupPayload {
  return {
    format: 2,
    kind,
    at,
    revision: doc.revision,
    docSha: payloadSha(canonicalEdits(doc)),
    textSha: payloadSha(textCanon(doc)),
    doc,
    files,
  };
}

export function verifyPayload(raw: unknown): { ok: true; payload: BackupPayload } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Kopia jest uszkodzona." };
  const row = raw as Partial<BackupPayload>;
  if (row.format !== 2 || !row.doc || !Array.isArray(row.files)) {
    return { ok: false, error: "Kopia jest uszkodzona." };
  }
  const doc = row.doc;
  if (payloadSha(canonicalEdits(doc)) !== row.docSha || payloadSha(textCanon(doc)) !== row.textSha) {
    return { ok: false, error: "Suma kontrolna dokumentu nie pasuje. Nic nie zostało podmienione." };
  }
  const need = plannedRefs(doc);
  if (row.files.length !== need.length) {
    return { ok: false, error: "Manifest zdjęć nie zgadza się z dokumentem. Nic nie zostało podmienione." };
  }
  for (const plan of need) {
    const file = row.files.find((item) => item.ref === plan.ref && item.use === plan.use);
    if (!file) return { ok: false, error: "W kopii brakuje pliku zdjęcia. Nic nie zostało podmienione." };
    const bytes = Buffer.from(file.base64, "base64");
    if (sha256Bytes(bytes) !== file.sha256 || sniffImage(bytes) !== file.mime) {
      return { ok: false, error: "Plik zdjęcia w kopii jest uszkodzony. Nic nie zostało podmienione." };
    }
  }
  return { ok: true, payload: { ...row, doc, files: row.files, format: 2 } as BackupPayload };
}

export function asLegacy(raw: unknown): { doc: BackupDoc; sha: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (row.format === 2 || row.format === 3) return null;
  if (row.doc && typeof row.doc === "object" && typeof row.sha === "string") {
    const doc = row.doc as BackupDoc;
    if (payloadSha(canonicalEdits(doc)) !== row.sha) return null;
    return { doc, sha: row.sha };
  }
  if (typeof row.revision === "number" && typeof row.sha === "string") {
    const sha = row.sha;
    const doc = { ...row } as BackupDoc & { sha?: string };
    delete doc.sha;
    if (payloadSha(canonicalEdits(doc)) !== sha) return null;
    return { doc, sha };
  }
  return null;
}

export function applyFiles(doc: BackupDoc, urls: Map<string, string>): BackupDoc {
  const images = Object.fromEntries(
    Object.entries(doc.images ?? {}).map(([id, ref]) => [id, urls.get(`public\0${ref}`) ?? ref]),
  );
  const entries = (doc.entries ?? []).map((entry) => {
    const use: ImageUse = entry.status === "published" ? "public" : "draft";
    const next = typeof entry.image === "string" ? urls.get(`${use}\0${entry.image}`) : undefined;
    return next ? { ...entry, image: next } : entry;
  });
  return { ...doc, images, entries };
}

function docHasUrl(doc: BackupDoc, file: BackupFile, url: string) {
  if (!url) return false;
  if (file.use === "public") {
    if (Object.values(doc.images ?? {}).includes(url)) return true;
    return (doc.entries ?? []).some((entry) => entry.status === "published" && entry.image === url);
  }
  return (doc.entries ?? []).some((entry) => entry.status !== "published" && entry.image === url);
}

async function assertRestored(doc: BackupDoc, files: BackupFile[], urls: Map<string, string>, readImage: (url: string) => Promise<Buffer | null>) {
  for (const file of files) {
    const url = urls.get(`${file.use}\0${file.ref}`) ?? "";
    if (!docHasUrl(doc, file, url)) throw new Error("adres");
    const bytes = await readImage(url);
    if (!bytes || sha256Bytes(bytes) !== file.sha256) throw new Error("zdjęcie");
  }
}

export async function recoverBackup(input: {
  phrase: string;
  expectedRevision: number;
  raw: unknown;
  readCurrent: () => Promise<BackupDoc | null>;
  revisionHint: () => Promise<number>;
  snapshot: (doc: BackupDoc) => Promise<void>;
  legacyFiles: (doc: BackupDoc) => Promise<BackupFile[] | null>;
  prepare?: (doc: BackupDoc) => BackupDoc;
  putImage: (file: BackupFile) => Promise<string>;
  writeDoc: (doc: BackupDoc, check: (written: BackupDoc) => Promise<void>) => Promise<number>;
  readBack: () => Promise<BackupDoc>;
  readImage: (url: string) => Promise<Buffer | null>;
}): Promise<RecoverResult> {
  if (!restoreAllowed(input.phrase)) {
    return { ok: false, message: "Wpisz PRZYWRÓĆ, żeby potwierdzić. Nic nie zostało podmienione." };
  }
  const verified = verifyPayload(input.raw);
  let files: BackupFile[] = [];
  let source: BackupDoc;
  if (verified.ok) {
    files = verified.payload.files;
    source = verified.payload.doc;
  } else {
    const legacy = asLegacy(input.raw);
    if (!legacy) return { ok: false, message: verified.error };
    let resolved: BackupFile[] | null = null;
    try {
      resolved = await input.legacyFiles(legacy.doc);
    } catch {
      resolved = null;
    }
    if (!resolved) {
      return {
        ok: false,
        message: "Ta kopia nie zawiera plików zdjęć, a stare adresy nie działają. Nic nie zostało podmienione.",
      };
    }
    files = resolved;
    source = legacy.doc;
  }
  let current: BackupDoc | null = null;
  try {
    current = await input.readCurrent();
  } catch {
    current = null;
  }
  if (restoreGate(current, input.expectedRevision) === "conflict") {
    return { ok: false, message: "Ktoś zapisał w międzyczasie. Odśwież stronę. Nic nie zostało podmienione." };
  }
  let snapshotted = false;
  if (current && !isBlankDoc(current)) {
    try {
      await input.snapshot(current);
      snapshotted = true;
    } catch {
      snapshotted = false;
    }
  }
  const urls = new Map<string, string>();
  try {
    for (const file of files) {
      urls.set(`${file.use}\0${file.ref}`, await input.putImage(file));
    }
  } catch {
    return {
      ok: false,
      message: "Nie udało się odłożyć zdjęć z kopii. Strona nie została podmieniona, a kopia źródłowa została.",
    };
  }
  const base = current && !isBlankDoc(current) ? current.revision : await input.revisionHint().catch(() => 0);
  const applied = applyFiles({ ...source, revision: Number.isInteger(base) && base > 0 ? base : 0 }, urls);
  const prepared = input.prepare ? input.prepare(applied) : applied;
  const next = { ...prepared, revision: applied.revision };
  let revision = 0;
  try {
    revision = await input.writeDoc(next, async (written) => {
      if (textCanon(written) !== textCanon(next)) throw new Error("odczyt");
      await assertRestored(written, files, urls, input.readImage);
    });
  } catch {
    return {
      ok: false,
      message: "Odzyskanie przerwało się przed publikacją. Poprzednia wersja została, a kopia źródłowa nie została skasowana.",
    };
  }
  try {
    const back = await input.readBack();
    if (textCanon(back) !== textCanon(next)) throw new Error("odczyt");
    await assertRestored(back, files, urls, input.readImage);
  } catch {
    return {
      ok: false,
      message: "Zapis odzyskania nie dał się ponownie odczytać. Kopia źródłowa nie została skasowana.",
    };
  }
  const message = snapshotted
    ? "Przywrócono kopię i sprawdzono, że da się ją odczytać. Aktualny stan został wcześniej zapisany."
    : "Przywrócono kopię i sprawdzono odczyt. Aktualnego stanu nie udało się zabezpieczyć albo był pusty. Stare kopie zostały.";
  return { ok: true, revision, snapshotted, message };
}

export function dropProtected(urls: string[], protect: string[]) {
  const ban = new Set(protect.filter(Boolean));
  return urls.filter((url) => !ban.has(url));
}

export type ManifestFile = {
  ref: string;
  use: ImageUse;
  mime: BackupFile["mime"];
  sha256: string;
  slices: number;
  /** Klucz, którym zaszyfrowano części. Puste = stara ścieżka bez identyfikatora. */
  kid?: string;
};

export type BackupManifest = {
  format: 3;
  kind: string;
  at: string;
  revision: number;
  docSha: string;
  textSha: string;
  doc: BackupDoc;
  files: ManifestFile[];
  /** Klucz, którym zaszyfrowano ten manifest i jego nowe części. Stare kopie go nie mają. */
  sealKid?: string;
};

export { RAW_SLICE, SERVER_PAYLOAD_LIMIT };

export function sliceBytes(bytes: Buffer, size = RAW_SLICE): Buffer[] {
  if (!bytes.length) return [];
  const out: Buffer[] = [];
  for (let offset = 0; offset < bytes.length; offset += size) out.push(bytes.subarray(offset, offset + size));
  return out;
}

const PART_KID = /^k[1-9]\d{0,2}$/;

/** Nowa kopia dostaje własną ścieżkę klucza. Stary plik części nie jest nadpisywany. */
export function partPath(sha256: string, slice: number, kid = ""): string {
  const safe = sha256.toLowerCase();
  if (kid && PART_KID.test(kid)) return `zielarka/backups/parts/${safe}/${kid}/${slice}.json`;
  return `zielarka/backups/parts/${safe}/${slice}.json`;
}

/** Najpierw ścieżka klucza z manifestu, potem stara ścieżka. Innego klucza nie ruszamy. */
export function partCandidates(sha256: string, slice: number, kid = ""): string[] {
  const primary = partPath(sha256, slice, kid);
  const legacy = partPath(sha256, slice);
  return primary === legacy ? [primary] : [primary, legacy];
}

/** Gotową część wolno użyć tylko wtedy, gdy leży pod aktualnym kluczem. Część k1 nie wystarcza manifestowi k2. */
export function canReuseSlice(storedKid: unknown, activeKid: string) {
  return typeof storedKid === "string" && storedKid === activeKid && PART_KID.test(activeKid);
}

/** Klucze potrzebne do tej kopii na serwerze. Pobrany plik jest potem ponownie szyfrowany aktualnym kluczem. */
export function keysRequired(manifest: { sealKid?: string; files?: { kid?: string }[] }) {
  const kids = new Set<string>();
  if (manifest.sealKid && PART_KID.test(manifest.sealKid)) kids.add(manifest.sealKid);
  for (const file of manifest.files || []) {
    if (file.kid && PART_KID.test(file.kid)) kids.add(file.kid);
  }
  return [...kids];
}

export function sliceEnvelope(sha256: string, slice: number, slices: number, bytes: Buffer) {
  return JSON.stringify({ sha256, slice, slices, base64: bytes.toString("base64") });
}

export function toManifest(payload: BackupPayload): BackupManifest {
  return {
    format: 3,
    kind: payload.kind,
    at: payload.at,
    revision: payload.revision,
    docSha: payload.docSha,
    textSha: payload.textSha,
    doc: payload.doc,
    files: payload.files.map((file) => ({
      ref: file.ref,
      use: file.use,
      mime: file.mime,
      sha256: file.sha256,
      slices: sliceBytes(Buffer.from(file.base64, "base64")).length,
    })),
  };
}

export function joinSliceText(parts: { slice: number; slices: number; base64: string }[]): string {
  if (!parts.length) return "";
  const seen = new Set<number>();
  for (const part of parts) {
    if (seen.has(part.slice)) {
      throw new Error("W kopii jest powtórzona część zdjęcia. Nic nie zostało podmienione.");
    }
    seen.add(part.slice);
  }
  const sorted = [...parts].sort((a, b) => a.slice - b.slice);
  const slices = sorted[0]?.slices ?? 0;
  if (sorted.length !== slices || sorted.some((part, index) => part.slice !== index || part.slices !== slices)) {
    throw new Error("W kopii brakuje części zdjęcia. Nic nie zostało podmienione.");
  }
  return sorted.map((part) => part.base64).join("");
}

export function attachManifestParts(
  manifest: BackupManifest,
  bins: { sha256: string; base64: string }[],
): { ok: true; payload: BackupPayload } | { ok: false; error: string } {
  if (manifest.format !== 3 || !manifest.doc || !Array.isArray(manifest.files)) {
    return { ok: false, error: "Kopia jest uszkodzona." };
  }
  const files: BackupFile[] = [];
  for (const file of manifest.files) {
    const bin = bins.find((item) => item.sha256 === file.sha256);
    if (!bin) return { ok: false, error: "W kopii brakuje pliku zdjęcia. Nic nie zostało podmienione." };
    const bytes = Buffer.from(bin.base64, "base64");
    if (sha256Bytes(bytes) !== file.sha256 || sniffImage(bytes) !== file.mime) {
      return { ok: false, error: "Plik zdjęcia w kopii jest uszkodzony. Nic nie zostało podmienione." };
    }
    files.push({ ref: file.ref, use: file.use, mime: file.mime, sha256: file.sha256, base64: bin.base64 });
  }
  const payload: BackupPayload = {
    format: 2,
    kind: manifest.kind,
    at: manifest.at,
    revision: manifest.revision,
    docSha: manifest.docSha,
    textSha: manifest.textSha,
    doc: manifest.doc,
    files,
  };
  return verifyPayload(payload);
}

/** Szkic idzie do prywatnego magazynu. Opublikowane zdjęcie może dostać publiczny adres. */
export function imageGoesToPrivateStore(use: ImageUse) {
  return use === "draft";
}

/**
 * Kopia jest dobra dopiero, gdy manifest i części składają się w ten sam dokument i te same bajty.
 * Sam manifest formatu 3 tu nie przechodzi.
 */
export function confirmBackupRoundtrip(
  source: BackupPayload,
  opened: BackupManifest,
  bins: { sha256: string; base64: string }[],
): { ok: true; payload: BackupPayload } | { ok: false; error: string } {
  const seen = new Set<string>();
  for (const file of opened.files || []) {
    const key = `${file.use}\0${file.ref}`;
    if (seen.has(key)) return { ok: false, error: "W kopii jest powtórzone zdjęcie. Nic nie zostało podmienione." };
    seen.add(key);
  }
  const attached = attachManifestParts(opened, bins);
  if (!attached.ok) return attached;
  if (attached.payload.docSha !== source.docSha || attached.payload.textSha !== source.textSha) {
    return { ok: false, error: "Suma kontrolna kopii nie pasuje. Nic nie zostało podmienione." };
  }
  if (textCanon(attached.payload.doc) !== textCanon(source.doc)) {
    return { ok: false, error: "Treść kopii nie da się odtworzyć. Nic nie zostało podmienione." };
  }
  for (const file of source.files) {
    const back = attached.payload.files.find((item) => item.ref === file.ref && item.use === file.use);
    if (!back || back.sha256 !== file.sha256 || back.base64 !== file.base64 || back.mime !== file.mime) {
      return { ok: false, error: "Plik zdjęcia w kopii jest uszkodzony. Nic nie zostało podmienione." };
    }
    const sourceEntry = source.doc.entries?.find((entry) => entry.image === file.ref);
    const backEntry = attached.payload.doc.entries?.find((entry) => entry.image === file.ref);
    if ((sourceEntry?.status ?? "") !== (backEntry?.status ?? "")) {
      return { ok: false, error: "Status szkicu albo publikacji nie da się odtworzyć. Nic nie zostało podmienione." };
    }
  }
  return attached;
}

export type BackupRetentionManifest = {
  pathname: string;
  url: string;
  uploadedAt: number;
  shas: string[];
};

export type BackupRetentionPart = {
  url: string;
  downloadUrl?: string;
  sha256: string;
};

/**
 * Manifest chroniony przy przywracaniu zostaje razem ze swoimi częściami,
 * nawet gdy retencja już by go skasowała. Brak chronionej ścieżki na liście zatrzymuje kasowanie.
 */
export function planBackupRetention(input: {
  manifests: BackupRetentionManifest[];
  parts: BackupRetentionPart[];
  protectPathnames: string[];
}): { deleteUrls: string[] } {
  const protect = [...new Set(input.protectPathnames.filter(Boolean))];
  const byPath = new Map(input.manifests.map((item) => [item.pathname, item]));
  for (const path of protect) {
    if (!byPath.has(path)) {
      throw new Error("Chroniona kopia nie jest na kompletnej liście. Nic nie zostało skasowane.");
    }
  }
  const kept: KeptBlob[] = input.manifests.map((item) => ({
    pathname: item.pathname,
    url: item.url,
    uploadedAt: item.uploadedAt,
    revision: item.uploadedAt,
  }));
  const removeUrls = urlsToRetain(kept);
  const removeSet = new Set(removeUrls);
  const keepPaths = new Set<string>();
  for (const item of input.manifests) {
    if (!item.url || !removeSet.has(item.url)) keepPaths.add(item.pathname);
  }
  for (const path of protect) keepPaths.add(path);
  const referenced = new Set<string>();
  for (const path of keepPaths) {
    const item = byPath.get(path);
    if (!item) continue;
    for (const sha of item.shas) {
      if (!/^[a-f0-9]{64}$/.test(sha)) {
        throw new Error("Nie da się odczytać zachowanej kopii. Przycinanie zostało zatrzymane.");
      }
      referenced.add(sha);
    }
  }
  const partDeletes: string[] = [];
  for (const part of input.parts) {
    if (!/^[a-f0-9]{64}$/.test(part.sha256) || referenced.has(part.sha256)) continue;
    if (part.url) partDeletes.push(part.url);
    if (part.downloadUrl && part.downloadUrl !== part.url) partDeletes.push(part.downloadUrl);
  }
  const protectUrls = protect.flatMap((path) => {
    const item = byPath.get(path);
    return item?.url ? [item.url] : [];
  });
  return { deleteUrls: dropProtected([...removeUrls, ...partDeletes], protectUrls) };
}

