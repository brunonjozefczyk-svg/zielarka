export type StampBlob = { pathname: string; url: string; uploadedAt: number };
export type AttemptRow = { count: number; until: number };
export type KeptBlob = { pathname: string; url: string; uploadedAt: number; revision: number };

export function toPublicDoc<T extends { entries: { status: string; image?: string; slug?: string }[]; images?: Record<string, string> }>(
  doc: T,
): T {
  const drafts = doc.entries.filter((entry) => entry.status !== "published");
  const draftSlugs = new Set(drafts.map((entry) => entry.slug).filter((slug): slug is string => Boolean(slug)));
  const publishedImages = new Set(
    doc.entries
      .filter((entry) => entry.status === "published" && typeof entry.image === "string")
      .map((entry) => entry.image as string),
  );
  const draftImages = new Set(
    drafts.map((entry) => entry.image).filter((image): image is string => typeof image === "string" && image.length > 0),
  );
  const images = doc.images
    ? Object.fromEntries(
        Object.entries(doc.images).filter(([key, value]) => {
          if (typeof value !== "string" || value.startsWith("seal:")) return false;
          if (draftSlugs.has(key.replace(/^img\.herb\./, "")) && key.startsWith("img.herb.")) return false;
          if (draftImages.has(value) && !publishedImages.has(value)) return false;
          return true;
        }),
      )
    : doc.images;
  return {
    ...doc,
    ...(doc.images ? { images } : {}),
    entries: doc.entries
      .filter((entry) => entry.status === "published")
      .map((entry) =>
        typeof entry.image === "string" && entry.image.startsWith("seal:") ? { ...entry, image: "" } : entry,
      ),
  };
}

export function assertRevision(current: number, expected: number) {
  if (!Number.isInteger(expected) || expected !== current) {
    throw new Error("Ktoś zapisał w międzyczasie. Odśwież stronę.");
  }
}

/** Keeps the newest copies. If the file just written is not in the list yet, deletes nothing. */
export function urlsToPrune(blobs: StampBlob[], keep: number, writtenPath: string) {
  if (!writtenPath || keep < 1) return [];
  const sorted = [...blobs].sort(
    (a, b) => b.uploadedAt - a.uploadedAt || b.pathname.localeCompare(a.pathname),
  );
  if (!sorted.some((blob) => blob.pathname === writtenPath)) return [];
  return sorted
    .slice(keep)
    .map((blob) => blob.url)
    .filter(Boolean);
}

/** 20 ostatnich zapisów, 30 dni i 12 miesięcy. Najnowsza kopia nigdy nie wypada. */
export function urlsToRetain(blobs: KeptBlob[]) {
  const sorted = [...blobs].sort((a, b) => b.revision - a.revision || b.uploadedAt - a.uploadedAt);
  if (!sorted.length) return [];
  const keep = new Set<string>();
  keep.add(sorted[0].pathname);
  for (const item of sorted.slice(0, 20)) keep.add(item.pathname);
  const days = new Set<string>();
  const months = new Set<string>();
  for (const item of sorted) {
    if (!Number.isFinite(item.uploadedAt) || item.uploadedAt <= 0) continue;
    const day = new Date(item.uploadedAt).toISOString().slice(0, 10);
    const month = day.slice(0, 7);
    if (!days.has(day) && days.size < 30) {
      days.add(day);
      keep.add(item.pathname);
    }
    if (!months.has(month) && months.size < 12) {
      months.add(month);
      keep.add(item.pathname);
    }
  }
  return sorted.filter((item) => !keep.has(item.pathname)).map((item) => item.url).filter(Boolean);
}

/** Uszkodzona baza nie blokuje zapisu odzyskania. Nowsza, czytelna wersja blokuje. */
export function sameRevisionOrUnreadable(fresh: number | null, expected: number, unreadable: boolean): "proceed" | "conflict" {
  if (unreadable || fresh == null) return "proceed";
  if (!Number.isInteger(fresh) || fresh !== expected) return "conflict";
  return "proceed";
}

/**
 * Najwyższy numer dziennika. Pusta lista to brak zatwierdzonej wersji, nie „weź wskaźnik”.
 * Numer musi być całkowity. Luka (jest 12, nie ma 11) nie obniża wyniku.
 */
export function newestCommittedRevision(revisions: readonly number[]): number | null {
  let best: number | null = null;
  for (const revision of revisions) {
    if (!Number.isInteger(revision) || revision < 0) continue;
    if (best === null || revision > best) best = revision;
  }
  return best;
}

