# Analityka: konfiguracja i bezpieczne uruchomienie

PR #2 opiera się na nieopublikowanej gałęzi `optymalizacja-szybkosc` z PR #1.
Nie scalać ani nie wdrażać automatycznie w ramach tego przeglądu. `vercel.json`
wyłącza wdrożenia Git dla `analityka`, `codex/analityka-review` i `optymalizacja-szybkosc`.
Gałąź `main` zachowuje dotychczasowe ustawienia. Push tych gałęzi powinien pominąć podgląd; sprawdzić status
w Vercel po zapisie. Nie usuwać blokady bez zaplanowanego wdrożenia.

## Panel tylko do odczytu

W Google Cloud włączyć Google Analytics Data API i Search Console API.
Utworzyć konto usługi, nadać mu uprawnienia do odczytu właściwej usługi GA4
(rola Przeglądający) i odpowiedniej usługi Search Console. Nie potrzeba praw
administratora projektu ani właściciela witryny. Potwierdzić minimalny działający
poziom dostępu w rzeczywistym koncie Google.

Zmienne serwera, osobno dla każdego środowiska:
* `GA4_PROPERTY_ID`: numer usługi GA4; nie identyfikator G-...
* `GA4_CLIENT_EMAIL`: email konta usługi. Używany także dla GSC.
* `GA4_PRIVATE_KEY`: klucz PEM; obsługiwane rzeczywiste nowe linie i zapis `\n`.
* `GSC_SITE_URL`: dokładny istniejący identyfikator, np. `sc-domain:zielarka.pl`
  lub `https://zielarka.pl/`. Nie tworzyć drugiej usługi bez potrzeby.
* `EDITOR_PASSWORD`: istniejące hasło edytora; nie zmieniać w ramach instalacji.
* `STATS_SESSION_SECRET`: osobny losowy sekret o co najmniej 32 znakach, tylko na
  serwerze. Wymagany do ograniczenia operacji Blob przez krótką sesję. Bez niego
  odczyt nadal działa, ale każdy raport ponownie sprawdza hasło z limiterem.
  Nie używać ludzkiego hasła jako tego sekretu.

Nie publikować klucza JSON, `.env`, tokenów, haseł ani logów z danymi formularzy.
GSC działa bez GA4_PROPERTY_ID. GA4 działa bez GSC_SITE_URL. Brak konfiguracji
nie uruchamia zapytań do Google dla niedostępnej sekcji.

Pierwszy odczyt statystyk wymaga istniejącej bramki hasła z limiterem. Po sukcesie
panel otrzymuje podpisaną, pięciominutową zdolność odczytu, przechowywaną tylko
w pamięci komponentu i powiązaną z kluczem klienta oraz aktualnym hasłem serwera.
Nie uprawnia ona do zapisu CMS. Wygaśnięcie, zmiana klienta, rotacja hasła lub
nieprawidłowy podpis przywracają sprawdzenie hasła i limiter. Pierwsze/ponowne
uwierzytelnienie nadal korzysta z licznika Blob; rozwiązanie ogranicza operacje,
nie usuwa wszystkich zależności od Blob. Istniejący limiter przy awarii Blob
pozostaje ograniczony do pamięci instancji: to odziedziczone ryzyko do oceny przed
produkcją. Prawidłowe tokeny nie wykonują operacji Blob podczas odczytu raportów.

## Pomiar publiczny: domyślnie wyłączony

Samo ustawienie G-... nie uruchamia pomiaru. Wymagane jednocześnie:
1. Uzupełniona i zaakceptowana polityka w `src/lib/privacy-policy.ts`, `ready: true`.
2. `VITE_GA_MEASUREMENT_ID` dla właściwego strumienia.
3. `VITE_ANALYTICS_ENABLED=true`.
4. `VITE_GA_MANUAL_EVENTS_CONFIRMED=true`, dopiero po sprawdzeniu ustawień niżej.
5. Dokładny origin `https://zielarka.pl` oraz publiczna ścieżka z listy dozwolonej.
6. Zgoda odwiedzającego.

