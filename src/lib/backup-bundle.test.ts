import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  buildPayload,
  dropProtected,
  fileFromBytes,
  isBlankDoc,
  plannedRefs,
  recoverBackup,
  restoreGate,
  verifyPayload,
  type BackupDoc,
  type BackupFile,
} from "./backup-bundle.ts";
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