/**
 * Wskaźnik current.json jest wiarygodny tylko, gdy kompletna lista dziennika
 * ma ten sam najwyższy numer. Sam brak wersji N+1 nie wystarcza: przerwany zapis
 * N+1 zostawia dziurę, a wersja N+2 może już być opublikowana.
 * null oznacza, że listy nie mamy (awaria). Wtedy wskaźnikowi nie wolno ufać.
 */
export function trustPublicPointer(pointerRevision: number, journalRevisions: readonly number[] | null): boolean {
  if (!Number.isInteger(pointerRevision) || pointerRevision < 0) return false;
  if (!journalRevisions) return false;
  return newestCommittedRevision(journalRevisions) === pointerRevision;
}

/** null = niepewny magazyn. Nie wolno wtedy podstawić starszego wskaźnika. */
export function selectPublicRevision(journalRevisions: readonly number[] | null): number | null {
  if (!journalRevisions) return null;
  return newestCommittedRevision(journalRevisions);
}

/**
 * Najnowszy dziennik przy 404 albo awarii nie schodzi do starszego.
 * Starszy plik z 404 można pominąć. Uszkodzona treść najnowszego pliku też.
 */
export function publicJournalFailure(isNewest: boolean, error: unknown): "stop" | "try-older" {
  if (isNewest && error instanceof Error && /Odczyt treści nie powiódł się \(404\)/.test(error.message)) return "stop";
  return readFailureAction(error);
}

const JOURNAL_SHA = /^[a-f0-9]{64}$/;

/**
 * Wpis dziennika jest aktualny tylko razem z dokumentem.
 * Numer pliku, numer wewnątrz wpisu, numer dokumentu i SHA-256 treści muszą być jednym zapisem.
 * Brak numeru wewnątrz (stary plik) przechodzi wyłącznie, gdy dokument i suma się zgadzają.
 */
export function judgeJournal(input: {
  journalRevision: number;
  pointerRevision?: number | null;
  pointerUrl: unknown;
  pointerSha: unknown;
  docRevision: number;
  docSha: string;
}): "ok" | "damaged" {
  if (!Number.isInteger(input.journalRevision) || input.journalRevision < 0) return "damaged";
  if (typeof input.pointerUrl !== "string" || !input.pointerUrl) return "damaged";
  if (input.pointerRevision !== undefined && input.pointerRevision !== null) {
    if (!Number.isInteger(input.pointerRevision) || input.pointerRevision !== input.journalRevision) return "damaged";
  }
  if (typeof input.pointerSha !== "string" || !JOURNAL_SHA.test(input.pointerSha)) return "damaged";
  if (!Number.isInteger(input.docRevision) || input.docRevision !== input.journalRevision) return "damaged";
  if (input.docSha !== input.pointerSha) return "damaged";
  return "ok";
}

/** Jeden plik dziennika. Awaria najnowszego nie schodzi niżej. Uszkodzona treść może. */
export function journalStep<T>(input: {
  isNewest: boolean;
  journalRevision: number;
  pointerRevision?: number | null;
  pointerUrl: unknown;
  pointerSha: unknown;
  doc: T | null;
  docRevision: number;
  docSha: string;
  error: unknown | null;
}): { action: "use"; value: T } | { action: "try-older" } | { action: "stop"; error: unknown } {
  if (input.error) {
    if (publicJournalFailure(input.isNewest, input.error) === "stop") return { action: "stop", error: input.error };
    return { action: "try-older" };
  }
  const verdict = judgeJournal({
    journalRevision: input.journalRevision,
    pointerRevision: input.pointerRevision,
    pointerUrl: input.pointerUrl,
    pointerSha: input.pointerSha,
    docRevision: input.docRevision,
    docSha: input.docSha,
  });
  if (verdict === "ok" && input.doc != null) return { action: "use", value: input.doc };
  const damaged = new Error("Kopia jest uszkodzona.");
  if (publicJournalFailure(input.isNewest, damaged) === "stop") return { action: "stop", error: damaged };
  return { action: "try-older" };
}

/**
 * Koszt zimnego odczytu publicznego, gdy wskaźnik zatwierdzonej wersji już jest.
 * Historia dziennika nie jest listowana. Dwa odczyty to wskaźnik i dokument.
 * Trafienie CDN Blob nie liczy się nawet jako operacja prosta. Pamięć instancji nie zastępuje wskaźnika.
 */
