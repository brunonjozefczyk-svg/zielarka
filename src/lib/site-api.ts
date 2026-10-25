import { createServerFn } from "@tanstack/react-start";

export type SiteEdits = {
  copy: Record<string, string>;
  images: Record<string, string>;
  herbs: Record<string, unknown>;
};

const empty = (): SiteEdits => ({ copy: {}, images: {}, herbs: {} });

export const loadSiteEdits = createServerFn({ method: "GET" }).handler(async () => {
  const { readEdits } = await import("./site-store.server");
  return readEdits();
});

export const checkEditorPassword = createServerFn({ method: "POST" })
  .validator((data: { password: string }) => ({ password: data.password ?? "" }))
  .handler(async ({ data }) => {
    const { passwordOk } = await import("./site-store.server");
    return { ok: passwordOk(data.password) };
  });

export const saveSiteCopyFn = createServerFn({ method: "POST" })
  .validator((data: { password: string; id: string; value: string }) => {
    const id = data.id?.trim() ?? "";
    const value = data.value ?? "";
    if (!id || id.length > 120 || value.length > 20000) {
      throw new Error("Za długi tekst.");
    }
    return { password: data.password ?? "", id, value };
  })
  .handler(async ({ data }) => {
    const { passwordOk, saveCopy } = await import("./site-store.server");
    if (!passwordOk(data.password)) return { ok: false as const };
    await saveCopy(data.id, data.value);
    return { ok: true as const };
  });

export const saveSiteImageFn = createServerFn({ method: "POST" })
  .validator((data: { password: string; id: string; dataUrl: string }) => {
    const id = data.id?.trim() ?? "";
    const dataUrl = data.dataUrl ?? "";
    if (!id || id.length > 120 || dataUrl.length > 3_400_000) {
      throw new Error("Zdjęcie jest za duże.");
    }
    return { password: data.password ?? "", id, dataUrl };
  })
  .handler(async ({ data }) => {
    const { passwordOk, saveImage } = await import("./site-store.server");
    if (!passwordOk(data.password)) return { ok: false as const, url: "" };
    const url = await saveImage(data.id, data.dataUrl);
    return { ok: true as const, url };
  });

export const saveHerbFn = createServerFn({ method: "POST" })
  .validator((data: { password: string; slug: string; copy: unknown }) => {
    const slug = data.slug?.trim() ?? "";
    const raw = JSON.stringify(data.copy ?? {});
    if (!slug || slug.length > 80 || raw.length > 80000) {
      throw new Error("Opis jest za długi.");
    }
    return { password: data.password ?? "", slug, copy: data.copy };
  })
  .handler(async ({ data }) => {
    const { passwordOk, saveHerb } = await import("./site-store.server");
    if (!passwordOk(data.password)) return { ok: false as const };
    await saveHerb(data.slug, data.copy);
    return { ok: true as const };
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
