import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  attachManifestParts,
  buildPayload,
  confirmBackupRoundtrip,
  dropProtected,
  fileFromBytes,
  imageGoesToPrivateStore,
  isBlankDoc,
  joinSliceText,
  planBackupRetention,
  plannedRefs,
  recoverBackup,
  restoreGate,
  sha256Bytes,
  sliceBytes,
  sliceEnvelope,
  toManifest,
  verifyPayload,
  RAW_SLICE,
  SERVER_PAYLOAD_LIMIT,
  type BackupDoc,
  type BackupFile,
} from "./backup-bundle.ts";
import { OFFSITE_AUTOMATIC, offsiteDecision } from "./backup-wire.ts";
import { openJson, sealJson } from "./draft-seal.server.ts";
import { parseStoredEntry } from "./entries.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function docWith(published: string, draft: string): BackupDoc {
  return {
    revision: 4,
    copy: { "home.h1": "Zioła" },
    images: { hero: published },
    herbs: {},
    entries: [
      { slug: "mieta", status: "published", name: "Mięta", lead: "liść", image: published },
      { slug: "szkic", status: "draft", name: "Sekretna mięta", lead: "ukryte", image: draft },
    ],
    theme: null,
    styles: {},
  };
}

function filesFor(doc: BackupDoc): BackupFile[] {
  return plannedRefs(doc).map((plan) => {
    const file = fileFromBytes(plan.ref, plan.use, PNG);
    assert.ok(file);
    return file;
  });
}

test("długi adres zdjęcia szkicu nie jest obcinany", () => {
  const image = `seal:https://example.blob.vercel-storage.com/${"a".repeat(420)}`;
  const entry = parseStoredEntry({ slug: "mieta-test", name: "Mięta", status: "draft", image });
  assert.equal(entry?.image, image);
  assert.ok((entry?.image.length ?? 0) > 400);
});

test("kopia bez pliku zdjęcia nie jest dobra", () => {
  const doc = docWith("https://cdn.example/jawne.png", "https://cdn.example/szkic.png");
  const payload = buildPayload("ręczna", "2026-10-25T00:00:00.000Z", doc, []);
  const checked = verifyPayload(payload);
  assert.equal(checked.ok, false);
  if (!checked.ok) assert.match(checked.error, /Nie zostało podmienione|Nic nie zostało podmienione/);
});

test("zaszyfrowany plik nie zawiera nazwy szkicu", () => {
  const previous = process.env.CMS_SEAL_KEY;
  process.env.CMS_SEAL_KEY = randomBytes(32).toString("base64");
  try {
    const published = `data:image/png;base64,${PNG.toString("base64")}`;
    const draft = `data:image/png;base64,${PNG.toString("base64")}`;
    const doc = docWith(published, draft);
    const payload = buildPayload("pobranie", "2026-10-25T00:00:00.000Z", doc, filesFor(doc));
    const sealed = sealJson(JSON.stringify(payload));
    assert.equal(sealed.includes("Sekretna"), false);
    assert.equal(sealed.includes("ukryte"), false);
    const opened = verifyPayload(openJson(JSON.parse(sealed)));
    assert.equal(opened.ok, true);
  } finally {
    if (previous) process.env.CMS_SEAL_KEY = previous;
    else delete process.env.CMS_SEAL_KEY;
  }
});

