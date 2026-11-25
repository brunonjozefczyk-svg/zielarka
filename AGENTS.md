# Zielarka.pl

## Przygotowanie zmiany

Codex przygotowuje zmianę na osobnej gałęzi i otwiera pull request do `main`. W opisie podaje cel, zmienione pliki, wykonane sprawdzenia, wyniki oraz ograniczenia. W publicznym PR pomija dane prywatne i dostępowe.

* Przy samej dokumentacji sprawdza treść, odnośniki i `git diff --check`.
* Przy zmianie kodu uruchamia `npm run typecheck`, `npm run lint`, `npm test`, `npm run check:auth` i `npx vite build` (kompilacja samej aplikacji). Dla zmian interfejsu sprawdza zmieniony przebieg również na telefonie lub w emulacji mobilnej i podaje, której metody użył.
* Pełne `npm run build` uruchamia też `npm run db:migrate`. Codex wykonuje je wyłącznie w odizolowanym środowisku testowym lub w ramach zatwierdzonego wdrożenia. W PR wskazuje, które sprawdzenia faktycznie wykonał.

## Recenzja Groka (Romana)

Po przygotowaniu zmiany Codex oznacza PR jako gotowy do recenzji. Godzinna rutyna Romana pomija wersje robocze (draft). W zleceniu Codex podaje URL PR i stałe porównanie `https://github.com/brunonjozefczyk-svg/zielarka/compare/BASE_SHA...HEAD_SHA`, podstawiając pełne SHA obu rewizji.

> Romanie, sprawdź PR [URL], od bazy [pełny SHA] do [pełny SHA bieżącego HEAD]. Różnice [URL]. Cel i pliki [zakres]. Codex sprawdził [wyniki i ograniczenia]. Zweryfikuj zmianę samodzielnie i zapisz wynik w tym PR.

Roman dodaje jeden komentarz do PR dla sprawdzonej rewizji. Zastępuje pola w nawiasach i wybiera jeden z dwóch werdyktów:

```text
Audyt Romana (Grok Bot) – SHA [pełny SHA sprawdzonego HEAD]
Werdykt: [ZAAKCEPTOWANE albo DO POPRAWY]
Ustalenia: [ważność, plik, linia, problem i proponowana poprawka albo „brak uwag”]
Sprawdzenia i ograniczenia: [co sprawdzono, z jakim wynikiem, czego nie potwierdzono]
```

Każdy nowy commit unieważnia poprzedni werdykt dla aktualnej wersji PR. Po poprawkach Codex podaje nowy pełny SHA, aktualną bazę i link do różnic, po czym ponawia zlecenie. Do decyzji o wdrożeniu przedstawia werdykt dla bieżącego HEAD wraz z linkiem do komentarza.

## Publikacja i cofnięcie zmiany

Roman ocenia kod. Publiczne wdrożenie zatwierdza osobno Brunon (Bruno) w zaufanym czacie, wskazując pełny SHA ocenionej rewizji. Scalenie do `main` może uruchomić produkcyjne wdrożenie Vercela także po zmianie dokumentacji. Codex czeka z takim scaleniem na tę zgodę. Szczegóły reguły pomijania wdrożeń (Ignored Build Step) są w ustawieniach Vercela.

Przed publikacją Codex ustala, które wdrożenie rzeczywiście obsługuje `zielarka.pl`, zapisuje jego identyfikator i porównuje zakres zmian, w tym używaną na produkcji faviconę. Sam stan `main` nie potwierdza wersji domeny ani wyglądu ikony.

Przed zmianą danych lub migracją Codex potwierdza aktualną kopię obejmującą zmieniane dane i sposób jej odtworzenia. Sam harmonogram zadań nie potwierdza wykonania kopii. Aby cofnąć wersję strony, można przywrócić wskazane wcześniejsze wdrożenie w Vercelu albo przygotować `git revert` i opublikować poprawkę po zatwierdzeniu. Cofnięcie wersji aplikacji pozostawia zapisane dane i migracje w ich bieżącym stanie. Jeśli wymagają odtworzenia, trzeba osobno przywrócić właściwe dane z kopii lub zastosować sprawdzoną migrację odwracającą.
