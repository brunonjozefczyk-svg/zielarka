import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  CONVERSION_NOTE,
  ENGAGEMENT_NOTE,
  formatCount,
  formatDelta,
  formatDuration,
  formatPercent,
  type MetricRow,
  type PageStat,
  type RangeId,
  type SeriesPoint,
  type SourceStat,
  type StatsPayload,
} from "@/lib/analytics";
import { readEditorPassword } from "@/lib/site-editor";

const SECTIONS = [
  ["overview", "Przegląd"],
  ["organic", "Organiczne"],
  ["pages", "Podstrony"],
  ["sources", "Źródła"],
  ["seo", "SEO"],
  ["conversions", "Konwersje"],
] as const;

const RANGES = [
  ["today", "Dzisiaj"],
  ["7", "7 dni"],
  ["30", "30 dni"],
  ["90", "90 dni"],
  ["custom", "Własny"],
] as const;

type SectionId = (typeof SECTIONS)[number][0] | "page";

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-cream p-4">
      <p className="text-xs uppercase tracking-[0.14em] text-clay">{label}</p>
      <p className="mt-2 font-display text-3xl text-forest">{value}</p>
      {hint ? <p className="mt-2 text-xs leading-relaxed text-muted">{hint}</p> : null}
    </div>
  );
}

function Bars({ points, field, label }: { points: SeriesPoint[]; field: "users" | "sessions" | "views"; label: string }) {
  const known = points.map((point) => point[field]).filter((value): value is number => value !== null);
  if (!points.length) return <p className="text-sm text-muted">API nie zwróciło serii dla tego zakresu.</p>;
  if (!known.length) return <p className="text-sm text-muted">Seria nie zawiera liczb.</p>;
  const max = Math.max(1, ...known);
  const width = 640;
  const height = 150;
  const gap = points.length > 40 ? 1 : 3;
  const bar = (width - gap * (points.length - 1)) / points.length;
  return (
    <figure>
      <figcaption className="text-xs text-muted">{label}</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="mt-2 h-36 w-full">
        {points.map((point, index) => {
          const value = point[field];
          const barHeight = value === null ? 0 : (value / max) * (height - 8);
          return (
            <rect
              key={`${point.date}-${index}`}
              x={index * (bar + gap)}
              y={height - barHeight}
              width={Math.max(bar, 0.5)}
              height={barHeight}
              fill={value === null ? "transparent" : "#2A4A38"}
            >
              <title>{`${point.date}: ${value === null ? "brak" : formatCount(value)}`}</title>
            </rect>
          );
        })}
      </svg>
    </figure>
  );
}

function countHint(current: number | null, previous: number | null) {
  if (previous === null && current === null) return undefined;
  return formatDelta(current, previous);
}

