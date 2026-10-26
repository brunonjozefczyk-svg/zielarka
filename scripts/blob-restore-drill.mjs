#!/usr/bin/env node
/**
 * Próba odzyskania na OSOBNYM magazynie Vercel Blob.
 *
 * To nie jest pełny proces CMS. Skrypt woła adapter z cms-restore-drill.ts
 * (funkcje kopii), a nie saveEntry, createVerifiedBackup ani finishRestoreUpload
 * z site-store.server.ts. Te funkcje sprawdza test w pamięci:
 * src/lib/cms-isolated.test.ts. Zielony wynik tego pliku nie oznacza,
 * że produkcyjny CMS został odtworzony na prawdziwym Blob.
 *
 * PASSED  — adapter naprawdę się wykonał na osobnym magazynie (kod 0).
 * FAILED  — próba się nie udała albo była wymagana i nie miała konfiguracji (kod 1).
 * SKIPPED — nie uruchomiono (kod 2). To nie jest potwierdzenie poprawności.
 *
 * Bez zmiennych skrypt nic nie wysyła.
 *
 * Prawdziwy bieg adaptera, dopiero na drugim, pustym magazynie (nie token produkcji):
 *   1. Utwórz w Vercel osobny Blob store. Nie używaj magazynu zielarka.pl.
 *   2. Skopiuj jego token. Ma postać vercel_blob_rw_<id>_<sekret>.
 *   3. Wygeneruj klucz inny niż CMS_SEAL_KEY:
 *        node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *   4. Uruchom:
 *        ZIELARKA_TEST_BLOB_OK=tak \
 *        ZIELARKA_TEST_BLOB_TOKEN='vercel_blob_rw_...' \
 *        ZIELARKA_TEST_BLOB_STORE='<id z tokenu>' \
 *        ZIELARKA_TEST_CMS_SEAL_KEY='<base64 32 bajty>' \
 *        node --import jiti/register scripts/blob-restore-drill.mjs
 *
 * Wymuszony bieg, gdy brak konfiguracji ma być błędem:
 *   ZIELARKA_REQUIRE_BLOB_DRILL=tak node scripts/blob-restore-drill.mjs
 *
 * Skrypt pisze i kasuje wyłącznie zielarka-itest/<id-próby>/.
 * Odmawia tokenu równego BLOB_READ_WRITE_TOKEN, tego samego identyfikatora magazynu
 * i klucza równego CMS_SEAL_KEY albo CMS_SEAL_KEYS. Nie kasuje ścieżek zielarka/.
 */
import { randomBytes } from "node:crypto";

const requireRun = process.env.ZIELARKA_REQUIRE_BLOB_DRILL === "tak";
const opted = process.env.ZIELARKA_TEST_BLOB_OK === "tak" && Boolean((process.env.ZIELARKA_TEST_BLOB_TOKEN || "").trim());

if (!opted) {
  const status = requireRun ? "FAILED" : "SKIPPED";
  console.log(
    requireRun
      ? "Test adaptera odzyskania na Vercel Blob był wymagany, ale brak osobnego magazynu. Nic nie zostało zapisane."
      : "Próba odzyskania na Vercel Blob nie została uruchomiona. Brak osobnego magazynu testowego. To nie jest potwierdzenie poprawności. Produkcja nie była ruszana.",
  );
  console.log(status);
  process.exit(requireRun ? 1 : 2);
}

const { assertDrillKey, capDrillDeletes, classifyDrillConfig, runCmsRestoreDrill, DRILL_DELETE_CAP } = await import(
  "../src/lib/cms-restore-drill.ts"
);

const decision = classifyDrillConfig(process.env);
if (decision.status !== "READY") {
  console.log(decision.message);
  console.log(decision.status);
  process.exit(decision.exitCode);
}

const token = decision.token;
const production = (process.env.BLOB_READ_WRITE_TOKEN || "").trim();
if (production && production === token) {
  console.log("Token testowy jest taki sam jak BLOB_READ_WRITE_TOKEN. Nic nie zostało zapisane.");
  console.log("FAILED");
  process.exit(1);
}

const k2 = randomBytes(32).toString("base64");
if (k2 === decision.testKey) {
  console.log("Nie da się wylosować drugiego klucza próby. Nic nie zostało zapisane.");
  console.log("FAILED");
  process.exit(1);
}

const runId = randomBytes(8).toString("hex");
const prefix = `zielarka-itest/${runId}/`;
const API = "11";
const urls = new Map();