W GA4 wyłączyć pomiar zaawansowany (w tym odsłony przy zmianie historii,
wyszukiwanie, formularze i automatyczne kliknięcia), aby nie omijał kontroli danych
oraz nie dublował własnych zdarzeń. Wyłączyć Google Signals, personalizację reklam
oraz wszelkie dodatkowe tagi; nie instalować równolegle GTM/gtag.
Ustawić strefę GA4 na Europe/Warsaw albo dostosować daty aplikacji do rzeczywistej
strefy. GSC używa America/Los_Angeles. Różnice dni i opóźnienia są oczekiwane.

Zweryfikować efektywne ustawienia konta i faktyczne żądania Google przed ustawieniem
flagi potwierdzenia. Flaga jest blokadą organizacyjną, nie dowodem konfiguracji GA4.
`page_referrer` jest celowo pusty, tytuł stały, a URL bez query/hash. To ogranicza
atrybucję poleceń i kampanii. Nie przywracać pełnych parametrów dla lepszych raportów.
Preview na domenach Vercel i localhost nie ładuje pomiaru nawet z produkcyjnym ID.
Testy komponentu korzystają z izolowanego harnessu i zastępczego transportu.

Po odmowie nie jest ładowany tag. Po wycofaniu zgody ustawiany jest ga-disable,
usuwane dostępne cookies _ga, blokowana lokalna kolejka i przeładowywany dokument.
Przy błędzie zapisu opt-out pozostaje skuteczny dla bieżącego dokumentu; interfejs
informuje o problemie. Przed ponownym wczytaniem trzeba naprawić pamięć przeglądarki,
bo poprzednia utrwalona zgoda może nadal istnieć. Zmiany w innych kartach i powrót
karty na pierwszy plan ponownie sprawdzają zapisany wybór.

## Formularz i raporty

Nie zmieniono transportu FormSubmit ani nie wysłano testowych wiadomości.
`form_start` oznacza tylko próbę wysłania zaakceptowaną przez lokalną walidację;
`form_success` jest w interfejsie niedostępny. Nie traktować URL podziękowania jako
potwierdzenia dostawy. Integracja potwierdzenia wymaga osobnego, przetestowanego
przepływu backendowego i nie jest częścią tej zmiany.

Serie dzienne: do 367 dni, jawne sortowanie po dacie; zakresy obejmujące bieżący dzień
są oznaczane jako niepełne. Listy podstron, źródeł i fraz nadal są ograniczonymi
rankingami. Wzrosty/spadki dotyczą tylko pobranej próby, a brak wiersza nie oznacza zera.

## Testy przed scaleniem

1. `npm ci` zgodnie z lockfile, `npx tsc --noEmit`, `npx vite build`, `npm test`.
   Nie uruchamiać `npm run build` podczas audytu: skrypt zawiera migrację.
2. `node --import jiti/register --test src/lib/analytics.test.ts`.
3. `node scripts/analytics-browser-check.mjs` po `npx playwright install chromium`.
   Opcjonalnie `TEST_CHROMIUM_PATH` wskazuje zainstalowany Chromium. Harness izoluje
   komponent zgód od CMS i zastępuje Google stubem. Nie potwierdza działania konta Google.
4. W zatwierdzonym środowisku testowym: rzeczywista odmowa/zgoda/cofnięcie,
   zmiana kart, SPA, edytor, brak danych prywatnych w żądaniach, brak podwójnych
   odsłon. Osobna usługa Google do testów, bez danych klientów.
5. Panel: błędne hasło, token podmieniony/wygasły, brak zmiennych, 401/403/429,
   zakres roku, GSC bez GA4; porównanie liczb z konsolami Google.
6. Sprawdzić końcowy diff względem PR #1, aktualne logo, SEO, formularz i edytor;
   osobno zatwierdzić gotowość magazynu i kopii przed publikacją całej gałęzi.

## Wycofanie

Przed publikacją zanotować zatwierdzony poprzedni deployment produkcji oraz commit.
Przy problemie wycofać routing do tego deploymentu. Samo usunięcie VITE_ nie zmienia
już zbudowanych plików: awaryjne wyłączenie wymaga poprzedniego builda albo nowego
builda z pomiarem wyłączonym. Te poprawki nie wymagają migracji ani modyfikacji danych.
Nie scalać PR #1 do main, nie promować podglądu ani produkcji i nie ustawiać CMS_SEAL_KEY bez kolejnej decyzji właściciela. PR #2 do `optymalizacja-szybkosc` nie jest wdrożeniem strony.
