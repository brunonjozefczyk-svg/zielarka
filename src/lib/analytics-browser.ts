import { consentFromChoice, sanitizeEvent, trackOnThisPage, type TrackEvent } from "./analytics";

type Gtag = (...args: unknown[]) => void;
declare global {
  interface Window { dataLayer?: unknown[]; gtag?: Gtag; }
}
let installedId = "";
let stopped = false;

export function cleanLocation(path: string) {
  return `https://zielarka.pl${trackOnThisPage(path) ? path : "/"}`;
}

export function setMeasurementDisabled(id: string, disabled: boolean) {
  (window as unknown as Record<string, unknown>)[`ga-disable-${id}`] = disabled;
}

export function installMeasurement(id: string) {
  if (!trackOnThisPage(window.location.pathname)) return;
  if (stopped) { window.location.reload(); return; }
  if (installedId === id) return;
  // Do not adopt a second, externally installed tracker with unknown settings.
  if (window.gtag || document.querySelector("script[src*='googletagmanager.com/gtag']")) return;
  setMeasurementDisabled(id, false);
  installedId = id;
  window.dataLayer = [];
  window.gtag = function () { window.dataLayer!.push(arguments); };
  window.gtag("consent", "default", consentFromChoice("denied"));
  window.gtag("consent", "update", consentFromChoice("granted"));
  window.gtag("set", { page_location: cleanLocation(window.location.pathname), page_referrer: "", page_title: "Zielarka.pl" });
  window.gtag("js", new Date());
  window.gtag("config", id, {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    page_location: cleanLocation(window.location.pathname),
    page_referrer: "",
    page_title: "Zielarka.pl",
  });
  const script = document.createElement("script");
  script.id = "zielarka-google-tag";
  script.async = true;
  script.referrerPolicy = "no-referrer";
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(script);
}

export function stopMeasurement(id: string) {
  stopped = true;
  // Stop hits before navigation/reload. Do not send a denied-consent ping.
  setMeasurementDisabled(id, true);
  document.getElementById("zielarka-google-tag")?.remove();
  window.gtag = () => {};
  window.dataLayer = [];
  const domains = ["", window.location.hostname, `.${window.location.hostname}`];
  if (window.location.hostname.endsWith(".zielarka.pl")) domains.push(".zielarka.pl");
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.split("=", 1)[0]?.trim() ?? "";
    if (!/^_ga(?:_|$)/.test(name)) continue;
    for (const domain of domains) document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax${domain ? `; Domain=${domain}` : ""}`;
  }
}

export function sendPageView(path: string) {
  if (!installedId || !trackOnThisPage(path)) return;
  const params = { page_location: cleanLocation(path), page_referrer: "", page_title: "Zielarka.pl" };
  window.gtag?.("set", params);
  window.gtag?.("event", "page_view", params);
}

export function sendEvent(name: TrackEvent, path: string, href = "") {
  if (!installedId || !trackOnThisPage(path)) return;
  const clean = sanitizeEvent(name, { page_path: path, link_url: href });
  if (clean) window.gtag?.("event", clean.name, {
    ...clean.params,
    page_location: cleanLocation(path), page_referrer: "", page_title: "Zielarka.pl",
  });
}
