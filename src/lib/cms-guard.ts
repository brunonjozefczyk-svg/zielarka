export type StampBlob = { pathname: string; url: string; uploadedAt: number };
export type AttemptRow = { count: number; until: number };
export type KeptBlob = { pathname: string; url: string; uploadedAt: number; revision: number };

export function toPublicDoc<T extends { entries: { status: string; image?: string }[]; images?: Record<string, string> }>(
  doc: T,
): T {
  const images = doc.images
    ? Object.fromEntries(
        Object.entries(doc.images).filter(([, value]) => typeof value === "string" && !value.startsWith("seal:")),
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
 * Koszt odczytu publicznego po 30 s pamięci. Kolejność listy Blob nie jest gwarantowana,
 * więc najwyższy numer wymaga pełnej listy. Suma i rewizja są w już pobranym dzienniku i dokumencie.
 * 100 i 1000 zapisów: 1 lista. 10 000 zapisów: 10 list. Do tego 2 odczyty treści.
 */
export function publicReadCost(saves: number, pageSize = 1000): { listRequests: number; documentRequests: number } {
  if (!Number.isInteger(saves) || saves < 0 || !Number.isInteger(pageSize) || pageSize < 1) {
    return { listRequests: 0, documentRequests: 0 };
  }
  if (saves === 0) return { listRequests: 0, documentRequests: 0 };
  return { listRequests: Math.ceil(saves / pageSize), documentRequests: 2 };
}

export const STORE_OUTAGE = "Magazyn treści jest chwilowo niedostępny. Zapis został zatrzymany. Nic nie zostało cofnięte.";

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
