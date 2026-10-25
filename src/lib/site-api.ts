import { createServerFn } from "@tanstack/react-start";
import { herbOutageAction } from "./cms-guard";
import type { ManagedEntry } from "./entries";
import type { HerbCopy } from "./herb-editor";
import type { TextStyle, ThemeSettings } from "./theme";

export type SiteEdits = {
  revision: number;
  copy: Record<string, string>;
  images: Record<string, string>;
  herbs: Record<string, HerbCopy>;
  entries: ManagedEntry[];
  theme: ThemeSettings | null;
  styles: Record<string, TextStyle>;
};

const empty = (): SiteEdits => ({
  revision: 0,
  copy: {},
  images: {},
  herbs: {},
  entries: [],
  theme: null,
  styles: {},
});

async function gate(password: string) {
  const { editorGate } = await import("./site-store.server");
  const { editorClientKey } = await import("./client-key.server");
  return editorGate(password, editorClientKey());
}

export const loadSiteEdits = createServerFn({ method: "GET" }).handler(async () => {
  const { readPublicEdits } = await import("./site-store.server");
  const doc = await readPublicEdits();
  return {
    revision: doc.revision,
    copy: doc.copy,
    images: doc.images,
    herbs: doc.herbs as Record<string, HerbCopy>,
    entries: doc.entries,
    theme: doc.theme,
    styles: doc.styles,
  };
});

export const loadHerbPage = createServerFn({ method: "GET" })
  .validator((data: { slug: string }) => ({ slug: (data?.slug ?? "").trim().slice(0, 80) }))
  .handler(async ({ data }) => {
    const { readPublicEdits } = await import("./site-store.server");
    const { entryToHerb } = await import("./entries");
    const { getHerb, herbs } = await import("./herbs");
    let edits;
    try {
      edits = await readPublicEdits();
    } catch {
      if (herbOutageAction(Boolean(getHerb(data.slug))) === "unavailable") {
        throw new Error("Magazyn treści jest chwilowo niedostępny.");
      }
      const builtin = getHerb(data.slug);
      if (!builtin) throw new Error("Magazyn treści jest chwilowo niedostępny.");
      const related = builtin.related
        .map((slug) => herbs.find((item) => item.slug === slug))
        .filter((item): item is NonNullable<typeof item> => Boolean(item));
      return { herb: builtin, related };
    }
    const builtin = getHerb(data.slug);
    let herb = builtin;
    if (builtin) {
      let next = builtin;
      const over = edits.herbs[data.slug];
      if (over && typeof over === "object") next = { ...builtin, ...(over as Partial<typeof builtin>) };
      const image = edits.images[`img.herb.${data.slug}`];
      if (image) next = { ...next, image };
      herb = next;
    } else {
      const entry = edits.entries.find((item) => item.slug === data.slug);
      herb = entry ? entryToHerb(entry) : undefined;
    }
    if (!herb) return null;
    const pool = [...herbs, ...edits.entries.map(entryToHerb)];
    const related = herb.related
      .map((slug) => pool.find((item) => item.slug === slug))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    return { herb, related };
  });

export const loadSitemapXml = createServerFn({ method: "GET" }).handler(async () => {
  const { readPublicEdits } = await import("./site-store.server");
  const { herbs } = await import("./herbs");
  const { sitemapXml } = await import("./sitemap");
  const edits = await readPublicEdits();
  return sitemapXml({
    herbs: herbs.map((herb) => herb.slug),
    entries: edits.entries.map((entry) => ({ slug: entry.slug, updatedAt: entry.updatedAt })),
  });
});

export const checkEditorPassword = createServerFn({ method: "POST" })
  .validator((data: { password: string }) => ({ password: data.password ?? "" }))
  .handler(async ({ data }) => {
    const result = await gate(data.password);
    if (!result.ok) return { ok: false as const, message: result.message };
    return { ok: true as const, message: "" };
  });

