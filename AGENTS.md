# Zielarka.pl

## Przygotowanie zmiany

Codex przygotowuje zmianę na osobnej gałęzi i otwiera pull request do `main`. W opisie podaje cel, zakres plików, wykonane sprawdzenia, ich wyniki i kwestie wymagające sprawdzenia. Do przeglądu samej dokumentacji wystarczą kontrola treści, odnośników oraz `git diff --check`.

## Niezależna recenzja

Codex przekazuje zadanie Grokowi (Romanowi) wraz z linkiem do PR, pełnym SHA rewizji bazowej i pełnym SHA sprawdzanej rewizji. Dołącza stały link do różnic `https://github.com/brunonjozefczyk-svg/zielarka/compare/BASE_SHA...HEAD_SHA`, zastępując oba symbole pełnymi identyfikatorami commitów.

Gotowa treść zlecenia po uzupełnieniu pól w nawiasach:

> Romanie, sprawdź niezależnie zmianę w [URL PR]. Baza [pełny SHA], sprawdzana rewizja [pełny SHA], różnice [URL]. Cel i zakres: [opis, pliki]. Codex wykonał [sprawdzenia i wyniki]. Sprawdź zgodność z celem, błędy i ryzyko regresji. Podaj sprawdzony SHA, ustalenia według ważności, wskazania plików i linii, wyniki własnych sprawdzeń i werdykt. Zaznacz, co pozostało niesprawdzone.

Codex zapisuje w PR stan recenzji. Sam opis PR jest przygotowaniem zlecenia. Po przekazaniu go recenzentowi Codex odnotowuje kanał lub link do zlecenia, a po otrzymaniu odpowiedzi zamieszcza raport bądź jego podsumowanie z odnośnikiem i sprawdzonym SHA. W publicznych materiałach pomija dane prywatne i dane dostępowe.

Po poprawkach Codex wypycha nowy commit, aktualizuje SHA i link do różnic, a następnie ponownie przekazuje aktualną wersję Romanowi. Jeśli w międzyczasie zmieniła się baza, aktualizuje również jej SHA i zakres porównania.

## Publikacja

Werdykt recenzenta dotyczy wskazanego commita. Publiczne wdrożenie wymaga odrębnej decyzji właściciela Zielarka.pl. Jeżeli scalenie uruchamia wdrożenie automatyczne, Codex czeka z nim na tę decyzję.
