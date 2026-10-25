#!/usr/bin/env node
/**
 * Próbny zapis na OSOBNYM magazynie Vercel Blob. Nie rusza ścieżek produkcyjnych zielarka/.
 *
 * Bez zmiennych nic nie wysyła i kończy się kodem 0.
 *
 * Uruchomienie, dopiero gdy masz drugi, pusty magazyn (nie token produkcji):
 *   ZIELARKA_TEST_BLOB_OK=tak \
 *   ZIELARKA_TEST_BLOB_TOKEN='vercel_blob_rw_...' \
 *   node scripts/blob-restore-drill.mjs
 *
 * Token testowy nie może być równy BLOB_READ_WRITE_TOKEN.
 * Skrypt pisze wyłącznie pod zielarka-itest/<losowy-id>/ i kasuje tylko te adresy.
 * Nie przywraca CMS, nie rotuje produkcyjnego klucza i nie dotyka zielarka.pl.
 *
 * Pełne przywrócenie edytora (artykuły, szkice, zdjęcia, rotacja k1→k2, fraza PRZYWRÓĆ)
 * wymaga osobnego store i testowego CMS_SEAL_KEY. Tego ten skrypt nie robi na produkcji.
 * Reguły luki w numeracji i rotacji klucza sprawdzają testy jednostkowe (npm test).
 */
import { createHash, randomBytes } from "node:crypto";

const API = "11";
const ok = process.env.ZIELARKA_TEST_BLOB_OK === "tak";
const token = process.env.ZIELARKA_TEST_BLOB_TOKEN || "";
const production = process.env.BLOB_READ_WRITE_TOKEN || "";

function explain() {
  console.log(
    [
      "Próba na prawdziwym Blob nie została uruchomiona.",
      "Brak osobnego tokenu testowego. Produkcja nie była ruszana.",
      "Żeby ją włączyć: drugi magazyn Blob, ZIELARKA_TEST_BLOB_OK=tak i ZIELARKA_TEST_BLOB_TOKEN.",
      "Nie wklejaj tokenu produkcji.",
    ].join(" "),
  );
}

if (!ok || !token) {
  explain();
  process.exit(0);
}

if (production && production === token) {
  console.error("Token testowy jest taki sam jak BLOB_READ_WRITE_TOKEN. Nic nie zostało zapisane.");
  process.exit(1);
}

const runId = randomBytes(8).toString("hex");
const prefix = `zielarka-itest/${runId}/`;

function assertOwn(pathname) {
  if (!pathname.startsWith(prefix) || pathname.includes("..") || pathname.startsWith("zielarka/")) {
    throw new Error("Odmawiam ścieżki spoza próby. Nic więcej nie ruszam.");
  }
}

async function blobPut(pathname, body) {
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
  return data.url;
}

async function blobList() {
  const res = await fetch(`https://vercel.com/api/blob/?${new URLSearchParams({ prefix, limit: "1000" })}`, {
    headers: { authorization: `Bearer ${token}`, "x-api-version": API },
  });
  if (!res.ok) throw new Error(`Odczyt próby nie powiódł się (${res.status}).`);
  const data = await res.json();
  const blobs = Array.isArray(data.blobs) ? data.blobs : [];
  for (const blob of blobs) assertOwn(String(blob.pathname || ""));
  return blobs;
}

async function blobDelete(urls) {
  const clean = [...new Set(urls.filter((url) => typeof url === "string" && url.includes("vercel-storage.com")))];
  if (!clean.length) return;
  const res = await fetch("https://vercel.com/api/blob/delete", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "x-api-version": API,
      "content-type": "application/json",
    },
    body: JSON.stringify({ urls: clean }),
  });
  if (!res.ok) throw new Error(`Kasowanie próby nie powiodło się (${res.status}).`);
}

const created = [];
try {
  const image = randomBytes(64);
  const sha = createHash("sha256").update(image).digest("hex");
  const pointer = JSON.stringify({ revision: 10, url: "https://example.invalid/old" });
  const journal10 = JSON.stringify({ revision: 10, url: "https://example.invalid/10" });
  const journal12 = JSON.stringify({ revision: 12, url: "https://example.invalid/12", sha });
  created.push(await blobPut(`${prefix}current.json`, pointer));
  created.push(await blobPut(`${prefix}journal/00000010.json`, journal10));
  created.push(await blobPut(`${prefix}journal/00000012.json`, journal12));
  created.push(await blobPut(`${prefix}parts/${sha}.json`, JSON.stringify({ sha, bytes: image.toString("base64") })));

  const listed = await blobList();
  const numbers = listed
    .map((blob) => /\/journal\/(\d+)\.json$/.exec(String(blob.pathname || "")))
    .map((match) => (match ? Number(match[1]) : -1))
    .filter((value) => value >= 0);
  const newest = numbers.reduce((best, value) => (value > best ? value : best), -1);
  if (newest !== 12 || !numbers.includes(10) || numbers.includes(11)) {
    throw new Error("Lista próby nie pokazuje luki 10 i 12. Nic produkcyjnego nie było ruszane.");
  }
  const part = listed.find((blob) => String(blob.pathname || "").endsWith(`${sha}.json`));
  const partUrl = part?.downloadUrl || part?.url;
  if (!partUrl) throw new Error("Brak części próby.");
  const back = await fetch(partUrl, { cache: "no-store" });
  if (!back.ok) throw new Error(`Odczyt części próby nie powiódł się (${back.status}).`);
  const opened = await back.json();
  const got = Buffer.from(opened.bytes || "", "base64");
  if (!got.equals(image)) throw new Error("Bajty próby nie wróciły takie same.");

  await blobDelete(created);
  const after = await blobList();
  if (after.length) throw new Error("Po próbie zostały pliki testowe. Produkcja nie była ruszana.");
  console.log(`Próba na osobnym prefiksie ${prefix} przeszła i została skasowana. To nie jest test produkcyjnego CMS.`);
} catch (error) {
  try {
    const leftover = await blobList();
    await blobDelete(leftover.flatMap((blob) => [blob.url, blob.downloadUrl].filter(Boolean)));
  } catch {
    console.error("Nie udało się posprzątać prefiksu próby. Produkcyjnych ścieżek zielarka/ skrypt nie używa.");
  }
  console.error(error instanceof Error ? error.message : "Próba nie przeszła.");
  process.exit(1);
}