test("uszkodzona baza nie blokuje odtworzenia, a zła kopia nic nie zapisuje", async () => {
  const published = "https://stary.example/jawne.png";
  const draft = "https://stary.example/szkic.png";
  const doc = docWith(published, draft);
  const payload = buildPayload("ręczna", "2026-10-25T00:00:00.000Z", doc, filesFor(doc));
  let writes = 0;
  let snapshots = 0;
  const fresh = new Map<string, Buffer>();
  const result = await recoverBackup({
    phrase: "PRZYWRÓĆ",
    expectedRevision: 99,
    raw: payload,
    readCurrent: async () => {
      throw new Error("dokument uszkodzony");
    },
    revisionHint: async () => 7,
    snapshot: async () => {
      snapshots += 1;
    },
    legacyFiles: async () => null,
    putImage: async (file) => {
      const url = file.use === "draft" ? `seal:mem://${file.sha256}` : `mem://${file.sha256}`;
      fresh.set(url, Buffer.from(file.base64, "base64"));
      return url;
    },
    writeDoc: async (next, check) => {
      writes += 1;
      await check(next);
      fresh.set("doc", Buffer.from(JSON.stringify(next)));
      return next.revision + 1;
    },
    readBack: async () => JSON.parse(fresh.get("doc")?.toString("utf8") || "{}") as BackupDoc,
    readImage: async (url) => fresh.get(url) ?? null,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.snapshotted, false);
    assert.equal(result.revision, 8);
    assert.match(result.message, /Przywrócono/);
  }
  assert.equal(snapshots, 0);
  assert.equal(writes, 1);
  const restored = JSON.parse(fresh.get("doc")?.toString("utf8") || "{}") as BackupDoc;
  assert.equal(restored.entries.find((entry) => entry.slug === "szkic")?.name, "Sekretna mięta");
  assert.equal(restored.entries.find((entry) => entry.slug === "szkic")?.status, "draft");
  assert.match(String(restored.entries.find((entry) => entry.slug === "szkic")?.image), /^seal:/);
  assert.equal(restored.copy["home.h1"], "Zioła");
  const broken = { ...payload, docSha: "0".repeat(64) };
  let blocked = 0;
  const refused = await recoverBackup({
    phrase: "PRZYWRÓĆ",
    expectedRevision: 1,
    raw: broken,
    readCurrent: async () => null,
    revisionHint: async () => 0,
    snapshot: async () => undefined,
    legacyFiles: async () => null,
    putImage: async () => {
      blocked += 1;
      return "mem://x";
    },
    writeDoc: async () => {
      blocked += 1;
      return 1;
    },
    readBack: async () => doc,
    readImage: async () => PNG,
  });
  assert.equal(refused.ok, false);
  assert.equal(blocked, 0);
});

test("utrata testowego magazynu odtwarza tekst i zdjęcia z pliku, nie z Vercel", async () => {
  const previous = process.env.CMS_SEAL_KEY;
  process.env.CMS_SEAL_KEY = randomBytes(32).toString("base64");
  try {
    const doc = docWith(`data:image/png;base64,${PNG.toString("base64")}`, `data:image/png;base64,${PNG.toString("base64")}`);
    const payload = buildPayload("pobranie", "2026-10-25T00:00:00.000Z", doc, filesFor(doc));
    const file = sealJson(JSON.stringify(payload));
    const store = new Map<string, Buffer>();
    const opened = openJson(JSON.parse(file));
    const result = await recoverBackup({
      phrase: "PRZYWRÓĆ",
      expectedRevision: 0,
      raw: opened,
      readCurrent: async () => {
        throw new Error("magazyn zniknął");
      },
      revisionHint: async () => 0,
      snapshot: async () => {
        throw new Error("nie ma czego zabezpieczyć");
      },
      legacyFiles: async () => null,
      putImage: async (image) => {
        const url = image.use === "draft" ? `seal:mem://${image.use}` : `mem://${image.use}`;
        store.set(url, Buffer.from(image.base64, "base64"));
        return url;
      },
      writeDoc: async (next, check) => {
        await check(next);
        store.set("doc", Buffer.from(JSON.stringify(next)));
        return 1;
      },
      readBack: async () => JSON.parse(store.get("doc")?.toString("utf8") || "{}") as BackupDoc,
      readImage: async (url) => store.get(url) ?? null,
    });
    assert.equal(result.ok, true);
    const restored = JSON.parse(store.get("doc")?.toString("utf8") || "{}") as BackupDoc;
    assert.equal(restored.entries.find((entry) => entry.status === "published")?.name, "Mięta");
    assert.equal(store.get("mem://public")?.equals(PNG), true);
    assert.equal(store.get("seal:mem://draft")?.equals(PNG), true);
    assert.equal(file.includes("Sekretna"), false);
  } finally {
    if (previous) process.env.CMS_SEAL_KEY = previous;
    else delete process.env.CMS_SEAL_KEY;
  }
});

