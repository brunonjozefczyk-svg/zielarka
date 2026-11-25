# Zielarka.pl

## Przygotowanie zmiany

Codex przygotowuje zmianę na osobnej gałęzi i otwiera pull request do `main`. W opisie podaje cel, zmienione pliki, wykonane sprawdzenia, wyniki oraz ograniczenia. Na obecnym etapie zakres obejmuje stronę i SEO, w tym dostępność i szybkość. Warsztaty, formularze, zapisy, obsługa klientów i odpowiadanie na ich opinie wymagają osobnego zlecenia Brunona.

Zielnik (`/zielnik` i karty roślin) pozostaje online w obecnej wersji. Codex, Roman i Melodia pomijają go w pracach, zaleceniach, celach indeksacji, szczegółowych pomiarach, audytach i alertach. Przy zmianach innych stron zachowują jego treść, linki, wpisy w mapie witryny i ustawienia indeksowania. Podczas audytów nie odwiedzają celowo Zielnika ani kart roślin. Zbiorcze dane całej domeny mogą je obejmować. Ewentualna decyzja o usunięciu należy do Brunona. Do czasu jego osobnego polecenia zespół nie przygotowuje ani nie wykonuje usunięcia.

Repozytorium jest publiczne. Codex i Melodia podają w opisach, komentarzach i plikach wyłącznie informacje przeznaczone do publikacji. Prywatne dane właściciela i klientów oraz pomiary Google Search Console i GA4 przeznaczone są do prywatnego raportu dla Brunona. Dane dostępowe pozostają w odpowiednim magazynie sekretów.

Przed pierwszym wypchnięciem nowej gałęzi Codex sprawdza reguły wdrożeń dla jej nazwy w `vercel.json` i, gdy ma powstać podgląd, efektywną konfigurację Vercela. Wybiera gałąź z wyłączonym automatycznym wdrażaniem albo potwierdza, że podgląd i jego build są odizolowane od produkcji, w tym od bazy, magazynów i migracji produkcyjnych.

* Przy samej dokumentacji sprawdza treść, odnośniki i `git diff --check`.
* Przy zmianie kodu uruchamia `npm run typecheck`, `npm run lint`, `npm test`, `npm run check:auth` i `npx vite build` (kompilacja samej aplikacji). Dla zmian interfejsu sprawdza zmieniony przebieg również na telefonie lub w emulacji mobilnej i podaje, której metody użył.
* Pełne `npm run build` uruchamia też `npm run db:migrate`. Codex wykonuje je wyłącznie w odizolowanym środowisku testowym lub w ramach zatwierdzonego wdrożenia. W PR wskazuje, które sprawdzenia faktycznie wykonał.

## Współpraca przy stronie i SEO

Brunon udzielił stałej zgody na współpracę Codex, Romana i Melodii w całym bieżącym zakresie strony i SEO. Każde z nich może rozpocząć konsultację z własnej inicjatywy. W głównej prywatnej rozmowie danego bota zgłoszenie „Do zespołu” zawiera jedno konkretne, zanonimizowane pytanie lub wniosek. Codex przekazuje je do właściwej prywatnej rozmowy i pośredniczy w wymianie ogólnych metod, zanonimizowanych pytań technicznych, sposobów i wyników testów, wniosków oraz rozbieżnych ocen. Taka wymiana nie wymaga kolejnej zgody Brunona.

Codex sprawdza, czy pytanie zostało już rozstrzygnięte, a odpowiedź i wynik przekazuje zgłaszającemu w rozmowie, z której pochodziło zgłoszenie. Zamyka wątek po wyjaśnieniu sprawy i wraca do niej dopiero po pojawieniu się nowych danych. Przy zwykłych zmianach konsultacja jest dobrowolna i nie ma obowiązkowej drugiej recenzji. Codex przygotowuje poprawki na osobnej gałęzi, a jedyny techniczny werdykt dla pełnego SHA Zielarki wydaje Melodia. Roman odpowiada za BruClean i doradza w sprawach ogólnych. Praca w repozytorium Zielarki i na jej danych pozostaje poza rolą Romana. W ramach zleceń w BruClean Melodia może pracować nad publiczną stroną i SEO, weryfikować rozwiązania techniczne, zbierać informacje i przygotowywać materiały robocze. Wyniki przekazuje prywatnie Romanowi przez Codex. Ogólna zgoda nie obejmuje kontaktu z klientami, publikacji ani nadawania dostępów. Oba projekty mają osobne rutyny SEO.

Każda firma zachowuje u siebie prywatne dane właściciela i klientów, pomiary Google Search Console i GA4, dane dostępowe (w tym tokeny) oraz uprawnienia do kont. Codex przekazuje między projektami wyłącznie zanonimizowane informacje i nie nadaje uprawnień do kont. Decyzję o publikacji podejmuje Brunon zgodnie z zasadami poniżej.

## Niezależna recenzja Melodii

