/** Set ready only after the owner has completed and approved every section. */
export const privacyPolicy = {
  ready: false,
  sections: [
    { title: "Administrator i kontakt", text: "Zielarka.pl prowadzi Sabina Józefczyk. Kontakt: kontakt@zielarka.pl. Przed publikacją należy potwierdzić pełne dane administratora oraz adres do kontaktu w sprawach ochrony danych." },
    { title: "Formularz kontaktowy", text: "Formularz przekazuje podane imię, adres email, temat i treść wiadomości do FormSubmit, w celu dostarczenia wiadomości na skrzynkę kontakt@zielarka.pl. Treść nie jest publikowana na stronie. Nie podawaj w formularzu zbędnych informacji o zdrowiu. Do uzupełnienia: podstawy przetwarzania, okres przechowywania, odbiorcy i warunki przetwarzania oraz transferu danych przez dostawców." },
    { title: "Statystyki odwiedzin", text: "Pomiar Google Analytics jest domyślnie wyłączony. Po jego uruchomieniu skrypt będzie ładowany dopiero po zgodzie. Odrzucenie zgody nie ładuje skryptu. Wycofanie zgody zatrzymuje pomiar i przeładowuje stronę po zapisaniu decyzji. Wybór jest przechowywany w pamięci przeglądarki. Pomiar nie obejmuje treści formularza ani edytora. Potwierdzone dostarczenie formularza nie jest obecnie mierzone. Do potwierdzenia przed uruchomieniem: ustawienia GA4, retencja, cookies, okres ważności zgody i zasady przekazywania danych." },
    { title: "Search Console", text: "Prywatny panel może odczytywać zagregowane raporty Google Search Console. Nie wymaga to skryptu śledzącego odwiedzających na stronie. Google może ukrywać rzadkie frazy i udostępniać wyniki z opóźnieniem." },
    { title: "Hosting, poczta i bezpieczeństwo", text: "W obsłudze strony i wiadomości uczestniczą Vercel, SeoHost, Google i FormSubmit. Przed publikacją należy potwierdzić zakres danych i logów u każdego dostawcy, okresy przechowywania, umowy oraz mechanizmy transferu danych. Ten szkic nie potwierdza stanu kopii zapasowych ani ich szyfrowania." },
    { title: "Prawa i pozostałe informacje", text: "Do uzupełnienia przez administratora przed publikacją: właściwe podstawy przetwarzania, opis przysługujących praw i sposobu ich wykonywania, organ nadzorczy, obowiązek lub dobrowolność podania danych, profilowanie oraz informacje o transferach poza EOG. Zasady Klubu Zielarskiego prowadzonego poza stroną wymagają osobnego potwierdzenia." },
  ],
};