test("czytelna nowsza wersja nie jest nadpisywana, a błąd kopii bieżącej nie zatrzymuje odzyskania", async () => {
  const doc = docWith("/images/nettle.webp", "/images/tea.webp");
  const payload = buildPayload("ręczna", "2026-10-25T00:00:00.000Z", doc, []);
  let writes = 0;
  const conflict = await recoverBackup({
    phrase: "PRZYWRÓĆ",
    expectedRevision: 2,
    raw: payload,
    readCurrent: async () => ({ ...doc, revision: 5 }),
    revisionHint: async () => 5,
    snapshot: async () => undefined,
    legacyFiles: async () => [],
    putImage: async () => "mem://x",
    writeDoc: async () => {
      writes += 1;
      return 6;
    },
    readBack: async () => doc,
    readImage: async () => null,
  });
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.match(conflict.message, /Odśwież stronę/);
  assert.equal(writes, 0);
  assert.equal(restoreGate({ ...doc, revision: 5 }, 5), "proceed");
  assert.equal(isBlankDoc({ ...doc, revision: 0, copy: {}, images: {}, herbs: {}, entries: [] }), true);

  let snapshots = 0;
  const saved = new Map<string, string>();
  const recovered = await recoverBackup({
    phrase: "PRZYWRÓĆ",
    expectedRevision: 4,
    raw: payload,
    readCurrent: async () => doc,
    revisionHint: async () => 4,
    snapshot: async () => {
      snapshots += 1;
      throw new Error("nie da się zabezpieczyć");
    },
    legacyFiles: async () => [],
    putImage: async () => "mem://unused",
    writeDoc: async (next, check) => {
      await check(next);
      saved.set("doc", JSON.stringify(next));
      return 5;
    },
    readBack: async () => JSON.parse(saved.get("doc") || "{}") as BackupDoc,
    readImage: async () => null,
  });
  assert.equal(recovered.ok, true);
  if (recovered.ok) assert.equal(recovered.snapshotted, false);
  assert.equal(snapshots, 1);
  assert.equal(dropProtected(["https://zostaw", "https://usun"], ["https://zostaw"]).includes("https://zostaw"), false);
});

test("przerwany zapis i stara kopia bez zdjęć nie podmieniają strony", async () => {
  const doc = docWith("https://cdn.example/a.png", "https://cdn.example/b.png");
  const payload = buildPayload("ręczna", "2026-10-25T00:00:00.000Z", doc, filesFor(doc));
  let committed = false;
  const stopped = await recoverBackup({
    phrase: "PRZYWRÓĆ",
    expectedRevision: 4,
    raw: payload,
    readCurrent: async () => null,
    revisionHint: async () => 4,
    snapshot: async () => undefined,
    legacyFiles: async () => null,
    putImage: async (file) => `mem://${file.use}`,
    writeDoc: async (_next, check) => {
      await check({ ..._next, copy: { "home.h1": "inne" } });
      committed = true;
      return 5;
    },
    readBack: async () => doc,
    readImage: async () => PNG,
  });
  assert.equal(stopped.ok, false);
  assert.equal(committed, false);
  if (!stopped.ok) assert.match(stopped.message, /nie została skasowana/);
  const legacy = await recoverBackup({
    phrase: "PRZYWRÓĆ",
    expectedRevision: 4,
    raw: { sha: payload.docSha, doc },
    readCurrent: async () => null,
    revisionHint: async () => 0,
    snapshot: async () => undefined,
    legacyFiles: async () => null,
    putImage: async () => "mem://x",
    writeDoc: async () => {
      committed = true;
      return 1;
    },
    readBack: async () => doc,
    readImage: async () => PNG,
  });
  assert.equal(legacy.ok, false);
  assert.equal(committed, false);
});