export function publicReadCost(saves: number, _pageSize = 1000): { listRequests: number; documentRequests: number } {
  if (!Number.isInteger(saves) || saves < 0) return { listRequests: 0, documentRequests: 0 };
  if (saves === 0) return { listRequests: 0, documentRequests: 0 };
  return { listRequests: 0, documentRequests: 2 };
}

/** Nowy wskaźnik jest publiczny tylko z jawnym committed: true, rewizją i SHA-256. Sam brak false nie wystarcza. */
export function acceptPublicPointer(row: {
  revision?: unknown;
  url?: unknown;
  sha?: unknown;
  committed?: unknown;
} | null): boolean {
  if (!row || row.committed !== true) return false;
  if (typeof row.revision !== "number" || !Number.isInteger(row.revision) || row.revision < 1) return false;
  if (typeof row.url !== "string" || row.url.length < 8) return false;
  if (typeof row.sha !== "string" || !JOURNAL_SHA.test(row.sha)) return false;
  return true;
}

export type CutoverPlan = {
  action: "already" | "ready" | "stop";
  reason: string;
  revision: number;
  url: string;
  sha: string;
  /** pointer = już jest current.json; journal = nowy dziennik; main = zielarka/docs albo content.json. */
  source: "pointer" | "journal" | "main" | "none";
};

export type MainCutoverHead = {
  answered: boolean;
  damaged: boolean;
  hasContent: boolean;
  uploadedAt: number;
  publicSha: string;
  url: string;
  unknown: string[];
  truncated: string[];
};

const MAIN_TOP_KEYS = new Set(["copy", "images", "herbs", "entries", "revision", "theme", "styles", "sha"]);
const MAIN_ENTRY_KEYS = new Set([
  "slug",
  "status",
  "name",
  "latin",
  "lead",
  "note",
  "season",
  "part",
  "habitat",
  "recognize",
  "harvest",
  "prepare",
  "tradition",
  "caution",
  "seoTitle",
  "seoDescription",
  "alt",
  "image",
  "faqs",
  "related",
  "updatedAt",
  "history",
]);
const MAIN_ENTRY_LIMITS: Record<string, number> = {
  name: 80,
  latin: 80,
  lead: 600,
  note: 240,
  season: 80,
  part: 80,
  habitat: 160,
  recognize: 2000,
  harvest: 2000,
  prepare: 2000,
  tradition: 2000,
  caution: 2000,
  seoTitle: 70,
  seoDescription: 160,
  alt: 160,
  slug: 60,
  updatedAt: 40,
};

/**
 * Produkcyjny main zapisuje {copy, images, herbs, entries} bez pola committed.
 * To nie jest nowa transakcja. Funkcja tylko wylicza, co parser by uciął.
 * Herbs zostają całe: main trzyma tam dowolny obiekt nadpisania rośliny.
 */
export function legacyFieldLoss(raw: unknown): { unknown: string[]; truncated: string[] } {
  const unknown: string[] = [];
  const truncated: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { unknown: ["(dokument nie jest obiektem)"], truncated };
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!MAIN_TOP_KEYS.has(key)) unknown.push(key);
  }
  if (!Array.isArray(record.entries)) return { unknown, truncated };
  record.entries.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      unknown.push(`entries[${index}]`);
      return;
    }
    const row = entry as Record<string, unknown>;
    for (const key of Object.keys(row)) {
      if (!MAIN_ENTRY_KEYS.has(key)) unknown.push(`entries[${index}].${key}`);
      const limit = MAIN_ENTRY_LIMITS[key];
      if (typeof row[key] === "string" && limit && (row[key] as string).length > limit) truncated.push(`entries[${index}].${key}`);
    }
    if (typeof row.image === "string" && !row.image.startsWith("data:") && row.image.length > 2000) {
      truncated.push(`entries[${index}].image`);
    }
    if (Array.isArray(row.history)) {
      row.history.forEach((item, historyIndex) => {
        if (!item || typeof item !== "object") return;
        const history = item as Record<string, unknown>;
        for (const key of Object.keys(history)) {
          if (!["at", "name", "lead", "status"].includes(key)) unknown.push(`entries[${index}].history[${historyIndex}].${key}`);
        }
        if (typeof history.at === "string" && history.at.length > 40) truncated.push(`entries[${index}].history[${historyIndex}].at`);
        if (typeof history.name === "string" && history.name.length > 80) truncated.push(`entries[${index}].history[${historyIndex}].name`);
        if (typeof history.lead === "string" && history.lead.length > 200) truncated.push(`entries[${index}].history[${historyIndex}].lead`);
      });
    }
    if (Array.isArray(row.faqs)) {
      row.faqs.forEach((item, faqIndex) => {
        if (!item || typeof item !== "object") return;
        const faq = item as Record<string, unknown>;
        for (const key of Object.keys(faq)) {
          if (key !== "q" && key !== "a") unknown.push(`entries[${index}].faqs[${faqIndex}].${key}`);
        }
        if (typeof faq.q === "string" && faq.q.length > 160) truncated.push(`entries[${index}].faqs[${faqIndex}].q`);
        if (typeof faq.a === "string" && faq.a.length > 600) truncated.push(`entries[${index}].faqs[${faqIndex}].a`);
      });
    }
  });
  return { unknown, truncated };
}

