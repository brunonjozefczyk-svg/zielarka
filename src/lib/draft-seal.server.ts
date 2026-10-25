import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";

/**
 * Klucz zapisu (CMS_SEAL_KEY) jest niezależny od hasła edytora.
 * Rotacja: ustaw nowy klucz jako CMS_SEAL_KEY (kid k1), a poprzedni dopisz
 * do CMS_SEAL_KEYS jako "k0:<base64>". Odczyt użyje kid z koperty.
 * Stare kopie bez kid (tylko hasło) otwiera EDITOR_PASSWORD, a po jego zmianie
 * CMS_SEAL_LEGACY_PASSWORD. Nowe zapisy zawsze idą kluczem k1.
 * Klucza nie ma w repozytorium. Wygeneruj: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */
const PASSWORD_SALT = "zielarka-drafts-v1";
const CURRENT_KID = "k1";

type Ring = { raw: string; keys: { kid: string; key: Buffer }[] };

let ringCache: Ring | null = null;

function decodeKey(value: string) {
  const buf = Buffer.from(value.trim(), "base64");
  return buf.length === 32 ? buf : null;
}

function passwordKey(secret: string) {
  return scryptSync(secret, PASSWORD_SALT, 32);
}

export function sealConfigured() {
  return Boolean(decodeKey(process.env.CMS_SEAL_KEY?.trim() || ""));
}

function ring(): Ring {
  const currentRaw = process.env.CMS_SEAL_KEY?.trim() || "";
  const extra = process.env.CMS_SEAL_KEYS?.trim() || "";
  const raw = `${currentRaw}|${extra}`;
  if (ringCache?.raw === raw) return ringCache;
  const keys: Ring["keys"] = [];
  const current = decodeKey(currentRaw);
  if (current) keys.push({ kid: CURRENT_KID, key: current });
  for (const part of extra.split(",")) {
    const splitAt = part.indexOf(":");
    if (splitAt < 1) continue;
    const kid = part.slice(0, splitAt).trim();
    const key = decodeKey(part.slice(splitAt + 1));
    if (kid && key && kid !== CURRENT_KID) keys.push({ kid, key });
  }
  ringCache = { raw, keys };
  return ringCache;
}

function legacyPasswords() {
  const values = [process.env.CMS_SEAL_LEGACY_PASSWORD, process.env.EDITOR_PASSWORD];
  const out: string[] = [];
  for (const value of values) {
    const secret = value?.trim() || "";
    if (secret && !out.includes(secret)) out.push(secret);
  }
  return out;
}

function encrypt(json: string, key: Buffer, kid: string | null) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  return JSON.stringify({
    sealed: 1,
    ...(kid ? { kid } : { v: 1 }),
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    data: data.toString("base64url"),
  });
}

function decrypt(box: { iv: string; tag: string; data: string }, key: Buffer) {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(box.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(box.tag, "base64url"));
  const json = Buffer.concat([
    decipher.update(Buffer.from(box.data, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(json) as unknown;
}

export function sealJson(json: string) {
  const found = ring().keys.find((item) => item.kid === CURRENT_KID);
  if (!found) throw new Error("Brak klucza szyfrowania CMS. Ustaw CMS_SEAL_KEY na serwerze.");
  return encrypt(json, found.key, CURRENT_KID);
}

/** Tylko do testów i starych kopii. Nowe zapisy używają sealJson. */
export function sealWithEditorPassword(json: string, password: string) {
  if (!password.trim()) throw new Error("Brak hasła edytora.");
  return encrypt(json, passwordKey(password), null);
}

export function openJson(raw: unknown) {
  if (!raw || typeof raw !== "object" || (raw as { sealed?: unknown }).sealed !== 1) return raw;
  const box = raw as { kid?: unknown; iv?: unknown; tag?: unknown; data?: unknown };
  if (typeof box.iv !== "string" || typeof box.tag !== "string" || typeof box.data !== "string") {
    throw new Error("Nie da się odczytać kopii.");
  }
  const packed = { iv: box.iv, tag: box.tag, data: box.data };
  if (typeof box.kid === "string" && box.kid) {
    const found = ring().keys.find((item) => item.kid === box.kid);
    if (!found) throw new Error("Nie da się odczytać kopii. Brak pasującego klucza.");
    return decrypt(packed, found.key);
  }
  const passwords = legacyPasswords();
  if (!passwords.length) throw new Error("Nie da się odczytać starej kopii. Ustaw CMS_SEAL_LEGACY_PASSWORD.");
  let failed = true;
  for (const secret of passwords) {
    try {
      return decrypt(packed, passwordKey(secret));
    } catch {
      failed = true;
    }
  }
  if (failed) throw new Error("Nie da się odczytać starej kopii. Hasło sprzed zmiany ustaw jako CMS_SEAL_LEGACY_PASSWORD.");
  throw new Error("Nie da się odczytać kopii.");
}

export function resealJson(raw: unknown) {
  return sealJson(JSON.stringify(openJson(raw)));
}

export function payloadSha(text: string) {
  return createHash("sha256").update(text).digest("hex");
}