export const saveSiteCopyFn = createServerFn({ method: "POST" })
  .validator((data: { password: string; id: string; value: string; revision: number; style?: unknown }) => {
    const id = data.id?.trim() ?? "";
    const value = data.value ?? "";
    if (!id || id.length > 120 || value.length > 20000) {
      throw new Error("Za długi tekst.");
    }
    return {
      password: data.password ?? "",
      id,
      value,
      revision: Number(data.revision),
      style: data.style,
    };
  })
  .handler(async ({ data }) => {
    const result = await gate(data.password);
    if (!result.ok) return { ok: false as const, revision: data.revision, message: result.message };
    const { saveCopy } = await import("./site-store.server");
    const revision = await saveCopy(data.id, data.value, data.revision, data.style);
    return { ok: true as const, revision, message: "" };
  });

export const saveSiteImageFn = createServerFn({ method: "POST" })
  .validator((data: { password: string; id: string; dataUrl: string; revision: number }) => {
    const id = data.id?.trim() ?? "";
    const dataUrl = data.dataUrl ?? "";
    if (!id || id.length > 120 || dataUrl.length > 3_400_000) {
      throw new Error("Zdjęcie jest za duże.");
    }
    return { password: data.password ?? "", id, dataUrl, revision: Number(data.revision) };
  })
  .handler(async ({ data }) => {
    const result = await gate(data.password);
    if (!result.ok) return { ok: false as const, url: "", revision: data.revision, message: result.message };
    const { saveImage } = await import("./site-store.server");
    const saved = await saveImage(data.id, data.dataUrl, data.revision);
    return { ok: true as const, url: saved.url, revision: saved.revision, message: "" };
  });

export const saveHerbFn = createServerFn({ method: "POST" })
  .validator((data: { password: string; slug: string; copy: unknown; revision: number }) => {
    const slug = data.slug?.trim() ?? "";
    const raw = JSON.stringify(data.copy ?? {});
    if (!slug || slug.length > 80 || raw.length > 80000) {
      throw new Error("Opis jest za długi.");
    }
    return { password: data.password ?? "", slug, copy: data.copy, revision: Number(data.revision) };
  })
  .handler(async ({ data }) => {
    const result = await gate(data.password);
    if (!result.ok) return { ok: false as const, revision: data.revision, message: result.message };
    const { saveHerb } = await import("./site-store.server");
    const revision = await saveHerb(data.slug, data.copy, data.revision);
    return { ok: true as const, revision, message: "" };
  });

export const listEntriesFn = createServerFn({ method: "POST" })
  .validator((data: { password: string }) => ({ password: data.password ?? "" }))
  .handler(async ({ data }) => {
    const result = await gate(data.password);
    if (!result.ok) return { ok: false as const, entries: [], revision: 0, message: result.message };
    const { readEditorDoc } = await import("./site-store.server");
    const doc = await readEditorDoc();
    return { ok: true as const, entries: doc.entries, revision: doc.revision, message: "" };
  });

export const saveEntryFn = createServerFn({ method: "POST" })
  .validator((data: { password: string; previousSlug?: string; entry: unknown; revision: number }) => {
    const raw = JSON.stringify(data.entry ?? {});
    if (raw.length > 120_000) throw new Error("Opis jest za długi.");
    return {
      password: data.password ?? "",
      previousSlug: data.previousSlug?.trim() || "",
      entry: data.entry,
      revision: Number(data.revision),
    };
  })
  .handler(async ({ data }) => {
    const result = await gate(data.password);
    if (!result.ok) return { ok: false as const, entry: null, revision: data.revision, message: result.message };
    const { saveEntry } = await import("./site-store.server");
    const saved = await saveEntry(data.entry, data.previousSlug || undefined, data.revision);
    return { ok: true as const, entry: saved.entry, revision: saved.revision, message: "" };
  });

export const saveThemeFn = createServerFn({ method: "POST" })
  .validator((data: { password: string; theme: unknown; revision: number }) => ({
    password: data.password ?? "",
    theme: data.theme ?? null,
    revision: Number(data.revision),
  }))
  .handler(async ({ data }) => {
    const result = await gate(data.password);
    if (!result.ok) return { ok: false as const, revision: data.revision, message: result.message };
    const { saveTheme } = await import("./site-store.server");
    const revision = await saveTheme(data.theme, data.revision);
    return { ok: true as const, revision, message: "" };
  });