/**
 * Brak current.json. Stary dokument main i zatwierdzony dziennik to dwie różne ścieżki.
 * Dziennik bez znacznika commit nie wchodzi do tej decyzji w ogóle.
 */
export function unpointedPublicChoice(input: {
  main: { hasContent: boolean; damaged: boolean; uploadedAt: number } | null;
  commit: { uploadedAt: number; journalOk: boolean } | null;
}): "main" | "commit" | "empty" | "damaged" | "ambiguous" {
  const main = input.main;
  const commit = input.commit;
  if (main?.damaged && (!commit || main.uploadedAt > commit.uploadedAt)) return "damaged";
  if (main?.hasContent && !main.damaged && (!commit || !commit.journalOk)) return "main";
  if (commit?.journalOk && (!main?.hasContent || main.damaged || commit.uploadedAt >= (main?.uploadedAt ?? 0))) return "commit";
  if (main?.hasContent && !main.damaged) return "main";
  if (!main?.hasContent && !commit) return "empty";
  return "ambiguous";
}

/**
 * Jednorazowa decyzja przejścia na current.json. Nie zapisuje.
 * Brak odpowiedzi nie jest pustą bazą. Nowszy dziennik bez znacznika zatrzymuje operację.
 * Dokument produkcyjnego main (zielarka/docs albo content.json) nie ma pola committed.
 * Nie jest przez to nową transakcją. Ma osobną ścieżkę i nie jest pustką.
 */