Po przygotowaniu zmiany Codex oznacza PR jako gotowy do recenzji. Melodia jest audytorką Zielarka.pl w Groku. Jej rutyna ma co godzinę sprawdzać otwarte PR gotowe do recenzji i pomijać wersje robocze (draft) oraz SHA przydzielone głównej rozmowie. W zleceniu Codex wyznacza jednego wykonawcę dla pełnego SHA: główną rozmowę Melodii albo rutynę. Drugi kanał pomija ten SHA. Codex podaje URL PR i stałe porównanie `https://github.com/brunonjozefczyk-svg/zielarka/compare/BASE_SHA...HEAD_SHA`, podstawiając pełne SHA obu rewizji.

> Melodio, sprawdź PR [URL], od bazy [pełny SHA] do [pełny SHA bieżącego HEAD]. Różnice [URL]. Przydział [główna rozmowa Melodii albo rutyna]. Cel i pliki [zakres]. Codex sprawdził [wyniki i ograniczenia]. Zweryfikuj zmianę samodzielnie i zapisz wynik w tym PR.

W repozytorium Zielarki uprawnienia Melodii obejmują odczyt kodu i dowodów oraz dodanie komentarza w PR. Formalne zatwierdzanie recenzji, zamykanie i scalanie PR, push, wdrożenia, zmiany treści strony lub ustawień kont i wysyłanie formularzy są poza jej rolą. Werdykt ZAAKCEPTOWANE jest oceną techniczną.

Melodia zapisuje jeden werdykt na pełny SHA. Przed publikacją sprawdza przydział i istniejące komentarze. Codex weryfikuje pełny SHA oraz aplikację autora w metadanych GitHuba (`grok-by-xai`). Istniejący autentyczny werdykt Melodia przywołuje w rozmowie ze zlecającym. Ewentualne sprostowanie przekazuje w głównej rozmowie, bez edycji lub dodawania drugiego komentarza w PR dla tego SHA.

Przy dwóch sprzecznych werdyktach wersja nie jest przyjęta i nie może być podstawą publikacji. Codex przekazuje oba raporty jednemu wyznaczonemu wykonawcy do uzgodnionej ponownej oceny w głównej rozmowie. Gdy potrzebna jest zmiana, Codex przygotowuje nowy SHA i zleca jeden audyt tej rewizji.

W komentarzu Melodia zastępuje pola w nawiasach i wybiera jeden z dwóch werdyktów:

```text
Audyt Melodii (Grok Bot) – SHA [pełny SHA sprawdzonego HEAD]
Baza: [pełny SHA rewizji bazowej]
Werdykt: [ZAAKCEPTOWANE albo DO POPRAWY]
Ustalenia: [ważność, plik, linia, problem i proponowana poprawka albo „brak uwag”]
Sprawdzenia i ograniczenia: [co sprawdzono, z jakim wynikiem, czego nie potwierdzono]
```

Każdy nowy commit unieważnia poprzedni werdykt dla aktualnej wersji PR. Po poprawkach Codex podaje nowy pełny SHA, aktualną bazę i link do różnic, po czym ponawia zlecenie. Do decyzji o wdrożeniu przedstawia werdykt dla bieżącego HEAD wraz z linkiem do komentarza.

Historyczna [instrukcja przeglądu PR #2](https://github.com/brunonjozefczyk-svg/zielarka/blob/a076daa31e2e4ba7cdb0398d1915a21c19646021/docs/grok-review.md) opisuje tamten jednorazowy audyt. Nowe PR podlegają procedurze opisanej tutaj.

## Publikacja i cofnięcie zmiany

Melodia ocenia kod. Publiczne wdrożenie zatwierdza osobno Brunon (Bruno) w zaufanym czacie, wskazując pełny SHA ocenionej rewizji. Scalenie do `main` może uruchomić produkcyjne wdrożenie Vercela także po zmianie dokumentacji. Codex czeka z takim scaleniem na tę zgodę. Szczegóły reguły pomijania wdrożeń (Ignored Build Step) są w ustawieniach Vercela.

Przed publikacją Codex ustala, które wdrożenie rzeczywiście obsługuje `zielarka.pl`, zapisuje jego identyfikator i porównuje zakres zmian, w tym używaną na produkcji faviconę. Sam stan `main` nie potwierdza wersji domeny ani wyglądu ikony.

Przed zmianą danych lub migracją Codex potwierdza aktualną kopię obejmującą zmieniane dane i sposób jej odtworzenia. Sam harmonogram zadań nie potwierdza wykonania kopii. Aby cofnąć wersję strony, można przywrócić wskazane wcześniejsze wdrożenie w Vercelu albo przygotować `git revert` i opublikować poprawkę po zatwierdzeniu. Cofnięcie wersji aplikacji pozostawia zapisane dane i migracje w ich bieżącym stanie. Jeśli wymagają odtworzenia, trzeba osobno przywrócić właściwe dane z kopii lub zastosować sprawdzoną migrację odwracającą.
