import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import {
  CONSENT_STORAGE_KEY,
  claimPageView,
  consentFromChoice,
  eventFromClick,
  pageViewKey,
  readStoredConsent,
  sanitizeEvent,
  trackOnThisPage,
  type ConsentChoice,
} from "@/lib/analytics";

type Gtag = (...args: unknown[]) => void;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
  }
}

const pageState = { key: "", at: 0 };

function installGtag(measurementId: string, choice: ConsentChoice) {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer ?? [];
  if (!window.gtag) {
    window.gtag = (...args: unknown[]) => {
      window.dataLayer?.push(args);
    };
    window.gtag("consent", "default", {
      ...consentFromChoice("denied"),
      wait_for_update: 500,
    });
    window.gtag("js", new Date());
    window.gtag("config", measurementId, { send_page_view: false });
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    document.head.appendChild(script);
  }
  window.gtag("consent", "update", consentFromChoice(choice));
}

function remember(choice: ConsentChoice) {
  localStorage.setItem(CONSENT_STORAGE_KEY, choice);
}

export function AnalyticsConsent({ measurementId }: { measurementId: string }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const searchStr = useRouterState({ select: (state) => state.location.searchStr });
  const [ready, setReady] = useState(false);
  const [choice, setChoice] = useState<ConsentChoice | "unknown">("unknown");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const stored = readStoredConsent(localStorage);
    setChoice(stored);
    setOpen(stored === "unknown");
    if (stored === "granted") installGtag(measurementId, "granted");
    setReady(true);
  }, [measurementId]);

  useEffect(() => {
    if (choice !== "granted" || !trackOnThisPage(pathname)) return;
    const key = pageViewKey(pathname, searchStr);
    if (claimPageView(key, Date.now(), pageState)) {
      window.gtag?.("event", "page_view", {
        page_path: pathname,
        page_title: document.title.slice(0, 120),
      });
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
      const clean = sanitizeEvent(name, { page_path: window.location.pathname, link_url: href });
      if (clean) window.gtag?.("event", clean.name, clean.params);
    }
    document.addEventListener("click", onClick);
    function onSubmit(event: Event) {
      if (event.defaultPrevented || !trackOnThisPage(window.location.pathname)) return;
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !form.querySelector("[data-track='form_start']")) return;
      const clean = sanitizeEvent("form_start", { page_path: window.location.pathname });
      if (clean) window.gtag?.("event", clean.name, clean.params);
    }
    document.addEventListener("submit", onSubmit);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("submit", onSubmit);
    };
  }, [choice]);

  function choose(next: ConsentChoice) {
    remember(next);
    setChoice(next);
    setOpen(false);
    if (next === "granted") installGtag(measurementId, "granted");
    else window.gtag?.("consent", "update", consentFromChoice("denied"));
  }

  if (!ready) return null;

  return (
    <>
      {open ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper px-4 py-4 shadow-[0_-8px_24px_rgba(26,24,20,0.08)]">
          <div className="mx-auto flex max-w-3xl flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <p className="max-w-xl text-sm leading-relaxed text-ink">
              Czy mogę mierzyć, które strony są czytane? Bez zgody nie włączam Google Analytics. Nie
              wysyłam treści wiadomości, adresu e-mail ani informacji o zdrowiu.
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