export function cutoverDecision(input: {
  storeAnswered: boolean;
  pointerStatus: number | null;
  pointer: { revision?: unknown; url?: unknown; sha?: unknown; committed?: unknown } | null;
  pointerDocMatches: boolean;
  historyAnswered: boolean;
  commitUnreadable: boolean;
  commits: readonly { revision: number; publicSha: string; uploadedAt?: number }[] | null;
  journals: readonly { revision: number; url: string; sha: string; docMatches: boolean; draft: boolean }[] | null;
  main?: MainCutoverHead | null;
}): CutoverPlan {
  const stop = (reason: string): CutoverPlan => ({ action: "stop", reason, revision: 0, url: "", sha: "", source: "none" });
  if (!input.storeAnswered) return stop("Magazyn nie odpowiedział. Nic nie zostało uznane za puste.");
  if (input.pointerStatus != null && input.pointerStatus !== 200 && input.pointerStatus !== 404) {
    return stop("Odczyt wskaźnika nie jest pewny. Migracja nie ruszyła.");
  }
  if (input.pointerStatus === 200) {
    if (acceptPublicPointer(input.pointer) && input.pointerDocMatches && input.pointer) {
      return {
        action: "already",
        reason: "Wskaźnik jest już zatwierdzony.",
        revision: input.pointer.revision as number,
        url: input.pointer.url as string,
        sha: input.pointer.sha as string,
        source: "pointer",
      };
    }
    return stop("Wskaźnik nie ma jednoznacznego zatwierdzenia. Migracja nie ruszyła.");
  }
  if (!input.historyAnswered || !input.commits || !input.journals) {
    return stop("Historii nie da się potwierdzić. Migracja nie ruszyła.");
  }
  if (input.commitUnreadable) return stop("Znacznik zatwierdzenia jest niepewny. Migracja nie ruszyła.");
  const main = input.main ?? null;
  if (input.commits.length > 0) {
    const best = input.commits.reduce((left, right) => (left.revision > right.revision ? left : right));
    if (input.journals.some((journal) => journal.revision > best.revision)) {
      return stop("Jest nowszy dziennik bez zatwierdzenia. Wskaźnik nie został utworzony.");
    }
    if (main?.damaged && main.uploadedAt > (best.uploadedAt ?? 0)) {
      return stop("Najnowszy stary dokument jest uszkodzony. Starszego nie podstawiam.");
    }
    if (main?.hasContent && !main.damaged && main.uploadedAt > (best.uploadedAt ?? 0)) {
      return stop("Nowszy jest dokument ze starego CMS. Nie cofam go do starszego zatwierdzenia.");
    }
    const journal = input.journals.find(
      (item) => item.revision === best.revision && item.sha === best.publicSha && item.docMatches && !item.draft,
    );
    if (!journal) return stop("Zatwierdzona rewizja nie zgadza się z dziennikiem. Wskaźnik nie został utworzony.");
    return {
      action: "ready",
      reason: "Można utworzyć wskaźnik zatwierdzonej rewizji.",
      revision: journal.revision,
      url: journal.url,
      sha: journal.sha,
      source: "journal",
    };
  }
  if (main?.hasContent) {
    if (main.damaged) return stop("Najnowszy stary dokument jest uszkodzony. Starszego nie podstawiam.");
    if (input.journals.length > 0) {
      return stop("Są stare dokumenty i dziennik bez znacznika. Nie wybieram po cichu starszej wersji.");
    }
    const loss = [...main.unknown, ...main.truncated];
    if (loss.length > 0) {
      return stop(`Stary dokument ma pola, których nie wolno uciąć: ${loss.join(", ")}. Wskaźnik nie został utworzony.`);
    }
    if (!JOURNAL_SHA.test(main.publicSha) || !main.url) {
      return stop("Stary dokument nie ma pewnej sumy. Wskaźnik nie został utworzony.");
    }
    return {
      action: "ready",
      reason: "Stary dokument produkcyjny jest czytelny. Wskaźnik powstanie dopiero na polecenie.",
      revision: 1,
      url: main.url,
      sha: main.publicSha,
      source: "main",
    };
  }
  if (input.journals.length === 0) return stop("Brak zatwierdzonego dziennika. Wskaźnik nie został utworzony.");
  const newest = input.journals.reduce((left, right) => (left.revision > right.revision ? left : right));
  if (!newest.docMatches || newest.draft || !JOURNAL_SHA.test(newest.sha) || !newest.url) {
    return stop("Najnowszy stary dziennik nie jest kompletny. Starszego nie podstawiam.");
  }
  return {
    action: "ready",
    reason: "Stary dziennik ma zgodną sumę. Wskaźnik powstanie dopiero na polecenie.",
    revision: newest.revision,
    url: newest.url,
    sha: newest.sha,
    source: "journal",
  };
}

export const STORE_OUTAGE = "Magazyn treści jest chwilowo niedostępny. Zapis został zatrzymany. Nic nie zostało cofnięte.";

/** Zapis doszedł do PUT, ale odczyt potwierdzający nie rozstrzygnął wyniku. Nie wolno ogłaszać, że na pewno nic nie zapisano. */
export const UNCERTAIN_SAVE =
  "Nie udało się potwierdzić zapisu. Odśwież stronę i sprawdź treść, zanim zapiszesz ponownie.";

/** Odtworzenie mogło się zapisać, ale ponowny odczyt tego nie potwierdził. Całego odtwarzania nie wolno puszczać drugi raz. */
export const UNCERTAIN_RESTORE =
  "Odtworzenie nie dało się potwierdzić odczytem. Kopia źródłowa nie została skasowana. Odśwież stronę i sprawdź treść, zanim uruchomisz odtwarzanie ponownie.";

/**
 * Ile odczytów wolno zrobić dla pliku, którego adres właśnie wrócił z PUT.
 * Pierwsza próba jest natychmiastowa. Zwykły odczyt strony tego nie używa.
 */
export const FRESH_READ_LIMIT = 6;

let freshDelayScale = 1;

/** Testy ustawiają 0, żeby nie czekać. Produkcja zostawia 1. */
export function setFreshReadDelayScaleForTests(scale: number) {
  freshDelayScale = scale > 0 ? scale : 0;
}

