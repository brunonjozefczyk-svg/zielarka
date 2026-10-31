# Polityka prywatności: stan roboczy

Aktualny szkic znajduje się w `src/lib/privacy-policy.ts` i jest renderowany przez
`/polityka-prywatnosci`. Flaga `ready` pozostaje `false`. Strona szkicu ma `noindex`;
link w stopce pojawia się dopiero po zatwierdzeniu. Analityka również wymaga tej flagi.

Przed zmianą `ready` właścicielka musi uzupełnić i zatwierdzić:
1. Pełne dane administratora i kontakt.
2. Cele, podstawy przetwarzania, retencję i prawa osób.
3. Dostawców (Vercel, SeoHost, Google, FormSubmit), umowy i transfery danych.
4. Rzeczywiste ustawienia GA4, cookies i sposób zarządzania zgodą.
5. Zasady Klubu działającego poza stroną, jeżeli mają być objęte tym dokumentem.

Nie traktować szkicu jako gotowej polityki. Nie deklarować szyfrowania i dostępności
kopii zapasowych bez osobnej weryfikacji. Pomiar dostarczenia formularza jest niedostępny.
