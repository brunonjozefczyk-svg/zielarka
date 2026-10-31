import { createHmac, timingSafeEqual } from "node:crypto";

const TTL = 5 * 60_000;
const MIN_SECRET = 32;
type GateResult = { ok: boolean; message: string };

function signature(body: string, clientKey: string, secret: string) {
  return createHmac("sha256", secret).update(`zielarka:stats:v1:${clientKey}:${body}`).digest("base64url");
}

/**
 * Normalize the session secret before it is joined with the editor password.
 * Blank, whitespace-only, or short values never sign a token.
 */
export function statsSessionKey(raw: string | null | undefined, editorPassword: string): string {
  const secret = (raw ?? "").trim();
  if (secret.length < MIN_SECRET) return "";
  return `${secret}\0${editorPassword ?? ""}`;
}

/** Accept only a key whose own secret (before NUL) is still long enough after trim. */
function signingKey(combined: string): string {
  const nul = combined.indexOf("\0");
  if (nul < 0) return "";
  const secret = combined.slice(0, nul).trim();
  if (secret.length < MIN_SECRET) return "";
  return `${secret}\0${combined.slice(nul + 1)}`;
}

/** A short, read-only capability. It cannot authorize CMS mutations. */
export async function authorizeStats(
  password: string,
  token: string,
  clientKey: string,
  deps: { secret: string; gate: (password: string) => Promise<GateResult>; now?: number },
) {
  const now = deps.now ?? Date.now();
  const secret = signingKey(deps.secret);
  const parts = token.split(".");
  const [expires, mac] = parts;
  const exp = Number(expires);
  if (secret && parts.length === 2 && /^\d+$/.test(expires ?? "") && exp > now && exp <= now + TTL && mac) {
    const expected = Buffer.from(signature(expires!, clientKey, secret));
    const actual = Buffer.from(mac);
    if (expected.length === actual.length && timingSafeEqual(expected, actual)) {
      return { ok: true as const, message: "", token };
    }
  }
  // Failed, expired or absent capabilities still use the existing persistent limiter.
  const result = await deps.gate(password);
  if (!result.ok) return { ok: false as const, message: result.message, token: "" };
  // No strong session key: authenticate normally, never sign with a human password.
  if (!secret) return { ok: true as const, message: "", token: "" };
  const body = String(now + TTL);
  return { ok: true as const, message: "", token: `${body}.${signature(body, clientKey, secret)}` };
}
