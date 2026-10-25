/**
 * Pełna kopia CMS: dokument i bajty zdjęć, nie same adresy.
 * Plik do pobrania jest szyfrowany przez pieczęć CMS. Sam ten moduł nie wysyła go do sieci.
 * Automatyczna kopia poza Vercel Blob nie jest tu włączona.
 */
import { createHash } from "node:crypto";
import { canonicalEdits, restoreAllowed } from "./cms-guard";
import { payloadSha } from "./draft-seal.server";

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
  if (row.format === 2) return null;
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
