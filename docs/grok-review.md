# Instrukcja niezależnego przeglądu dla Groka

Przejmij rolę niezależnego recenzenta zmian Codex w PR #2:
https://github.com/brunonjozefczyk-svg/zielarka/pull/2

Nie zakładaj, że implementacja albo raport autora są poprawne. Poprawki Codex
zostały przygotowane lokalnie. Zapis przez połączenie GitHub zwrócił 403, więc
sam PR nie zawiera jeszcze tych poprawek. Użyj dołączonego pliku
`zielarka-pr2-poprawki.patch`: utwórz osobną lokalną gałąź na commicie
`3a7820fb14380ef3bf25a0601cc6121b7b60d491`, wykonaj `git apply --check`
i zastosuj patch lokalnie. Nie nadpisuj cudzych zmian. Jeżeli patch został już
wgrany do PR, potwierdź jego obecność w kodzie i zapisz sprawdzane SHA.
Porównaj wynik z powyższą bazą sprzed poprawek Codex.
PR #2 prowadzi do `optymalizacja-szybkosc`; PR #1 prowadzi dopiero do `main`.
Przeczytaj `docs/analityka-wdrozenie.md`, `docs/analityka-weryfikacja.md` oraz kod.

Nie scalaj PR, nie publikuj produkcji ani podglądu, nie uruchamiaj migracji,
nie zmieniaj ustawień kont Google i nie odczytuj/zapisuj treści magazynów Blob.
Nie ujawniaj sekretów. Nie usuwaj blokady automatycznych wdrożeń z vercel.json.
Najpierw przedstaw niezależny przegląd; poprawki proponuj jako osobny diff.

Sprawdź szczególnie:
1. Czy podpisana sesja statystyk naprawdę oszczędza operacje Blob po uwierzytelnieniu,
   wygasa, reaguje na zmianę klienta/hasła/sekretu i nie daje prawa zapisu CMS.
   Czy brak STATS_SESSION_SECRET zachowuje zwykłą bramkę i limiter? Nie podpisywać
   sesji samym hasłem użytkownika. Oceń pozostałe ryzyko limitera przy awarii Blob.
2. Brak pomiaru przed zgodą, po odmowie, przy cofnięciu, w innych kartach i po błędzie
   localStorage. Sprawdź przypadek nieudanego zapisu odmowy oraz ponownego wejścia.
3. Czy page_location, page_referrer, tytuł i zdarzenia nie ujawniają parametrów URL,
   treści formularza ani prywatnych danych? Oceń skutki pustego referrera dla źródeł.
4. Czy ręczne odsłony nie dublują się, czy automatyczne zdarzenia GA4 muszą być
   wyłączone w koncie oraz czy wymagane flagi są uczciwie opisane? Czy edytor
   jest wyłączony również przy przejściu z publicznej strony i po cofnięciu historii?
5. Czy Preview i localhost pozostają bez pomiaru produkcyjnego? Czy `ready: false`
   rzeczywiście blokuje analitykę niezależnie od samego identyfikatora pomiaru?
6. GSC bez GA4_PROPERTY_ID, sc-domain, prefiks URL, właściwe strefy czasowe,
   brakujące dane, błędy 401/403/429 i niepełne bieżące okresy.
7. Pełny roczny zakres, sortowanie serii, ograniczone rankingi fraz i podstron.
8. Czy form_success jest wyraźnie niedostępny i formularz nadal działa bez zmiany
   dostarczania wiadomości? Nie uznawaj ?wyslane=1 za dowód dostawy.
9. Rozdzielenie klient/serwer, brak sekretów w publicznych plikach, regresje edytora,
   formularza, obecnego logo, SSR i SEO odziedziczonych z PR #1.
10. Szkic polityki: nie traktować go jako gotowego dokumentu prawnego ani nie ustawiać
    ready=true bez uzupełnienia treści i zatwierdzenia Sabiny.

Uruchom `npx tsc --noEmit`, `npx vite build`, `npm test` i test przeglądarkowy
`node scripts/analytics-browser-check.mjs`. NIE używaj `npm run build`, ponieważ
zawiera migrację. Harness przeglądarkowy używa zastępczego transportu Google:
nie jest dowodem poprawnego ustawienia rzeczywistego konta GA4. Sprawdź osobno
pozostały zestaw testów auth/app-data, jeżeli npm test zatrzyma się wcześniej.

Odtwórz problemy również na bazowym commicie. Nie ukrywaj błędów testów i nie
uznawaj ich za regresję bez porównania. Nie przedstawiaj stubów jako testów live.
W razie braku dostępu do Google wymień dokładnie niewykonane sprawdzenia.

Raport po polsku:
1. Błędy według ważności, z plikiem, linią, sposobem odtworzenia i propozycją poprawki.
2. Wyniki testów oraz porównanie z bazą.
3. Brakujące konfiguracje i potwierdzenia.
4. Osobny werdykt: gotowość kodu do scalenia, panelu do odczytu raportów,
   publicznego pomiaru oraz całej strony do produkcji.
5. Lista bezpiecznych kroków i plan powrotu do poprzedniego deploymentu.

Na koniec potwierdź, że niczego nie scalono ani nie wdrożono. Nie twierdź, że
przegląd wykonałeś, jeśli nie miałeś dostępu do kodu aktualnego commita.