export const deleteEntryFn = createServerFn({ method: "POST" })
  .validator((data: { password: string; slug: string; revision: number }) => ({
    password: data.password ?? "",
    slug: data.slug?.trim() ?? "",
    revision: Number(data.revision),
  }))
  .handler(async ({ data }) => {
    const result = await gate(data.password);
    if (!result.ok) return { ok: false as const, revision: data.revision, message: result.message };
    const { deleteEntry } = await import("./site-store.server");
    const revision = await deleteEntry(data.slug, data.revision);
    return { ok: true as const, revision, message: "" };
  });

export const restoreEditsFn = createServerFn({ method: "POST" })
  .validator((data: { password: string; revision: number }) => ({
    password: data.password ?? "",
    revision: Number(data.revision),
  }))
  .handler(async ({ data }) => {
    const result = await gate(data.password);
    if (!result.ok) return { ok: false as const, revision: data.revision, message: result.message };
    const { restorePrevious } = await import("./site-store.server");
    const restored = await restorePrevious(data.revision);
    return { ok: true as const, revision: restored.revision, message: "" };
  });

export const backupStatusFn = createServerFn({ method: "POST" })
  .validator((data: { password: string }) => ({ password: data.password ?? "" }))
  .handler(async ({ data }) => {
    const result = await gate(data.password);
    if (!result.ok) return { ok: false as const, at: "", revision: 0, kind: "", rows: [], message: result.message };
    const { backupStatus, listBackupRows } = await import("./site-store.server");
    const status = await backupStatus();
    const rows = await listBackupRows();
    return { ok: true as const, at: status.at, revision: status.revision, kind: status.kind, rows, message: "" };
  });

export const createBackupFn = createServerFn({ method: "POST" })
  .validator((data: { password: string }) => ({ password: data.password ?? "" }))
  .handler(async ({ data }) => {
    const result = await gate(data.password);
    if (!result.ok) return { ok: false as const, at: "", revision: 0, message: result.message };
    const { createVerifiedBackup } = await import("./site-store.server");
    const saved = await createVerifiedBackup("manual");
    return { ok: true as const, at: saved.at, revision: saved.revision, message: "" };
  });

export const downloadBackupFn = createServerFn({ method: "POST" })
  .validator((data: { password: string }) => ({ password: data.password ?? "" }))
  .handler(async ({ data }) => {
    const result = await gate(data.password);
    if (!result.ok) return { ok: false as const, filename: "", body: "", message: result.message };
    const { downloadBackup } = await import("./site-store.server");
    const file = await downloadBackup();
    return { ok: true as const, filename: file.filename, body: file.body, message: "" };
  });

export const restoreBackupFn = createServerFn({ method: "POST" })
  .validator((data: { password: string; id: string; revision: number; phrase: string }) => ({
    password: data.password ?? "",
    id: data.id ?? "",
    revision: Number(data.revision),
    phrase: data.phrase ?? "",
  }))
  .handler(async ({ data }) => {
    const result = await gate(data.password);
    if (!result.ok) return { ok: false as const, revision: data.revision, message: result.message };
    const { restoreBackup } = await import("./site-store.server");
    const restored = await restoreBackup(data.id, data.revision, data.phrase);
    return { ok: true as const, revision: restored.revision, message: restored.message };
  });

export const restoreUploadFn = createServerFn({ method: "POST" })
  .validator((data: { password?: string; body?: string; revision?: number; phrase?: string }) => {
    const body = data.body ?? "";
    if (body.length > 4_000_000) throw new Error("Plik kopii jest za duży na jedno przesłanie.");
    return {
      password: data.password ?? "",
      body,
      revision: Number(data.revision),
      phrase: data.phrase ?? "",
    };
  })
  .handler(async ({ data }) => {
    const result = await gate(data.password);
    if (!result.ok) return { ok: false as const, revision: data.revision, message: result.message };
    const { restoreUploadedBackup } = await import("./site-store.server");
    const restored = await restoreUploadedBackup(data.body, data.revision, data.phrase);
    return { ok: true as const, revision: restored.revision, message: restored.message };
  });