/** Przerwy przed próbą 1..5. Suma przy skali 1: 6 s. Próba 0 nie czeka. */
export function freshReadDelayMs(attempt: number): number {
  if (attempt <= 0) return 0;
  const gaps = [400, 800, 1200, 1600, 2000];
  const base = gaps[Math.min(attempt - 1, gaps.length - 1)] ?? 2000;
  return Math.round(base * freshDelayScale);
}

/**
 * Ponawiamy wyłącznie 404 tuż po PUT znanego adresu.
 * 500, 503 i sieć (status 0) zatrzymują od razu — nie wolno z nich zrobić sukcesu.
 */
export function freshReadDecision(status: number, attempt: number, limit = FRESH_READ_LIMIT): "ok" | "retry" | "stop" {
  if (status >= 200 && status < 300) return "ok";
  if (status === 404 && attempt + 1 < limit) return "retry";
  return "stop";
}

export function waitFreshRead(attempt: number) {
  const ms = freshReadDelayMs(attempt);
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Publikacja doganiająca wolno tylko ze znacznika zatwierdzenia.
 * Sam dziennik prywatny, bez znacznika, nie jest zgodą na publikację.
 * Gdy publiczny dziennik jest już przy tej rewizji, nie publikujemy drugi raz.
 */
export function healMayPublish(input: { commitRevision: number | null; publicRevision: number | null }): boolean {
  if (input.commitRevision == null || !Number.isInteger(input.commitRevision) || input.commitRevision < 1) return false;
  if (input.publicRevision != null && input.publicRevision >= input.commitRevision) return false;
  return true;
}

/**
 * Treść tuż po PUT jest przyjęta tylko z oczekiwaną rewizją i SHA-256.
 * Zła suma nie jest sukcesem. Brak odczytu nie uprawnia do starszej wersji.
 */
export function confirmFreshBody(input: {
  readable: boolean;
  revision: number | null;
  expectedRevision: number;
  sha: string | null;
  expectedSha: string;
}): "ok" | "mismatch" | "unread" {
  if (!input.readable) return "unread";
  if (input.revision !== input.expectedRevision) return "mismatch";
  if (!input.sha || input.sha !== input.expectedSha) return "mismatch";
  return "ok";
}

/**
 * Uszkodzony pojedynczy plik można pominąć. Chwilowa awaria, brak klucza i błąd sieci
 * zatrzymują odczyt — nie wolno wtedy przyjąć starszej wersji za aktualną.
 */
export function readFailureAction(error: unknown): "try-older" | "stop" {
  if (!(error instanceof Error)) return "stop";
  if (/chwilowo niedostępny|Zapis został zatrzymany|Brak klucza|CMS_SEAL_KEY|CMS_SEAL_KEYS|dwa różne klucze/i.test(error.message)) {
    return "stop";
  }
  if (error instanceof SyntaxError) return "try-older";
  if (/Odczyt treści nie powiódł się \(404\)/.test(error.message)) return "try-older";
  if (/Odczyt (treści )?nie powiódł się \(\d+\)/.test(error.message)) return "stop";
  if (/Kopia jest uszkodzona|Suma kontrolna|nie zgadza się/i.test(error.message)) return "try-older";
  if (/Nie da się odczytać starej kopii/i.test(error.message)) return "stop";
  return "stop";
}

/** 503 i sieć stają się czytelnym komunikatem. Brak klucza zostaje własnym komunikatem. Uszkodzony plik nie jest awarią. */
export function throwIfUncertain(error: unknown): void {
  if (readFailureAction(error) !== "stop") return;
  if (
    error instanceof Error &&
    /Brak klucza|CMS_SEAL|Nie da się odczytać starej kopii|chwilowo niedostępny|Zapis został zatrzymany|Nic nie zostało skasowane|Brak magazynu/.test(
      error.message,
    )
  ) {
    throw error;
  }
  throw new Error(STORE_OUTAGE);
}

export function chooseFreshRead<T>(
  attempts: ({ ok: true; value: T } | { ok: false; error: unknown })[],
): { action: "use"; value: T } | { action: "stop" } | { action: "damaged" } | { action: "empty" } {
  let corrupt = false;
  for (const attempt of attempts) {
    if (attempt.ok) return { action: "use", value: attempt.value };
    if (readFailureAction(attempt.error) === "stop") return { action: "stop" };
    corrupt = true;
  }
  if (!attempts.length) return { action: "empty" };
  return corrupt ? { action: "damaged" } : { action: "empty" };
}

/** Zwykły zapis rusza tylko przy pewnym numerze wersji. Awaryjne odzyskanie rusza, gdy cała treść jest uszkodzona. */
export function writeAfterReread(error: unknown | null, fresh: number | null, expected: number): "write" | "conflict" | "stop" {
  if (error) {
    if (error instanceof Error && error.message === "Aktywna treść jest uszkodzona.") return "write";
    return "stop";
  }
  if (fresh == null || !Number.isInteger(fresh) || fresh !== expected) return "conflict";
  return "write";
}

export const INBOX_TTL_MS = 48 * 60 * 60 * 1000;

/**
 * Porzucone wgrywanie kopii. Nie rusza aktywnej sesji ani pliku bez daty.
 * Zwraca adresy do skasowania, nigdy ścieżki bieżącego przywracania.
 */
export function expiredInboxUrls(
  files: { pathname: string; url: string; uploadedAt: number }[],
  now: number,
  activeSession = "",
  ttlMs = INBOX_TTL_MS,
): string[] {
  const groups = new Map<string, { newest: number; urls: string[]; unknown: boolean }>();
  for (const file of files) {
    const match = /^zielarka\/restore-inbox\/([a-f0-9]{32})\//.exec(file.pathname);
    if (!match?.[1] || !file.url) continue;
    const session = match[1];
    const row = groups.get(session) ?? { newest: 0, urls: [], unknown: false };
    row.urls.push(file.url);
    if (!Number.isFinite(file.uploadedAt) || file.uploadedAt <= 0) row.unknown = true;
    else if (file.uploadedAt > row.newest) row.newest = file.uploadedAt;
    groups.set(session, row);
  }
  const drop: string[] = [];
  for (const [session, row] of groups) {
    if (session === activeSession || row.unknown) continue;
    if (now - row.newest < ttlMs) continue;
    drop.push(...row.urls);
  }
  return drop;
}

export function createAttemptLimiter(max = 8, windowMs = 15 * 60_000) {
  const rows = new Map<string, { count: number; until: number }>();
  return {
    blocked(key: string, now = Date.now()) {
      const row = rows.get(key);
      return Boolean(row && row.count >= max && row.until > now);
    },
    note(key: string, ok: boolean, now = Date.now()) {
      if (ok) {
        rows.delete(key);
        return;
      }
      const row = rows.get(key);
      if (!row || row.until <= now) {
        rows.set(key, { count: 1, until: now + windowMs });
        return;
      }
      row.count += 1;
      if (row.count >= max) row.until = now + windowMs;
    },
  };
}

export function attemptBlocked(row: AttemptRow | null, now = Date.now()) {
  return Boolean(row && row.count >= 8 && row.until > now);
}

export function nextAttempt(row: AttemptRow | null, ok: boolean, now = Date.now(), windowMs = 15 * 60_000) {
  if (ok) return { count: 0, until: 0 };
  if (!row || row.until <= now) return { count: 1, until: now + windowMs };
  const count = row.count + 1;
  return { count, until: count >= 8 ? now + windowMs : row.until };
}

export const LOCK_STALE_MS = 90_000;

/** True only when the store rejected the create because that path is already taken. */
export function blobConflict(status: number, body: string) {
  if (status === 409 || status === 412) return true;
  return /already exists|allowoverwrite|precondition failed|blob_already_exists/i.test(body);
}

export function lockDecision(
  status: number,
  body: string,
  ageMs: number | null,
): "claimed" | "busy" | "steal" | "fail" {
  if (status >= 200 && status < 300) return "claimed";
  if (!blobConflict(status, body)) return "fail";
  if (ageMs == null || ageMs >= LOCK_STALE_MS) return "steal";
  return "busy";
}

/** A store failure must not look like an empty database. */
export function publicFallback<T>(cached: T | null, error: unknown): T {
  if (cached) return cached;
  if (error instanceof Error) throw error;
  throw new Error("Magazyn treści jest chwilowo niedostępny.");
}

export function herbOutageAction(isBuiltin: boolean): "show-builtin" | "unavailable" {
  return isBuiltin ? "show-builtin" : "unavailable";
}

export function canonicalEdits(doc: {
  revision: number;
  copy: unknown;
  images: unknown;
  herbs: unknown;
  entries: unknown;
  theme: unknown;
  styles: unknown;
}) {
  return JSON.stringify({
    revision: doc.revision,
    copy: doc.copy,
    images: doc.images,
    herbs: doc.herbs,
    entries: doc.entries,
    theme: doc.theme,
    styles: doc.styles,
  });
}

export type MemStore = {
  lock: number | null;
  privateRev: number;
  publicRev: number;
  privateBody: string;
  publicBody: string;
};

/** Ten sam porządek co zapis w magazynie: publiczna wersja zmienia się na końcu. */
export function memWrite(
  mem: MemStore,
  expected: number,
  nextPrivate: string,
  nextPublic: string,
  failAt?: "private" | "public" | "public-commit",
  damaged = false,
): { ok: true; revision: number } | { ok: false; message: string } {
  const current = mem.privateRev;
  if (mem.lock === expected || (!damaged && expected !== current)) {
    return { ok: false, message: "Ktoś zapisał w międzyczasie. Odśwież stronę." };
  }
  mem.lock = expected;
  if (failAt === "private") {
    mem.lock = null;
    return { ok: false, message: "Zapis nie powiódł się." };
  }
  const revision = expected + 1;
  mem.privateRev = revision;
  mem.privateBody = nextPrivate;
  if (failAt === "public" || failAt === "public-commit") {
    mem.lock = null;
    return { ok: false, message: "Zapis nie powiódł się." };
  }
  mem.publicRev = revision;
  mem.publicBody = nextPublic;
  mem.lock = null;
  return { ok: true, revision };
}

export function classifyLegacy(pathname: string, json: unknown): "plaintext-private" | "sealed" | "public" | "ignore" {
  if (pathname.startsWith("zielarka/public/") || pathname.startsWith("zielarka/journal/public/")) return "public";
  if (pathname.startsWith("zielarka/images/") || pathname.startsWith("zielarka/sealed-images/")) return "ignore";
  if (pathname.startsWith("zielarka/backups/") || pathname.startsWith("zielarka/locks/")) return "ignore";
  const privatePlace =
    pathname === "zielarka/content.json" ||
    pathname.startsWith("zielarka/docs/") ||
    pathname.startsWith("zielarka/private/") ||
    pathname.startsWith("zielarka/journal/private/");
  if (!privatePlace) return "ignore";
  const sealed = Boolean(json && typeof json === "object" && (json as { sealed?: unknown }).sealed === 1);
  return sealed ? "sealed" : "plaintext-private";
}

export function draftImageUrls(doc: { entries?: { status?: string; image?: string }[] }) {
  const urls: string[] = [];
  for (const entry of doc.entries ?? []) {
    if (entry.status === "published") continue;
    if (typeof entry.image === "string" && entry.image.startsWith("https://")) urls.push(entry.image);
  }
  return urls;
}

export function migrationAllowed(backupOk: boolean, sealReady = false) {
  return Boolean(backupOk && sealReady);
}

export type MigrationStep = { pathname: string; action: "reseal-plaintext" | "seal-draft-image" };

/** Plan tylko do odczytu. Ta funkcja nigdy nie zapisuje i nie kasuje plików. */
export function migrationPlan(
  files: { pathname: string; json: unknown }[],
  backupOk: boolean,
  sealReady: boolean,
): { run: false; ready: boolean; reason: string; steps: MigrationStep[] } {
  if (!sealReady) {
    return { run: false, ready: false, reason: "Brak CMS_SEAL_KEY. Migracja nie ruszy.", steps: [] };
  }
  if (!backupOk) {
    return { run: false, ready: false, reason: "Najpierw potrzebna jest sprawdzona kopia. Migracja nie ruszy.", steps: [] };
  }
  const steps: MigrationStep[] = [];
  for (const file of files) {
    const kind = classifyLegacy(file.pathname, file.json);
    if (kind === "plaintext-private") steps.push({ pathname: file.pathname, action: "reseal-plaintext" });
    if (kind === "plaintext-private" || kind === "public") {
      const urls = draftImageUrls(file.json as { entries?: { status?: string; image?: string }[] });
      for (const url of urls) steps.push({ pathname: url, action: "seal-draft-image" });
    }
  }
  return {
    run: false,
    ready: true,
    reason: "Plan jest gotowy, ale nic nie zostało uruchomione. Stare pliki zostają do Twojej zgody.",
    steps,
  };
}

export const RESTORE_PHRASE = "PRZYWRÓĆ";

export function restoreAllowed(phrase: string) {
  return phrase.trim() === RESTORE_PHRASE;
}
