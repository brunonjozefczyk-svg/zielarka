import { useEffect, useState } from "react";
import { useEdits } from "./edits-context";

const COPY_KEY = "zielarka.site-copy.v3";
const MODE_KEY = "zielarka.edit-mode";
const EVENT = "zielarka-site-editor";
const DB_NAME = "zielarka-editor-v2";
const STORE = "images";
const PASS_KEY = "zielarka.editor-pass";

let revision = 0;

export function setEditorRevision(next: number) {
  if (Number.isInteger(next) && next >= 0) revision = next;
}

export function editorRevision() {
  return revision;
}

function emit() {
  window.dispatchEvent(new Event(EVENT));
}

export function readCopy(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(COPY_KEY) || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export function readEditorPassword() {
  if (typeof sessionStorage === "undefined") return "";
  return sessionStorage.getItem(PASS_KEY) || "";
}

export function writeEditorPassword(password: string) {
  sessionStorage.setItem(PASS_KEY, password);
}

export function clearEditorPassword() {
  sessionStorage.removeItem(PASS_KEY);
  writeEditMode(false);
}

export async function saveCopy(id: string, value: string) {
  const all = readCopy();
  all[id] = value;
  localStorage.setItem(COPY_KEY, JSON.stringify(all));
  emit();
  const password = readEditorPassword();
  if (!password) throw new Error("brak hasła");
  const { saveSiteCopyFn } = await import("./site-api");
  const result = await saveSiteCopyFn({
    data: { password, id, value, revision: editorRevision() },
  });
  if (!result.ok) throw new Error(result.message || "odmowa");
  setEditorRevision(result.revision);
}

export function getCopy(id: string, fallback: string) {
  return readCopy()[id] ?? fallback;
}

export function readEditMode() {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(MODE_KEY) === "1";
}

export function writeEditMode(on: boolean) {
  sessionStorage.setItem(MODE_KEY, on ? "1" : "");
  emit();
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getImage(id: string): Promise<string | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
    req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveImage(id: string, dataUrl: string) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const req = db.transaction(STORE, "readwrite").objectStore(STORE).put(dataUrl, id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
  emit();
  const password = readEditorPassword();
  if (!password) throw new Error("brak hasła");
  const { saveSiteImageFn } = await import("./site-api");
  const result = await saveSiteImageFn({
    data: { password, id, dataUrl, revision: editorRevision() },
  });
  if (!result.ok) throw new Error(result.message || "odmowa");
  setEditorRevision(result.revision);
  if (result.url) {
    await new Promise<void>((resolve, reject) => {
      const req = db.transaction(STORE, "readwrite").objectStore(STORE).put(result.url, id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    emit();
  }
}

export function adoptServerCopy(copy: Record<string, string>) {
  if (typeof window === "undefined") return;
  localStorage.setItem(COPY_KEY, JSON.stringify(copy));
  emit();
}

export function applyRemoteCopy(copy: Record<string, string>) {
  adoptServerCopy(copy);
}

export async function applyRemoteImages(images: Record<string, string>) {
  if (typeof indexedDB === "undefined") return;
  const entries = Object.entries(images).filter(([, url]) => url.startsWith("https://"));
  if (!entries.length) return;
  const db = await openDb();
  await Promise.all(
    entries.map(
      ([id, url]) =>
        new Promise<void>((resolve, reject) => {
          const req = db.transaction(STORE, "readwrite").objectStore(STORE).put(url, id);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        }),
    ),
  );
  emit();
}

export function resizeImageFile(file: File, max = 1600): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let w = img.width;
      let h = img.height;
      if (w > max || h > max) {
        const r = Math.min(max / w, max / h);
        w = Math.round(w * r);
        h = Math.round(h * r);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("canvas"));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.84));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image"));
    };
    img.src = url;
  });
}

export function useCopy(id: string, fallback: string) {
  const remote = useEdits().copy[id];
  const initial = remote ?? fallback;
  const [value, setValue] = useState(initial);
  useEffect(() => {
    const apply = () => {
      if (!readEditMode()) {
        setValue(remote ?? fallback);
        return;
      }
      const stored = readCopy();
      if (Object.prototype.hasOwnProperty.call(stored, id)) setValue(stored[id]);
      else setValue(remote ?? fallback);
    };
    apply();
    window.addEventListener(EVENT, apply);
    return () => window.removeEventListener(EVENT, apply);
  }, [id, fallback, remote]);
  return value;
}

export function useLiveImage(id: string, fallback: string) {
  const remote = useEdits().images[id];
  const initial = remote || fallback;
  const [src, setSrc] = useState(initial);
  useEffect(() => {
    let live = true;
    const apply = () => {
      if (!readEditMode()) {
        if (live) setSrc(remote || fallback);
        return;
      }
      getImage(id)
        .then((stored) => {
          if (live) setSrc(stored || remote || fallback);
        })
        .catch(() => {
          if (live) setSrc(remote || fallback);
        });
    };
    apply();
    window.addEventListener(EVENT, apply);
    return () => {
      live = false;
      window.removeEventListener(EVENT, apply);
    };
  }, [id, fallback, remote]);
  return src;
}

export function useEditMode() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const apply = () => setOn(readEditMode());
    apply();
    window.addEventListener(EVENT, apply);
    return () => window.removeEventListener(EVENT, apply);
  }, []);
  return {
    editing: on,
    setEditing: (next: boolean) => writeEditMode(next),
  };
}