export const cronBackup = async (authorization: string) => {
  const secret = process.env.CRON_SECRET?.trim() || "";
  if (!secret || authorization !== `Bearer ${secret}`) return { ok: false as const, status: 401 };
  const { runScheduledBackup } = await import("./site-store.server");
  const saved = await runScheduledBackup();
  return { ok: true as const, status: 200, at: saved.at };
};

const STAT_SECTIONS = new Set(["overview", "organic", "pages", "sources", "seo", "conversions", "page"]);
const STAT_RANGES = new Set(["today", "7", "30", "90", "custom"]);
const STAT_DEVICES = new Set(["", "desktop", "mobile", "tablet"]);

export const statsReportFn = createServerFn({ method: "POST" })
  .validator((data: {
    password?: string;
    section?: string;
    range?: string;
    start?: string;
    end?: string;
    page?: string;
    device?: string;
    country?: string;
  }) => ({
    password: data.password ?? "",
    section: STAT_SECTIONS.has(data.section ?? "") ? (data.section as "overview") : "overview",
    range: STAT_RANGES.has(data.range ?? "") ? (data.range as "30") : "30",
    start: (data.start ?? "").slice(0, 10),
    end: (data.end ?? "").slice(0, 10),
    page: (data.page ?? "").trim().slice(0, 180),
    device: STAT_DEVICES.has(data.device ?? "") ? (data.device ?? "") : "",
    country: (data.country ?? "").trim().toLowerCase().slice(0, 8),
  }))
  .handler(async ({ data }) => {
    const result = await gate(data.password);
    if (!result.ok) return { ok: false as const, report: null, message: result.message };
    const { loadStats } = await import("./analytics.server");
    const report = await loadStats({
      section: data.section,
      range: data.range,
      start: data.start,
      end: data.end,
      page: data.page,
      device: data.device,
      country: data.country,
    });
    return { ok: true as const, report, message: "" };
  });

export { empty };

const CONTACT_TOPICS = new Set(["konsultacja", "warsztat", "spacer", "klub", "inne"]);
const CONTACT_LABELS: Record<string, string> = {
  konsultacja: "Konsultacja 1:1",
  warsztat: "Warsztat",
  spacer: "Spacer zielarski",
  klub: "Klub Zielarski",
  inne: "Inne",
};

export const sendContactFn = createServerFn({ method: "POST" })
  .validator((data: { name: string; email: string; topic: string; message: string; company?: string }) => {
    const name = data.name?.trim() ?? "";
    const email = data.email?.trim() ?? "";
    const topic = data.topic?.trim() ?? "";
    const message = data.message?.trim() ?? "";
    const company = data.company?.trim() ?? "";
    if (company) return { name, email, topic, message, company, spam: true as const };
    if (name.length < 2 || name.length > 80) throw new Error("Podaj imię.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) {
      throw new Error("Podaj poprawny e-mail.");
    }
    if (!CONTACT_TOPICS.has(topic)) throw new Error("Wybierz temat.");
    if (message.length < 10 || message.length > 4000) {
      throw new Error("Wiadomość jest za krótka albo za długa.");
    }
    return { name, email, topic, message, company: "", spam: false as const };
  })
  .handler(async ({ data }) => {
    if (data.spam) return { ok: true as const };
    const response = await fetch("https://formsubmit.co/ajax/kontakt@zielarka.pl", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: "https://zielarka.pl",
        Referer: "https://zielarka.pl/kontakt",
      },
      body: JSON.stringify({
        name: data.name,
        email: data.email,
        _replyto: data.email,
        _subject: `Zielarka.pl — ${CONTACT_LABELS[data.topic]} — ${data.name}`,
        temat: CONTACT_LABELS[data.topic],
        message: data.message,
        _template: "table",
        _captcha: "false",
      }),
    });
    const body = (await response.json().catch(() => ({}))) as { success?: string; message?: string };
    if (String(body.success) !== "true") {
      const raw = body.message ?? "";
      const message = raw.includes("Activation")
        ? "Otwórz skrzynkę kontakt@zielarka.pl i kliknij link „Activate Form”. Potem wyślij wiadomość jeszcze raz."
        : raw || "Nie udało się wysłać.";
      return { ok: false as const, message };
    }
    return { ok: true as const };
  });
