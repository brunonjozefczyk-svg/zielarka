import { useEffect, useRef, useState } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import {
  CONSENT_STORAGE_KEY,
  claimPageView,
  eventFromClick,
  pageViewKey,
  readStoredConsent,
  trackOnThisPage,
  type ConsentChoice,
} from "@/lib/analytics";
import { installMeasurement, stopMeasurement, sendPageView, sendEvent } from "@/lib/analytics-browser";

export function AnalyticsConsent({ measurementId }: { measurementId: string }) {
  const router = useRouter();
  const pageState = useRef({ key: "", at: 0 });
  const currentChoice = useRef<ConsentChoice | "unknown">("unknown");
  const failedOptOut = useRef(false);
  const [storageError, setStorageError] = useState("");
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const searchStr = useRouterState({ select: (state) => state.location.searchStr });
  const [ready, setReady] = useState(false);
  const [choice, setChoice] = useState<ConsentChoice | "unknown">("unknown");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let stored: ConsentChoice | "unknown" = "unknown";
    try { stored = readStoredConsent(window.localStorage); } catch { /* default off */ }
    currentChoice.current = stored;
    setChoice(stored);
    setOpen(stored === "unknown");
    if (stored === "granted") installMeasurement(measurementId);
    setReady(true);
  }, [measurementId]);

  useEffect(() => {
    function sync() {
      if (failedOptOut.current) return;
      let next: ConsentChoice | "unknown" = "unknown";
      try { next = readStoredConsent(window.localStorage); } catch { /* fail closed */ }
      if (currentChoice.current === "granted" && next !== "granted") {
        currentChoice.current = next;
        stopMeasurement(measurementId);
        window.location.reload();
      } else if (next !== currentChoice.current) window.location.reload();
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === CONSENT_STORAGE_KEY || event.key === null) sync();
    };
    const onVisible = () => { if (document.visibilityState === "visible") sync(); };
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    const unsubscribe = router.subscribe("onBeforeNavigate", ({ toLocation }) => {
      if (currentChoice.current === "granted" && !trackOnThisPage(toLocation.pathname)) {
        stopMeasurement(measurementId);
        window.location.assign(toLocation.href);
      }
    });
    return () => {
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
      unsubscribe();
    };
  }, [measurementId, router]);

  useEffect(() => {
    if (choice !== "granted" || !trackOnThisPage(pathname)) return;
    const key = pageViewKey(pathname, searchStr);
    if (claimPageView(key, Date.now(), pageState.current)) {
      sendPageView(pathname);
    }
  }, [choice, pathname, searchStr]);

  useEffect(() => {
    if (choice !== "granted") return;
    function onClick(event: MouseEvent) {
      if (!trackOnThisPage(window.location.pathname)) return;
      const element = event.target instanceof Element ? event.target : null;
      if (!element) return;
      if (element.closest("[data-track='form_start']")) return;
      const anchor = element.closest("a");
      const href = anchor?.getAttribute("href") ?? "";
      const name = eventFromClick(href);
      if (!name) return;
      sendEvent(name, window.location.pathname, href);
    }
    document.addEventListener("click", onClick);
    function onSubmit(event: Event) {
      if (event.defaultPrevented || !trackOnThisPage(window.location.pathname)) return;
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !form.querySelector("[data-track='form_start']")) return;
      sendEvent("form_start", window.location.pathname);
    }
    document.addEventListener("submit", onSubmit);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("submit", onSubmit);
    };
  }, [choice]);

  function choose(next: ConsentChoice) {
    // Persistence is required before opt-in, but a storage failure must never prevent opt-out.
    let saved = true;
    try { localStorage.setItem(CONSENT_STORAGE_KEY, next); } catch { saved = false; }
    if (!saved && next === "granted") {
      setStorageError("Nie udało się zapisać zgody. Analityka pozostaje wyłączona. Sprawdź ustawienia pamięci przeglądarki.");
      return;
    }
    const wasGranted = currentChoice.current === "granted";
    currentChoice.current = next;
    setChoice(next);
    setOpen(false);
    if (saved) setStorageError("");
    if (next === "granted") installMeasurement(measurementId);
    else if (wasGranted) {
      stopMeasurement(measurementId);
      // Stay disabled on this page if persistence failed; do not reload an old grant.
      if (saved) window.location.reload();
      else {
        failedOptOut.current = true;
        setStorageError("Pomiar jest zatrzymany na tej stronie, ale odmowa nie została zapisana. Po pełnym odświeżeniu może wrócić wcześniejsza zgoda.");
      }
    }
  }

  if (!ready || !trackOnThisPage(pathname)) return null;

  return (
    <>
      {storageError ? <p role="alert" className="fixed bottom-24 inset-x-4 z-50 bg-paper p-4">{storageError}</p> : null}
      {open ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper px-4 py-4 shadow-[0_-8px_24px_rgba(26,24,20,0.08)]">
          <div className="mx-auto flex max-w-3xl flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <p className="max-w-xl text-sm leading-relaxed text-ink">
              Czy mogę mierzyć, które strony są czytane? Bez zgody nie włączam Google Analytics. Nie
              wysyłam treści wiadomości, adresu e-mail ani informacji o zdrowiu.{" "}
              <a href="/polityka-prywatnosci" className="underline">Polityka prywatności</a>.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="min-h-11 rounded-md border border-forest px-4 text-sm text-forest"
                onClick={() => choose("denied")}
              >
                Odrzucam
              </button>
              <button
                type="button"
                className="min-h-11 rounded-md bg-forest px-4 text-sm text-cream"
                onClick={() => choose("granted")}
              >
                Akceptuję
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="fixed bottom-4 right-4 z-40 min-h-11 rounded-md border border-line bg-cream px-3 text-xs text-forest"
          onClick={() => setOpen(true)}
        >
          Zmień zgodę na analitykę
        </button>
      )}
    </>
  );
}