test("części kopii składają 1, 4, 10, 25 i 50 MB", () => {
  const previous = process.env.CMS_SEAL_KEY;
  process.env.CMS_SEAL_KEY = randomBytes(32).toString("base64");
  try {
    assert.equal(RAW_SLICE % 3, 0);
    assert.equal(OFFSITE_AUTOMATIC, false);
    const sealed = sealJson(sliceEnvelope("a".repeat(64), 0, 1, Buffer.alloc(RAW_SLICE, 9)));
    assert.ok(sealed.length <= SERVER_PAYLOAD_LIMIT);
    for (const size of [1, 4, 10, 25, 50].map((megabytes) => megabytes * 1024 * 1024)) {
      const bytes = Buffer.alloc(size, 3);
      PNG.copy(bytes);
      const sha = sha256Bytes(bytes);
      const slices = sliceBytes(bytes);
      const joined = joinSliceText(
        slices.map((slice, index) => ({ slice: index, slices: slices.length, base64: slice.toString("base64") })),
      );
      assert.equal(sha256Bytes(Buffer.from(joined, "base64")), sha);
      for (const [index, slice] of slices.entries()) {
        assert.ok(sliceEnvelope(sha, index, slices.length, slice).length < SERVER_PAYLOAD_LIMIT);
      }
    }
  } finally {
    if (previous === undefined) delete process.env.CMS_SEAL_KEY;
    else process.env.CMS_SEAL_KEY = previous;
  }
});

test("kopia większa niż 4 MB wraca ze zdjęciami, a brak części nic nie zapisuje", async () => {
  const previous = process.env.CMS_SEAL_KEY;
  process.env.CMS_SEAL_KEY = randomBytes(32).toString("base64");
  try {
    const image = Buffer.alloc(2_400_000, 2);
    PNG.copy(image);
    const draftImage = Buffer.from(image);
    draftImage[draftImage.length - 1] = 9;
    const published = fileFromBytes("https://cdn.example/a.png", "public", image);
    const draft = fileFromBytes("seal:draft", "draft", draftImage);
    assert.ok(published && draft);
    const doc = docWith("https://cdn.example/a.png", "seal:draft");
    const payload = buildPayload("pobranie", "2026-10-25T00:00:00.000Z", doc, [published, draft]);
    assert.ok(JSON.stringify(payload).length > 4_000_000);
    const manifest = toManifest(payload);
    const bins = manifest.files.map((file) => {
      const source = file.sha256 === draft.sha256 ? draft : published;
      const slices = sliceBytes(Buffer.from(source.base64, "base64"));
      assert.equal(slices.length, file.slices);
      const sealedParts = slices.map((slice, index) => sealJson(sliceEnvelope(file.sha256, index, slices.length, slice)));
      for (const part of sealedParts) {
        assert.ok(part.length <= SERVER_PAYLOAD_LIMIT);
        assert.equal(part.includes("Sekretna"), false);
      }
      const opened = sealedParts.map(
        (part) => openJson(JSON.parse(part)) as { slice: number; slices: number; base64: string },
      );
      return { sha256: file.sha256, base64: joinSliceText(opened) };
    });
    const attached = attachManifestParts(manifest, bins);
    assert.equal(attached.ok, true);
    if (!attached.ok) return;
    const store = new Map<string, Buffer>();
    const restored = await recoverBackup({
      phrase: "PRZYWRÓĆ",
      expectedRevision: 4,
      raw: attached.payload,
      readCurrent: async () => null,
      revisionHint: async () => 0,
      snapshot: async () => undefined,
      legacyFiles: async () => null,
      putImage: async (file) => {
        const url = `mem://${file.sha256}`;
        store.set(url, Buffer.from(file.base64, "base64"));
        return url;
      },
      writeDoc: async (next, check) => {
        await check(next);
        store.set("doc", Buffer.from(JSON.stringify(next)));
        return 8;
      },
      readBack: async () => JSON.parse(store.get("doc")?.toString("utf8") || "{}") as BackupDoc,
      readImage: async (url) => store.get(url) ?? null,
    });
    assert.equal(restored.ok, true);
    assert.equal(store.get("mem://" + published.sha256)?.equals(image), true);
    assert.equal(store.get("mem://" + draft.sha256)?.equals(draftImage), true);
    assert.equal(attachManifestParts(manifest, bins.slice(0, 1)).ok, false);
    let wrote = false;
    const missed = await recoverBackup({
      phrase: "PRZYWRÓĆ",
      expectedRevision: 4,
      raw: manifest,
      readCurrent: async () => null,
      revisionHint: async () => 0,
      snapshot: async () => undefined,
      legacyFiles: async () => null,
      putImage: async () => "mem://no",
      writeDoc: async () => {
        wrote = true;
        return 1;
      },
      readBack: async () => doc,
      readImage: async () => image,
    });
    assert.equal(missed.ok, false);
    assert.equal(wrote, false);
  } finally {
    if (previous === undefined) delete process.env.CMS_SEAL_KEY;
    else process.env.CMS_SEAL_KEY = previous;
  }
});

