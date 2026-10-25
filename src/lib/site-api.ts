import { createServerFn } from "@tanstack/react-start";

export type SiteEdits = {
  copy: Record<string, string>;
  images: Record<string, string>;
  herbs: Record<string, unknown>;
};

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
