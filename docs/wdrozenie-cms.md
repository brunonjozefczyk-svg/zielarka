# Wdrożenie CMS — kolejność

To nie jest nowa funkcja strony. Eksport tylko czyta magazyn. Nie uruchamiaj go, dopóki Vercel Blob jest wstrzymany.

Kopia z edytora nie wystarcza przed migracją: tworzy nowy zapis i nie zabiera starych plików `zielarka/docs/`. Ten skrypt zapisuje surowe pliki na dysk.

## Eksport

Na komputerze, w katalogu repozytorium, katalog kopii poza gitem:

```bash
BLOB_READ_WRITE_TOKEN='token-z-Vercel' node scripts/blob-export.mjs --out "$HOME/zielarka-kopia"
node scripts/blob-export.mjs --check --out "$HOME/zielarka-kopia"
```

Przerwane pobieranie wznawia się bez drugiej listy:

```bash
BLOB_READ_WRITE_TOKEN='token-z-Vercel' node scripts/blob-export.mjs --resume --out "$HOME/zielarka-kopia"
```

Token zostaje w środowisku. Nie wklejaj go do gita ani do czatu. Katalogu kopii nie commituj. Skrypt robi wyłącznie GET: jedna lista na 1000 plików, potem pobranie każdego pliku. Nie kasuje i nie nadpisuje magazynu. Pusta lista nie jest uznawana za kompletną kopię.

`--check` liczy SHA-256 lokalnie i nie rusza magazynu. Wynik ma być „Kopia lokalna jest kompletna”. Otwórz jeden plik z `files/zielarka/docs/` i jeden obraz z `files/zielarka/images/`. Nie wysyłaj tej kopii na GitHub.

## Po odblokowaniu magazynu

1. Eksport powyżej i `--check`.
2. `CMS_SEAL_KEY`: 32 losowe bajty w base64, typ sensitive, Production i Preview. Bez przedrostka `k2:`. Hasła edytora i tokenu Blob nie zmieniaj.
3. Mały test na osobnym magazynie, nie na produkcji i nie setkami zapisów.
4. Diagnostyka tylko do odczytu. Migracja wyłącznie, gdy wynik to `ready` albo `already`.
5. Osobne GO, potem wdrożenie PR #1 i utworzenie `current.json`. Starych plików nie kasować.
6. Sprawdzić artykuły, zdjęcia, edytor, kanoniczne adresy, mapę strony i `robots.txt`. Szkic nie może być w publicznym JSON.

Stare publiczne szkice zostają, dopóki kopia nie jest sprawdzona i nie ma osobnej zgody na zdjęcie im publicznego odczytu.

## Cofnięcie

Przed pierwszą publikacją w nowym formacie można wrócić do poprzedniego wdrożenia `main`. Stare dokumenty nadal są w magazynie. Nic nie kasować.

Po utworzeniu `current.json` nie wracać kodem do `main`. Stary kod nie czyta nowych dzienników. Wrócić do wdrożenia PR #1. Złą treść odtworzyć z kopii na dysku, nie przez kasowanie dzienników, zdjęć ani starych dokumentów.