function hexSha(char: string) {
  return char.repeat(64);
}

test("chroniona stara kopia zatrzymuje manifest i części zdjęć", () => {
  const manifests = Array.from({ length: 20 }, (_, index) => ({
    pathname: `zielarka/backups/manual/new-${index}.json`,
    url: `https://blob.vercel-storage.com/new-${index}`,
    uploadedAt: 1_000_000 + index,
    shas: [hexSha("b")],
  }));
  const oldSha = hexSha("a");
  const doomedSha = hexSha("c");
  const sharedSha = hexSha("d");
  manifests.push(
    {
      pathname: "zielarka/backups/manual/old.json",
      url: "https://blob.vercel-storage.com/old",
      uploadedAt: 10,
      shas: [oldSha, sharedSha],
    },
    {
      pathname: "zielarka/backups/manual/doomed.json",
      url: "https://blob.vercel-storage.com/doomed",
      uploadedAt: 20,
      shas: [doomedSha, sharedSha],
    },
  );
  const parts = [
    { url: "https://blob.vercel-storage.com/part-old", downloadUrl: "https://blob.vercel-storage.com/part-old-dl", sha256: oldSha },
    { url: "https://blob.vercel-storage.com/part-doomed", downloadUrl: "https://blob.vercel-storage.com/part-doomed-dl", sha256: doomedSha },
    { url: "https://blob.vercel-storage.com/part-shared", sha256: sharedSha },
    { url: "https://blob.vercel-storage.com/part-new", sha256: hexSha("b") },
  ];
  const bare = planBackupRetention({ manifests, parts, protectPathnames: [] });
  assert.equal(bare.deleteUrls.includes("https://blob.vercel-storage.com/old"), true);
  assert.equal(bare.deleteUrls.includes("https://blob.vercel-storage.com/part-old"), true);
  const plan = planBackupRetention({
    manifests,
    parts,
    protectPathnames: ["zielarka/backups/manual/old.json"],
  });
  assert.equal(plan.deleteUrls.includes("https://blob.vercel-storage.com/old"), false);
  assert.equal(plan.deleteUrls.includes("https://blob.vercel-storage.com/part-old"), false);
  assert.equal(plan.deleteUrls.includes("https://blob.vercel-storage.com/part-old-dl"), false);
  assert.equal(plan.deleteUrls.includes("https://blob.vercel-storage.com/part-shared"), false);
  assert.equal(plan.deleteUrls.includes("https://blob.vercel-storage.com/part-new"), false);
  assert.equal(plan.deleteUrls.includes("https://blob.vercel-storage.com/doomed"), true);
  assert.equal(plan.deleteUrls.includes("https://blob.vercel-storage.com/part-doomed"), true);
  assert.equal(plan.deleteUrls.includes("https://blob.vercel-storage.com/part-doomed-dl"), true);
  assert.throws(
    () => planBackupRetention({ manifests, parts, protectPathnames: ["zielarka/backups/manual/brak.json"] }),
    /Nic nie zostało skasowane/,
  );
  const broken = manifests.map((item) => (item.pathname.endsWith("old.json") ? { ...item, shas: ["nie-sha"] } : item));
  assert.throws(
    () => planBackupRetention({ manifests: broken, parts, protectPathnames: ["zielarka/backups/manual/old.json"] }),
    /Przycinanie zostało zatrzymane/,
  );
});

