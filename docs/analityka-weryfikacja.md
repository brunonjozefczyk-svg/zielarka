# Raport weryfikacji przed wdrożeniem

Data: 2026-10-31. Punkt odniesienia: `3a7820fb14380ef3bf25a0601cc6121b7b60d491`.
Raport dotyczy poprawek zapisanych wraz z tym plikiem. Nie jest zgodą na produkcję.

Poprawki są w lokalnym commicie i pliku `zielarka-pr2-poprawki.patch`.
Próba zapisu na GitHub przez integrację zwróciła 403 „Resource not accessible by
integration”; lokalny Git nie ma uwierzytelnienia. Zdalny PR nie został
zaktualizowany. Blokada automatycznych wdrożeń znajduje się w patchu i zacznie
obowiązywać po jego zapisaniu na gałęzi. Nie zmieniono ustawień projektu Vercel.

## Wyniki wykonanych sprawdzeń

| Sprawdzenie | Wynik |
| --- | --- |
| Instalacja zależności według lockfile (`npm ci`) | zakończona |
| `tsc --noEmit` | PASS |
| `vite build` bez migracji | PASS |
| Testy analityki | 19/19 PASS |
| Pierwsza grupa `npm test`, CMS i analityka | 62/62 PASS; baza 54/54 |
| Grupa testów skryptów | 190/199 PASS; dokładnie te same 9 błędów na bazie |
| Osobno auth i app-data, pomijane po błędzie poprzedniej grupy | 45/45 PASS |
| Izolowany test przeglądarkowy rzeczywistego komponentu zgód | PASS |
| Kontrola publicznego builda z trzema sztucznymi sekretami serwera | brak tych wartości w plikach statycznych |
| `git diff --check` | PASS |

Pełne `npm test` kończy się kodem 1. Nie przedstawiać go jako zaliczonego.
Błędy dotyczą brakujących zasobów szablonu `.grok`, AGENTS i app-env:

* `SKILL.md and AGENTS.md name the marker path and bound this script uses`
* `the sections that own the brand-task prohibition never affirm a wait`
* `SKILL.md tells the pass to self-check with the flag this CLI accepts`
* `the build side resolves the template's shipped app-env`
* `nitro middleware and its bundled assets exist`
* `the template ships auth off`
* `the wrapped command runs with the app env applied`
* `the CLI still runs when invoked through a symlinked path`
* `every hand-over the og skill prints is one this script accepts`

Nie usunięto testów ani nie osłabiono asercji. Przed scaleniem rozstrzygnąć,
czy przywrócić zasoby szablonu, czy osobno poprawić zakres tych testów.

Przeglądarka sprawdza odmowę i ponowne wejście, brak tagu przed zgodą, zgodę,
jedną odsłonę przy SPA, oczyszczanie URL, cofnięcie zgody, wyłączenie edytora,
cofnięcie w innej karcie i niedostępną pamięć localStorage. Transport Google jest
zastąpiony stubem. W środowisku audytu użyto Chromium headless shell przez
`TEST_CHROMIUM_PATH`. Nie jest to test całej wdrożonej aplikacji ani kont Google.

## Stan usług odczytany podczas przeglądu

W projekcie Vercel obecne były tylko nazwy: `EDITOR_PASSWORD`,
`BLOB_READ_WRITE_TOKEN`, `VITE_AUTH_ENABLED` (production, preview, development).
Nie pobierano ich jawnych wartości. Brakuje konfiguracji GA4/GSC, identyfikatora
pomiaru, flag aktywacji i `STATS_SESSION_SECRET` opisanych w instrukcji wdrożenia.

Oba powiązane magazyny Blob, produkcyjny i testowy, zwróciły
`billingState: suspended` i `usageQuotaExceeded: true` przy ponownym sprawdzeniu.
Odblokowanie limitu rozmowy nie potwierdza odblokowania Vercel Blob. Nie wykonywano
odczytów treści magazynów, zapisów, migracji ani zmian planu rozliczeniowego.

## Pozostałe blokady i kolejność

1. Niezależny przegląd kodu, w tym limitera przy awarii Blob i podpisanej sesji.
   Grok nie wykonał jeszcze tego przeglądu. Gotowa instrukcja: `grok-review.md`.
2. Wyjaśnić 9 błędów testów szablonu i sprawdzić gotowość PR #1, na którym opiera
   się PR #2. Zmiany PR #1 nie otrzymują automatycznie zatwierdzenia z tego audytu.
3. Przywrócić działanie Blob i potwierdzić kopię oraz możliwość odtworzenia danych.
4. Skonfigurować minimalne uprawnienia Google i zmienne serwera; osobno sprawdzić
   rzeczywisty odczyt GA4/GSC, strefy czasowe, limity, błędy i zgodność raportów.
5. Uzupełnić i zatwierdzić politykę prywatności. Obecnie `ready: false`, dokument
   jest szkicem, nie jest linkowany w stopce i publiczny pomiar pozostaje wyłączony.
   Po zatwierdzeniu `ready: true` automatycznie udostępni link w stopce.
6. Potwierdzić ustawienia ręcznych zdarzeń GA4 i wykonać test rzeczywistego transportu
   na zatwierdzonym środowisku, bez danych klientów. Sprawdzić także formularz,
   edytor, SEO i logo całej aplikacji. Nie wysyłano testowych wiadomości FormSubmit.
7. Dopiero po osobnej decyzji właściciela scalić w odpowiedniej kolejności,
   wdrożyć przy wyłączonym pomiarze, wykonać smoke test i zapisać punkt rollbacku.
   Aktywacja pomiaru wymaga wszystkich bramek z `analityka-wdrozenie.md` i nowego
   builda. Samo dodanie zmiennej nie zmienia już wdrożonych plików.

Werdykt: poprawki kodu przygotowane do niezależnego przeglądu. Panel nie ma jeszcze
potwierdzonego odczytu rzeczywistych danych, publiczny pomiar jest celowo wyłączony,
a gotowość całej strony do produkcji pozostaje zablokowana powyższymi punktami.
Nie scalono PR i nie wykonano wdrożenia w ramach tej pracy.
