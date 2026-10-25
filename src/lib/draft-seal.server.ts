import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";

/**
 * Klucz zapisu (CMS_SEAL_KEY) jest niezależny od hasła edytora.
 * Sam base64 oznacza identyfikator k1 — tak są oznaczone dotychczasowe koperty.
 * Nowy klucz podawaj z własnym identyfikatorem: CMS_SEAL_KEY="k2:<base64>".
 * Poprzednie klucze zostaw w CMS_SEAL_KEYS jako "k1:<base64>,k3:<base64>".
 * Nie podmieniaj wartości pod tym samym identyfikatorem. Stare kopie bez kid
 * otwiera CMS_SEAL_LEGACY_PASSWORD, a gdy go nie ma — EDITOR_PASSWORD.
 * Klucza nie ma w repozytorium. Wygeneruj: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */
const PASSWORD_SALT = "zielarka-drafts-v1";
const LEGACY_KID = "k1";
const KID_RE = /^k[1-9]\d{0,2}$/;

type KeyRec = { kid: string; key: Buffer };
type Ring = { raw: string; active: KeyRec | null; keys: KeyRec[] };

let ringCache: Ring | null = null;

function decodeKey(value: string) {
  const buf = Buffer.from(value.trim(), "base64");
  return buf.length === 32 ? buf : null;
}

function passwordKey(secret: string) {
  return scryptSync(secret, PASSWORD_SALT, 32);
}

export function splitSealToken(value: string): KeyRec | null {
  const raw = value.trim();
  if (!raw) return null;
  const colon = raw.indexOf(":");
  if (colon > 0) {
    const kid = raw.slice(0, colon).trim();
    if (!KID_RE.test(kid)) return null;
    const key = decodeKey(raw.slice(colon + 1));
    return key ? { kid, key } : null;
  }
  const key = decodeKey(raw);
  return key ? { kid: LEGACY_KID, key } : null;
}

function addKey(keys: KeyRec[], item: KeyRec) {
  const found = keys.find((row) => row.kid === item.kid);
  if (!found) {
    keys.push(item);
    return;
  }
  if (!found.key.equals(item.key)) {
    throw new Error(`Identyfikator ${item.kid} wskazuje dwa różne klucze. Nic nie zostało zapisane ani skasowane.`);
  }
}

function loadRing(): Ring {
  const currentRaw = process.env.CMS_SEAL_KEY?.trim() || "";
  const extra = process.env.CMS_SEAL_KEYS?.trim() || "";
  const raw = `${currentRaw}|${extra}`;
  if (ringCache?.raw === raw) return ringCache;
  const active = currentRaw ? splitSealToken(currentRaw) : null;
  if (currentRaw && !active) {
    throw new Error("CMS_SEAL_KEY jest niepoprawny. Zapis został zatrzymany. Dane nie zostały skasowane.");
  }
  const keys: KeyRec[] = [];
  if (active) addKey(keys, active);
  for (const part of extra.split(",")) {
    if (!part.trim()) continue;
    const item = splitSealToken(part);
    if (!item) throw new Error("CMS_SEAL_KEYS ma niepoprawny zapis. Odczyt został zatrzymany. Dane nie zostały skasowane.");
    addKey(keys, item);
  }
  ringCache = { raw, active, keys };
  return ringCache;
}

export function sealConfigured() {
  try {
    return Boolean(loadRing().active);
  } catch {
    return false;
  }
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
  const { active } = loadRing();
  if (!active) throw new Error("Brak klucza szyfrowania CMS. Ustaw CMS_SEAL_KEY na serwerze.");
  return encrypt(json, active.key, active.kid);
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
    const found = loadRing().keys.find((item) => item.kid === box.kid);
    if (!found) {
      throw new Error(`Nie da się odczytać kopii. Brak klucza ${box.kid}. Dopisz go do CMS_SEAL_KEYS. Dane nie zostały skasowane.`);
    }
    return decrypt(packed, found.key);
  }
  const passwords = legacyPasswords();
  if (!passwords.length) throw new Error("Nie da się odczytać starej kopii. Ustaw CMS_SEAL_LEGACY_PASSWORD.");
  for (const secret of passwords) {
    try {
      return decrypt(packed, passwordKey(secret));
    } catch {
      // Następne hasło.
    }
  }
  throw new Error("Nie da się odczytać starej kopii. Hasło sprzed zmiany ustaw jako CMS_SEAL_LEGACY_PASSWORD.");
}

export function resealJson(raw: unknown) {
  return sealJson(JSON.stringify(openJson(raw)));
}

export function payloadSha(text: string) {
  return createHash("sha256").update(text).digest("hex");
}