test("potwierdzona kopia odtwarza szkic, SEO i czcionki", () => {
  const doc = docWith("https://cdn.example/a.png", "seal:draft");
  doc.copy["seo.title"] = "Mięta pieprzowa";
  doc.theme = { display: "Source Serif 4" };
  doc.styles = { h1: { font: "Source Serif 4", size: "2rem" } };
  doc.entries[0] = { ...doc.entries[0], description: "Opis do Google" };
  const draftBytes = Buffer.from(PNG);
  draftBytes[draftBytes.length - 1] ^= 0xff;
  const files = plannedRefs(doc).map((plan) => {
    const file = fileFromBytes(plan.ref, plan.use, plan.use === "draft" ? draftBytes : PNG);
    assert.ok(file);
    return file;
  });
  const payload = buildPayload("sprawdzenie", "2026-10-25T00:00:00.000Z", doc, files);
  const manifest = toManifest(payload);
  const bins = manifest.files.map((file) => {
    const source = files.find((item) => item.sha256 === file.sha256 && item.ref === file.ref);
    assert.ok(source);
    return { sha256: file.sha256, base64: source.base64 };
  });
  const confirmed = confirmBackupRoundtrip(payload, manifest, bins);
  assert.equal(confirmed.ok, true);
  if (!confirmed.ok) return;
  assert.equal(confirmed.payload.doc.entries.find((entry) => entry.slug === "szkic")?.status, "draft");
  assert.equal(confirmed.payload.doc.entries.find((entry) => entry.slug === "mieta")?.status, "published");
  assert.equal(confirmed.payload.doc.copy["seo.title"], "Mięta pieprzowa");
  assert.equal((confirmed.payload.doc.theme as { display?: string }).display, "Source Serif 4");
  assert.equal(confirmBackupRoundtrip(payload, manifest, bins.slice(0, 1)).ok, false);
  const flipped = bins.map((bin, index) => (index === 0 ? { ...bin, base64: Buffer.from("nieobraz").toString("base64") } : bin));
  assert.equal(confirmBackupRoundtrip(payload, manifest, flipped).ok, false);
  const duplicated = { ...manifest, files: manifest.files[0] ? [...manifest.files, manifest.files[0]] : manifest.files };
  assert.equal(confirmBackupRoundtrip(payload, duplicated, bins).ok, false);
});

test("powtórzona albo brakująca część nie składa zdjęcia", () => {
  const raw = Buffer.from("aaabbb");
  const parts = [
    { slice: 0, slices: 2, base64: raw.subarray(0, 3).toString("base64") },
    { slice: 1, slices: 2, base64: raw.subarray(3, 6).toString("base64") },
  ];
  assert.equal(Buffer.from(joinSliceText([parts[1]!, parts[0]!]), "base64").equals(raw), true);
  assert.throws(() => joinSliceText([parts[0]!, { ...parts[0]! }]), /powtórzona część/);
  assert.throws(() => joinSliceText([parts[0]!]), /brakuje części/);
});

test("wysyłka poza Blob pozostaje wyłączona", () => {
  assert.equal(OFFSITE_AUTOMATIC, false);
  const named = offsiteDecision("https://example.r2.cloudflarestorage.com/kopie");
  assert.equal(named.sent, false);
  assert.equal(named.automatic, false);
  assert.match(named.reason, /Nic nie zostało wysłane/);
  assert.equal(offsiteDecision("").sent, false);
  assert.equal(imageGoesToPrivateStore("draft"), true);
  assert.equal(imageGoesToPrivateStore("public"), false);
});