export function StatsPanel() {
  const [section, setSection] = useState<SectionId>("overview");
  const [range, setRange] = useState<RangeId>("30");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [device, setDevice] = useState("");
  const [country, setCountry] = useState("");
  const [source, setSource] = useState("");
  const [page, setPage] = useState("");
  const [back, setBack] = useState<SectionId>("pages");
  const [report, setReport] = useState<StatsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const ticket = useRef(0);
  const statsToken = useRef("");

  async function load(next?: { section?: SectionId; page?: string }) {
    const password = readEditorPassword();
    if (!password) {
      setLoading(false);
      setReport(null);
      statsToken.current = "";
      toast.error("Wpisz hasło edytora.");
      return;
    }
    const asked = next?.section ?? section;
    const askedPage = next?.page ?? page;
    const id = ++ticket.current;
    setLoading(true);
    setReport(null);
    try {
      const { statsReportFn } = await import("@/lib/site-api");
      const result = await statsReportFn({
        data: {
          password,
          statsToken: statsToken.current,
          section: asked,
          range,
          start,
          end,
          page: askedPage,
          device,
          country,
        },
      });
      if (id !== ticket.current) return;
      if (!result.ok || !result.report) {
        setReport(null);
        toast.error(result.message || "Brak dostępu do statystyk.");
        return;
      }
      statsToken.current = result.statsToken;
      setReport(result.report);
    } catch {
      if (id === ticket.current) { setReport(null); toast.error("Nie udało się pobrać raportu."); }
    } finally {
      if (id === ticket.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (range === "custom" && !/^\d{4}-\d{2}-\d{2}$/.test(start)) {
      setLoading(false);
      setReport(null);
      return;
    }
    void load();
    return () => {
      ticket.current += 1;
    };
  }, [section, range, device, page]);

  function openPage(path: string, from: SectionId) {
    setBack(from);
    setPage(path);
    setSection("page");
  }

  const visible = report && report.section === section ? report : null;
  const sources = (visible?.sources ?? []).filter((row) => !source || row.bucket === source);
  const buckets = [...new Set((visible?.sources ?? []).map((row) => row.bucket))];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <p className="text-xs uppercase tracking-[0.22em] text-clay">Statystyki</p>
      <h1 className="mt-2 font-display text-4xl text-forest">Ruch na Zielarka.pl</h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
        Liczby pochodzą z Google Analytics 4 i Search Console. Jeśli konto nie jest podłączone, nie
        pokazuję przykładowych wyników.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {SECTIONS.map(([id, label]) => (
          <Button key={id} type="button" variant={section === id ? "forest" : "outline"} onClick={() => setSection(id)}>
            {label}
          </Button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-2">
        {RANGES.map(([id, label]) => (
          <Button key={id} type="button" variant={range === id ? "forest" : "outline"} onClick={() => setRange(id)}>
            {label}
          </Button>
        ))}
        <label className="text-sm text-ink">
          Urządzenie
          <select
            value={device}
            onChange={(event) => setDevice(event.target.value)}
            className="mt-1 block min-h-11 rounded-md border border-line bg-paper px-3"
          >
            <option value="">Wszystkie</option>
            <option value="desktop">Komputer</option>
            <option value="mobile">Telefon</option>
            <option value="tablet">Tablet</option>
          </select>
        </label>
      </div>

      {range === "custom" ? (
        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void load();
          }}
        >
          <label className="text-sm text-ink">
            Od
            <input type="date" value={start} onChange={(event) => setStart(event.target.value)} className="mt-1 block min-h-11 rounded-md border border-line bg-paper px-3" />
          </label>
          <label className="text-sm text-ink">
            Do
            <input type="date" value={end} onChange={(event) => setEnd(event.target.value)} className="mt-1 block min-h-11 rounded-md border border-line bg-paper px-3" />
          </label>
          <Button type="submit">Pokaż zakres</Button>
        </form>
      ) : null}

      {loading ? <p className="mt-6 text-sm text-muted">Pobieram raport…</p> : null}
      {visible?.error ? <p className="mt-6 text-sm text-ink">{visible.error}</p> : null}

      {visible && !visible.configured ? (
        <section className="mt-6 rounded-lg border border-line bg-cream p-5">
          <h2 className="font-display text-3xl text-forest">Nie skonfigurowano</h2>
          {visible.note ? <p className="mt-2 text-sm text-muted">{visible.note}</p> : null}
          <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-relaxed text-ink">
            {visible.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>
      ) : null}

      {visible?.configured && !visible.measurementConfigured ? (
        <p className="mt-4 text-sm text-muted">
          Pomiar publiczny nie jest w pełni skonfigurowany lub zatwierdzony. Poniżej są
          tylko dane, które Google naprawdę zwróciło.
        </p>
      ) : null}
      {visible?.partial ? (
        <p className="mt-4 text-sm text-muted">Najnowsze dane mogą być niepełne. GA4 i Search Console aktualizują raporty z opóźnieniem.</p>
      ) : null}

      {visible?.configured && visible.realtime ? (
        <aside className="mt-6 rounded-lg border border-forest bg-paper p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-clay">Teraz</p>
          <p className="mt-2 font-display text-4xl text-forest">{formatCount(visible.realtime.activeUsers)}</p>
          <p className="mt-1 text-sm text-muted">
            Aktywni użytkownicy w tej chwili. Ta liczba nie wchodzi do wykresu ani do sum z wybranego zakresu.
          </p>
        </aside>
      ) : null}

      {visible?.configured && visible.totals ? (
        <Overview totals={visible.totals} previous={visible.previousTotals} series={visible.series} />
      ) : null}
      {visible?.configured && visible.organic ? <Organic report={visible} onOpen={(path) => openPage(path, "organic")} /> : null}
      {visible?.configured && visible.pages ? <Pages rows={visible.pages} onOpen={(path) => openPage(path, "pages")} /> : null}
      {visible?.configured && visible.sources ? (
        <Sources rows={sources} buckets={buckets} source={source} onSource={setSource} />
      ) : null}
      {visible?.configured && visible.seo ? (
        <Seo
          report={visible}
          country={country}
          onCountry={setCountry}
          onApply={() => void load()}
          onOpen={(path) => openPage(path, "seo")}
        />
      ) : null}
      {section === "conversions" ? <Conversions report={visible} /> : null}
      {visible?.configured && visible.page ? (
        <PageDetail
          report={visible}
          onBack={() => {
            setPage("");
            setSection(back === "page" ? "pages" : back);
          }}
        />
      ) : null}
      {visible?.note && visible.configured ? <p className="mt-6 text-xs leading-relaxed text-muted">{visible.note}</p> : null}
    </div>
  );
}

function Overview({
  totals,
  previous,
  series,
}: {
  totals: MetricRow;
  previous: MetricRow | null;
  series: SeriesPoint[] | null;
}) {
  return (
    <section className="mt-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Użytkownicy" value={formatCount(totals.users)} hint={countHint(totals.users, previous?.users ?? null)} />
        <Tile label="Nowi użytkownicy" value={formatCount(totals.newUsers)} hint={countHint(totals.newUsers, previous?.newUsers ?? null)} />
        <Tile label="Sesje" value={formatCount(totals.sessions)} hint={countHint(totals.sessions, previous?.sessions ?? null)} />
        <Tile label="Odsłony" value={formatCount(totals.views)} hint={countHint(totals.views, previous?.views ?? null)} />
        <Tile label="Sesje z zaangażowaniem" value={formatCount(totals.engagedSessions)} hint={countHint(totals.engagedSessions, previous?.engagedSessions ?? null)} />
        <Tile label="Średni czas zaangażowania" value={formatDuration(totals.engagementSeconds)} hint={ENGAGEMENT_NOTE} />
        <Tile label="Współczynnik zaangażowania" value={formatPercent(totals.engagementRate)} />
        <Tile label="Współczynnik odrzuceń" value={formatPercent(totals.bounceRate)} />
      </div>
      <div className="mt-6 rounded-lg border border-line bg-cream p-4">
        <Bars points={series ?? []} field="users" label="Użytkownicy w czasie (GA4, activeUsers)" />
      </div>
    </section>
  );
}

function Organic({ report, onOpen }: { report: StatsPayload; onOpen: (path: string) => void }) {
  const organic = report.organic;
  if (!organic) return null;
  return (
    <section className="mt-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label="Sesje organiczne" value={formatCount(organic.sessions)} hint={organic.note} />
        <Tile label="Użytkownicy organiczni" value={formatCount(organic.users)} />
        <Tile label="Udział sesji organicznych" value={formatPercent(organic.share)} hint="Sesje Organic Search podzielone przez wszystkie sesje GA4." />
      </div>
      <div className="mt-6 rounded-lg border border-line bg-cream p-4">
        <Bars points={organic.series} field="sessions" label="Sesje organiczne w czasie" />
      </div>
      <h2 className="mt-8 font-display text-2xl text-forest">Wyszukiwarki</h2>
      <ul className="mt-3 space-y-2 text-sm">
        {organic.engines.length ? (
          organic.engines.map((engine) => (
            <li key={engine.name} className="flex justify-between gap-4 border-b border-line py-2">
              <span>{engine.name}</span>
              <span>{formatCount(engine.sessions)} sesji</span>
            </li>
          ))
        ) : (
          <li className="text-muted">API nie zwróciło podziału na wyszukiwarki.</li>
        )}
      </ul>
      <Pages rows={organic.pages} onOpen={onOpen} title="Strony z ruchem organicznym" />
    </section>
  );
}

function Pages({ rows, onOpen, title = "Podstrony" }: { rows: PageStat[]; onOpen: (path: string) => void; title?: string }) {
  return (
    <section className="mt-6">
      <h2 className="font-display text-2xl text-forest">{title}</h2>
      {rows.length ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-[0.12em] text-clay">
                <th className="py-2 pr-3 font-medium">Adres</th>
                <th className="py-2 pr-3 font-medium">Odsłony</th>
                <th className="py-2 pr-3 font-medium">Użytkownicy</th>
                <th className="py-2 pr-3 font-medium">Czas zaangażowania</th>
                <th className="py-2 font-medium">Odrzucenia</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.path} className="border-b border-line">
                  <td className="py-1 pr-3">
                    <button type="button" className="min-h-11 text-left text-forest underline" onClick={() => onOpen(row.path)}>
                      {row.path}
                    </button>
                  </td>
                  <td className="py-2 pr-3">{formatCount(row.views)}</td>
                  <td className="py-2 pr-3">{formatCount(row.users)}</td>
                  <td className="py-2 pr-3">{formatDuration(row.engagementSeconds)}</td>
                  <td className="py-2">{formatPercent(row.bounceRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">API nie zwróciło podstron w tym zakresie.</p>
      )}
      <p className="mt-3 text-xs leading-relaxed text-muted">{ENGAGEMENT_NOTE}</p>
    </section>
  );
}

function Sources({
  rows,
  buckets,
  source,
  onSource,
}: {
  rows: SourceStat[];
  buckets: string[];
  source: string;
  onSource: (value: string) => void;
}) {
  return (
    <section className="mt-6">
      <label className="text-sm text-ink">
        Źródło
        <select value={source} onChange={(event) => onSource(event.target.value)} className="mt-1 block min-h-11 rounded-md border border-line bg-paper px-3">
          <option value="">Wszystkie</option>
          {buckets.map((bucket) => (
            <option key={bucket} value={bucket}>
              {bucket}
            </option>
          ))}
        </select>
      </label>
      {rows.length ? (
        <ul className="mt-4 divide-y divide-line border-y border-line text-sm">
          {rows.map((row) => (
            <li key={`${row.bucket}-${row.channel}-${row.source}`} className="flex flex-wrap items-baseline justify-between gap-2 py-3">
              <span>
                <span className="text-ink">{row.bucket}</span>
                <span className="mt-1 block text-xs text-muted">
                  {row.channel || "kanał bez nazwy"}
                  {row.source ? ` · ${row.source}` : ""}
                </span>
              </span>
              <span>{formatCount(row.sessions)} sesji · {formatCount(row.users)} użytkowników</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-muted">API nie zwróciło źródeł albo filtr je wyzerował na ekranie, nie w Google.</p>
      )}
    </section>
  );
}

function Seo({
  report,
  country,
  onCountry,
  onApply,
  onOpen,
}: {
  report: StatsPayload;
  country: string;
  onCountry: (value: string) => void;
  onApply: () => void;
  onOpen: (path: string) => void;
}) {
  const seo = report.seo;
  if (!seo) return null;
  return (
    <section className="mt-6">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          onApply();
        }}
      >
        <label className="text-sm text-ink">
          Kraj (3 litery, np. pol)
          <input
            value={country}
            onChange={(event) => onCountry(event.target.value.toLowerCase())}
            maxLength={3}
            className="mt-1 block min-h-11 w-28 rounded-md border border-line bg-paper px-3"
          />
        </label>
        <Button type="submit" variant="outline">
          Filtruj Search Console
        </Button>
      </form>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Kliknięcia w Google" value={formatCount(seo.clicks)} hint={seo.previous ? `Poprzednio ${formatCount(seo.previous.clicks)}` : undefined} />
        <Tile label="Wyświetlenia" value={formatCount(seo.impressions)} hint={seo.previous ? `Poprzednio ${formatCount(seo.previous.impressions)}` : undefined} />
        <Tile label="Średni CTR" value={formatPercent(seo.ctr)} hint="Kliknięcia podzielone przez wyświetlenia w Search Console." />
        <Tile label="Średnia pozycja" value={seo.position === null ? "—" : seo.position.toLocaleString("pl-PL", { maximumFractionDigits: 1 })} hint={seo.previous?.position === null || seo.previous?.position === undefined ? undefined : `Poprzednio ${seo.previous.position.toLocaleString("pl-PL", { maximumFractionDigits: 1 })}`} />
      </div>
      <p className="mt-4 text-xs leading-relaxed text-muted">{seo.note}</p>
      <QueryList title="Frazy" rows={seo.queries} />
      <QueryList title="Wzrosty w pobranej próbie fraz" rows={seo.rising} />
      <QueryList title="Spadki w pobranej próbie fraz" rows={seo.falling} />
      <h2 className="mt-8 font-display text-2xl text-forest">Strony w wynikach Google</h2>
      {seo.pages.length ? (
        <ul className="mt-3 space-y-2 text-sm">
          {seo.pages.map((row) => (
            <li key={row.key}>
              <button type="button" className="min-h-11 text-left text-forest underline" onClick={() => onOpen(pathOf(row.key))}>
                {row.key}
              </button>
              <span className="ml-3 text-muted">{formatCount(row.clicks)} kliknięć · {formatCount(row.impressions)} wyświetleń</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted">API nie zwróciło stron.</p>
      )}
    </section>
  );
}

function pathOf(value: string) {
  try {
    if (value.startsWith("http://") || value.startsWith("https://")) return new URL(value).pathname || "/";
  } catch {
    return "/";
  }
  return value.startsWith("/") ? value : "/";
}

function QueryList({ title, rows }: { title: string; rows: StatsPayload["seo"] extends infer T ? T extends { queries: infer Q } ? Q : never : never }) {
  const list = rows as { key: string; clicks: number | null; impressions: number | null; ctr: number | null; position: number | null; clicksDelta?: number | null; note?: string }[];
  return (
    <div className="mt-8">
      <h2 className="font-display text-2xl text-forest">{title}</h2>
      {list.length ? (
        <ul className="mt-3 space-y-3 text-sm">
          {list.map((row) => (
            <li key={`${title}-${row.key}`} className="border-b border-line pb-3">
              <p className="text-ink">{row.key}</p>
              <p className="text-muted">
                {formatCount(row.clicks)} kliknięć · {formatCount(row.impressions)} wyświetleń · CTR {formatPercent(row.ctr)} · pozycja{" "}
                {row.position === null ? "—" : row.position.toLocaleString("pl-PL", { maximumFractionDigits: 1 })}
                {row.clicksDelta === null || row.clicksDelta === undefined ? "" : ` · zmiana kliknięć ${row.clicksDelta > 0 ? "+" : ""}${row.clicksDelta}`}
              </p>
              {row.note ? <p className="text-xs text-muted">{row.note}</p> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted">Brak wierszy, które da się uczciwie porównać.</p>
      )}
    </div>
  );
}

function Conversions({ report }: { report: StatsPayload | null }) {
  const events = report?.conversions?.events ?? [];
  return (
    <section className="mt-6">
      <p className="text-sm text-muted">{CONVERSION_NOTE}</p>
      {events.length ? (
        <ul className="mt-4 space-y-4">
          {events.map((event) => (
            <li key={event.name} className="rounded-lg border border-line bg-cream p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-display text-2xl text-forest">{event.label}</h2>
                <p className="text-lg text-ink">
                  {event.name === "form_success"
                    ? "pomiar niedostępny"
                    : event.name === "form_start"
                    ? "to nie jest klient"
                    : event.seen
                      ? formatCount(event.count)
                      : "brak w raporcie"}
                </p>
              </div>
              {event.name === "form_start" && event.seen ? (
                <p className="mt-1 text-sm text-muted">Kliknięć wysłania: {formatCount(event.count)}. Bez potwierdzenia dostawy.</p>
              ) : null}
              {event.channels.length ? (
                <ul className="mt-2 text-sm text-muted">
                  {event.channels.map((channel) => (
                    <li key={channel.channel}>
                      {channel.channel}: {formatCount(channel.count)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted">Brak zdarzeń w tym zakresie. Zero nie zostało dopisane.</p>
      )}
    </section>
  );
}

function PageDetail({ report, onBack }: { report: StatsPayload; onBack: () => void }) {
  const page = report.page;
  if (!page) return null;
  return (
    <section className="mt-6">
      <Button type="button" variant="outline" onClick={onBack}>
        Wróć do listy
      </Button>
      <h2 className="mt-4 font-display text-3xl text-forest">{page.path}</h2>
      <p className="mt-2 text-xs leading-relaxed text-muted">{page.note}</p>
      {page.totals ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Odsłony" value={formatCount(page.totals.views)} hint={countHint(page.totals.views, page.previousTotals?.views ?? null)} />
          <Tile label="Użytkownicy" value={formatCount(page.totals.users)} hint={countHint(page.totals.users, page.previousTotals?.users ?? null)} />
          <Tile label="Średni czas zaangażowania" value={formatDuration(page.totals.engagementSeconds)} hint={ENGAGEMENT_NOTE} />
          <Tile label="Udział sesji organicznych" value={formatPercent(page.organicShare)} />
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">API nie zwróciło sum dla tego adresu.</p>
      )}
      <div className="mt-6 rounded-lg border border-line bg-cream p-4">
        <Bars points={page.series} field="views" label="Odsłony tego adresu" />
      </div>
      <h3 className="mt-6 font-display text-2xl text-forest">Źródła</h3>
      {page.sources.length ? (
        <ul className="mt-2 text-sm">
          {page.sources.map((row) => (
            <li key={row.channel} className="flex justify-between gap-3 border-b border-line py-2">
              <span>{row.channel}</span>
              <span>{formatCount(row.sessions)} sesji</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted">API nie zwróciło źródeł tej podstrony.</p>
      )}
      <Conversions report={{ ...report, conversions: { events: page.events, note: "Zdarzenia powiązane z tym adresem." } }} />
    </section>
  );
}