function assertOwn(pathname) {
  if (
    typeof pathname !== "string" ||
    !pathname.startsWith(prefix) ||
    pathname.includes("..") ||
    pathname.startsWith("zielarka/") ||
    pathname.includes("/zielarka/")
  ) {
    throw new Error("Odmawiam ścieżki spoza próby. Nic więcej nie ruszam.");
  }
}

async function listOwned() {
  const found = [];
  let cursor = "";
  for (let page = 0; page < 5; page += 1) {
    const params = new URLSearchParams({ prefix, limit: "1000" });
    if (cursor) params.set("cursor", cursor);
    const res = await fetch(`https://vercel.com/api/blob/?${params}`, {
      headers: { authorization: `Bearer ${token}`, "x-api-version": API },
    });
    if (!res.ok) throw new Error(`Odczyt próby nie powiódł się (${res.status}).`);
    const data = await res.json();
    const blobs = Array.isArray(data.blobs) ? data.blobs : [];
    for (const blob of blobs) {
      const pathname = String(blob.pathname || "");
      assertOwn(pathname);
      const key = pathname.slice(prefix.length);
      assertDrillKey(key);
      found.push({ key, url: typeof blob.url === "string" ? blob.url : "", downloadUrl: typeof blob.downloadUrl === "string" ? blob.downloadUrl : "" });
    }
    if (!data.hasMore) return found;
    if (typeof data.cursor !== "string" || !data.cursor || data.cursor === cursor) {
      throw new Error("Lista próby zapętliła się. Nic nie zostało skasowane.");
    }
    cursor = data.cursor;
  }
  throw new Error("Lista próby jest za długa. Nic nie zostało skasowane.");
}

const store = {
  async put(key, body) {
    assertDrillKey(key);
    const pathname = `${prefix}${key}`;
    assertOwn(pathname);
    const res = await fetch(`https://vercel.com/api/blob/?${new URLSearchParams({ pathname })}`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "x-api-version": API,
        "x-content-type": "application/json",
        "x-add-random-suffix": "0",
        "x-allow-overwrite": "1",
      },
      body,
    });
    if (!res.ok) throw new Error(`Zapis próby nie powiódł się (${res.status}).`);
    const data = await res.json();
    if (!data?.url || typeof data.url !== "string") throw new Error("Zapis próby nie zwrócił adresu.");
    urls.set(key, data.downloadUrl || data.url);
  },
  async get(key) {
    assertDrillKey(key);
    const known = urls.get(key);
    if (!known) return null;
    const res = await fetch(known, {
      cache: "no-store",
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Odczyt próby nie powiódł się (${res.status}).`);
    return res.text();
  },
  async list() {
    const blobs = await listOwned();
    return blobs.map((blob) => blob.key);
  },
  async delete(keys) {
    const clean = capDrillDeletes(keys);
    const owned = await listOwned();
    if (owned.length > DRILL_DELETE_CAP) throw new Error("Za dużo plików do skasowania. Nic nie zostało skasowane.");
    const wanted = new Set(clean);
    const drop = [];
    for (const blob of owned) {
      if (!wanted.has(blob.key)) continue;
      if (blob.url) drop.push(blob.url);
      if (blob.downloadUrl && blob.downloadUrl !== blob.url) drop.push(blob.downloadUrl);
    }
    const unique = [...new Set(drop)].filter((url) => url.includes("vercel-storage.com"));
    if (unique.length > DRILL_DELETE_CAP) throw new Error("Za dużo plików do skasowania. Nic nie zostało skasowane.");
    if (unique.length) {
      const res = await fetch("https://vercel.com/api/blob/delete", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "x-api-version": API,
          "content-type": "application/json",
        },
        body: JSON.stringify({ urls: unique }),
      });
      if (!res.ok) throw new Error(`Kasowanie próby nie powiodło się (${res.status}). Nic więcej nie zostało skasowane.`);
    }
    for (const key of clean) urls.delete(key);
  },
};

async function cleanup() {
  const left = await store.list();
  if (left.length) await store.delete(left);
}

try {
  const report = await runCmsRestoreDrill(store, { k1: decision.testKey, k2 });
  await cleanup();
  if (report.status !== "PASSED") throw new Error("Próba nie zwróciła PASSED.");
  console.log(`Próba odzyskania na prefiksie ${prefix} przeszła i została skasowana. Produkcja nie była ruszana.`);
  console.log("PASSED");
} catch (error) {
  try {
    await cleanup();
  } catch {
    console.error("Nie udało się posprzątać prefiksu próby. Ścieżek zielarka/ skrypt nie używa.");
  }
  console.error(error instanceof Error ? error.message : "Próba nie przeszła.");
  console.log("FAILED");
  process.exit(1);
}
