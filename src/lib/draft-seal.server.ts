import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const SALT = "zielarka-drafts-v1";
let cached: { secret: string; key: Buffer } | null = null;

function sealKey() {
  const secret = process.env.EDITOR_PASSWORD?.trim() || "";
  if (!secret) throw new Error("Brak hasła edytora.");
  if (cached?.secret === secret) return cached.key;
  const key = scryptSync(secret, SALT, 32);
  cached = { secret, key };
  return key;
}

export function sealJson(json: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sealKey(), iv);
  const data = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  return JSON.stringify({
    sealed: 1,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    data: data.toString("base64url"),
  });
}

export function openJson(raw: unknown) {
  if (!raw || typeof raw !== "object" || (raw as { sealed?: unknown }).sealed !== 1) return raw;
  const box = raw as { iv?: unknown; tag?: unknown; data?: unknown };
  if (typeof box.iv !== "string" || typeof box.tag !== "string" || typeof box.data !== "string") {
    throw new Error("Nie da się odczytać kopii.");
  }
  const decipher = createDecipheriv("aes-256-gcm", sealKey(), Buffer.from(box.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(box.tag, "base64url"));
  const json = Buffer.concat([
    decipher.update(Buffer.from(box.data, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(json) as unknown;
}
