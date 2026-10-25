import { useEffect, useState } from "react";

const COPY_KEY = "zielarka.site-copy.v3";
const MODE_KEY = "zielarka.edit-mode";
const EVENT = "zielarka-site-editor";
const DB_NAME = "zielarka-editor-v2";
const STORE = "images";

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

export function saveCopy(id: string, value: string) {
  const all = readCopy();
  all[id] = value;
  localStorage.setItem(COPY_KEY, JSON.stringify(all));
  emit();
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
  const [value, setValue] = useState(fallback);
  useEffect(() => {
    const apply = () => setValue(getCopy(id, fallback));
    apply();
    window.addEventListener(EVENT, apply);
    return () => window.removeEventListener(EVENT, apply);
  }, [id, fallback]);
  return value;
}

export function useLiveImage(id: string, fallback: string) {
  const [src, setSrc] = useState(fallback);
  useEffect(() => {
    let live = true;
    const apply = () => {
      getImage(id)
        .then((stored) => {
          if (live) setSrc(stored || fallback);
        })
        .catch(() => {
          if (live) setSrc(fallback);
        });
    };
    apply();
    window.addEventListener(EVENT, apply);
    return () => {
      live = false;
      window.removeEventListener(EVENT, apply);
    };
  }, [id, fallback]);
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