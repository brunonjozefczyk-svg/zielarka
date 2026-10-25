export type HerbFaq = { q: string; a: string };

export type Herb = {
  slug: string;
  name: string;
  latin: string;
  image: string;
  alt: string;
  season: string;
  part: string;
  habitat: string;
  seoTitle: string;
  seoDescription: string;
  note: string;
  lead: string;
  recognize: string;
  harvest: string;
  prepare: string;
  tradition: string;
  caution: string;
  faqs: HerbFaq[];
  related: string[];
};

export const herbs: Herb[] = [
  {
    slug: "pokrzywa",
    name: "Pokrzywa",
    latin: "Urtica dioica",
    image: "/images/nettle.webp",
    alt: "Świeże liście pokrzywy zwyczajnej (Urtica dioica) w porannym świetle",
    season: "wiosna — lato",
    part: "młode liście, ziele",
    habitat: "azotolubne stanowiska, ogrody, skraje lasów, żyzne rowy",
    seoTitle: "Pokrzywa — kiedy zbierać i jak robić napar | Zielarka",
    seoDescription:
      "Pokrzywa zwyczajna (Urtica dioica): rozpoznawanie, sezon zbioru, napar i zupa. Tradycyjne zastosowania i ostrożność — zielnik Sabiny Józefczyk.",
    note: "W tradycji polskiej pokrzywa wraca co wiosnę: zupy, napary, odżywianie po zimie. Roślina pospolita, a przy tym wymagająca szacunku — parzy, karmi i uczy uważności.",
    lead: "Pokrzywa zwyczajna to pierwsza wiosenna lekcja zielarstwa: parzy, karmi i nie udaje delikatnej. W polskiej kuchni i w słoiku wraca co roku, gdy ciało prosi o zieleń po zimie.",
    recognize:
      "Łodyga czworokątna, liście piłkowane, całe pokryte parzącymi włoskami. Pokrzywa zwyczajna (Urtica dioica) jest dwupienna — kwiatostany męskie i żeńskie na osobnych roślinach. Nie mylić z jasnotą, która nie parzy i ma wargowe kwiaty.",
    harvest:
      "Najlepsze są młode wierzchołki z wiosny, zanim pokrzywa wybuja i stwardnieje. Zbieraj w rękawiczkach, z dala od dróg i pryskania. Po przekwitnięciu liście robią się łykowate — wtedy zostaw roślinę. Susz szybko, cienką warstwą, w cieniu.",
    prepare:
      "Napar z suszu: łyżka na szklankę wrzątku, przykryć, 10 minut. Świeża pokrzywa do zupy, pesto albo omletu — parzenie ginie po kilku minutach w garnku. Nie gotuj jej godzinami. Nie mieszaj „na wszystko”: pokrzywa ma smak i charakter, nie jest tłem.",
    tradition:
      "W polskiej tradycji pokrzywa to wiosenne oczyszczenie stołu, nie cudowny detoks z reklamy. Zupy, szpinak z pokrzywy, napary po zimie. Ludowo łączono ją z odżywieniem i włosami — to historia użytku, nie obietnica efektu.",
    caution:
      "Świeża parzy. Osoby z chorobami nerek, na lekach moczopędnych albo z niskim ciśnieniem niech nie piją jej „kuracyjnie” na własną rękę. W ciąży — najpierw lekarz. Pokrzywa z pobocza drogi nie należy do kuchni.",
    faqs: [
      {
        q: "Kiedy zbierać pokrzywę na napar?",
        a: "Wiosną, młode wierzchołki, zanim roślina zakwitnie i stwardnieje. Późne lato nadaje się gorzej — liście są łykowate i gorzkie.",
      },
      {
        q: "Czy napar z pokrzywy można pić codziennie?",
        a: "W tradycji był sezonowym wsparciem, nie napojem na lata. Codzienne picie bez przerwy i bez kontekstu zdrowia nie jest rozsądne. Przy lekach i chorobach nerek — rozmowa z lekarzem.",
      },
      {
        q: "Czym pokrzywa różni się od jasnoty?",
        a: "Pokrzywa parzy i ma zwisające kwiatostany. Jasnota biaława wygląda podobnie z daleka, ale nie parzy i ma wyraźne, wargowe kwiaty. Zanim wrzucisz liść do garnka — pewność gatunku.",
      },
    ],
    related: ["krwawnik", "lipa"],
  },
  {
    slug: "rumianek",
    name: "Rumianek",
    latin: "Matricaria chamomilla",
    image: "/images/chamomile.webp",
    alt: "Kwiaty rumianku pospolitego (Matricaria chamomilla) z żółtym środkiem i białymi płatkami",
    season: "czerwiec — lipiec",
    part: "koszyczki kwiatowe",
    habitat: "pola, ugory, ogrody, nasłonecznione, lekkie gleby",
    seoTitle: "Rumianek pospolity — napar, zbiór i tradycja | Zielarka",
    seoDescription:
      "Rumianek pospolity (Matricaria chamomilla): jak rozpoznać, kiedy zbierać koszyczki, jak zaparzyć. Tradycyjny napar na brzuch i wieczór — zielnik Zielarka.pl.",
    note: "Jeden z najcichszych domowych sojuszników. W polskiej kuchni i apteczce od pokoleń: napar na uspokojenie brzucha i wieczoru. Delikatny, ale nie byle jaki.",
    lead: "Rumianek pospolity to najcichszy polski napar: jabłkowy zapach, żółty środek, białe płatki. Delikatny nie znaczy byle jaki — i nie każdy „rumianek” z supermarketu jest rumiankiem pospolitym.",
    recognize:
      "Koszyczek z wydrążonym, stożkowatym dnem — po przekrojeniu widać pustkę. Zapach jabłkowy. Rumianek pospolity (Matricaria chamomilla, syn. Chamomilla recutita) jest niższy i drobniejszy od rumianu właściwego. Płatki szybko odginają się w dół.",
    harvest:
      "Zbieraj w pełni rozwinięte koszyczki, w suche przedpołudnie, w czerwcu i lipcu. Nie zrywaj całych pędów — zostaw roślinę. Susz cienko, szybko, w cieniu: szary, stęchły rumianek nie ma czego szukać w słoiku.",
    prepare:
      "Napar: łyżeczka do łyżki suszu na szklankę, przykryć, 5–10 minut. Nie gotuj — gorzki i mdły. Do picia i do płukania. Świeżość suszu poznasz po zapachu: ma pachnieć ogrodem, nie kartonem.",
    tradition:
      "W polskich domach rumianek stał przy brzuchu, przy oku, przy niespokojnym wieczorze. To roślina codzienności, nie „herbatka na wszystko”. W tradycji szanowano jej łagodność — i nie zastępowano nią lekarza.",
    caution:
      "Osoby uczulone na astrowate (rumian, złocień, ambrozja) mogą źle znosić rumianek. Przy astmie i silnych alergiach — ostrożnie. W ciąży nie „na wszelki wypadek”. Napar z torebki bez zapachu to napój, nie praktyka.",
    faqs: [
      {
        q: "Jak odróżnić rumianek pospolity od rumianu?",
        a: "Rumianek pospolity ma wydrążone dno koszyczka i silny jabłkowy zapach. Rumian właściwy jest większy, dno pełne, zapach inny. Do naparu w polskiej tradycji idzie pospolity.",
      },
      {
        q: "Ile rumianku na szklankę?",
        a: "Zwykle łyżeczka do łyżki suszonych koszyczków na 200–250 ml wrzątku, pod przykryciem. Nie gotować. Czas: kilka do dziesięciu minut.",
      },
      {
        q: "Czy rumianek uspokaja?",
        a: "W tradycji pito go wieczorem i przy napiętym brzuchu. To doświadczenie pokoleń, nie recepta. Przy lęku, bezsenności, lekach — najpierw lekarz, nie kolejna filiżanka.",
      },
    ],
    related: ["melisa", "lipa"],
  },
  {
    slug: "krwawnik",
    name: "Krwawnik",
    latin: "Achillea millefolium",
    image: "/images/yarrow.webp",
    alt: "Białe baldachy krwawnika pospolitego (Achillea millefolium) na łące",
    season: "czerwiec — wrzesień",
    part: "ziele i kwiatostany",
    habitat: "łąki, przydroża, nasłonecznione skraje, uboższe gleby",
    seoTitle: "Krwawnik pospolity — łąka, zbiór i tradycja | Zielarka",
    seoDescription:
      "Krwawnik pospolity (Achillea millefolium): jak wygląda, kiedy zbierać, jaki ma smak. Tradycyjne zastosowania i przeciwwskazania — zielnik Zielarka.pl.",
    note: "Biały baldach na łące, gorzki w ustach. W ludowym zielarstwie krwawnik towarzyszył kobietom i ranom. Roślina o charakterze — nie do picia „bo ładna”.",
    lead: "Krwawnik pospolity stoi na łące jak biały baldach i smakuje gorzko. To nie kwiat do wazonu. W ludowym zielarstwie miał konkretną pracę — przy kobietach i przy skórze — i nie pije się go „bo ładny”.",
    recognize:
      "Baldach złożony z drobnych koszyczków, liście silnie podzielone, pierzaste — stąd millefolium, „tysiąc listków”. Zapach żywiczny, aromatyczny. Kwiaty zwykle białe, bywają różowe. Łatwo pomylić z innymi baldachami: zawsze sprawdź liść.",
    harvest:
      "Zbieraj ziele w pełni kwitnienia, od czerwca do września, z dala od jezdni. Ścinaj górną część pędu. Susz w pęczkach albo luzem, w cieniu i przeciągu. Gorzki, stęchły krwawnik z worka nie zastąpi własnego zbioru.",
    prepare:
      "Napar z ziela jest gorzki — tak ma być. Łyżeczka na szklankę, krótko, pod przykryciem. Nie słodzić „żeby zniknął smak”: gorzkie jest informacją. Krwawnik nie jest herbatką wieczorną w stylu rumianku.",
    tradition:
      "Nazwa mówi o krwi. W ludowej praktyce krwawnik był przy ranach i przy cyklu. Achillea — od Achillesa — to europejska pamięć o roślinie przyciętej do konkretu, nie do wellnessu. Szacunek oznacza: nie na wszystko, nie zawsze, nie bez wiedzy.",
    caution:
      "Nie w ciąży. Uczulenie na astrowate możliwe. Gorzki napar nie jest dla żołądka w ostrym stanie „na próbę”. Przy obfitych krwawieniach, lekach przeciwkrzepliwych albo hormonach — nie na własną rękę. Najpierw rozmowa, potem ziele.",
    faqs: [
      {
        q: "Czy krwawnik jest gorzki?",
        a: "Tak, i to cecha, nie wada. Napar ma być aromatyczny i gorzkawy. Jeśli smakuje jak nic, susz jest stary albo to nie krwawnik.",
      },
      {
        q: "Kiedy zbierać krwawnik pospolity?",
        a: "W pełni kwitnienia, zwykle od czerwca do września, w suchy dzień. Górne części pędów, czyste stanowisko, z dala od drogi.",
      },
      {
        q: "Czy krwawnik pije się przy miesiączce?",
        a: "W tradycji ludowej tak go łączono. To nie jest zalecenie medyczne. Przy bolesnym albo obfitym cyklu najpierw lekarz albo położna, nie samodzielna kuracja z łąki.",
      },
    ],
    related: ["pokrzywa", "szalwia"],
  },
  {
    slug: "lipa",
    name: "Lipa",
    latin: "Tilia cordata",
    image: "/images/linden.webp",
    alt: "Jasne kwiatostany lipy drobnolistnej (Tilia cordata) z podsadką",
    season: "czerwiec",
    part: "kwiatostany z podsadką",
    habitat: "aleje, parki, skraje lasów, stare ogrody — lipa drobnolistna i szerokolistna",
    seoTitle: "Kwiat lipy — kiedy zbierać i jak suszyć | Zielarka",
    seoDescription:
      "Kwiat lipy (Tilia cordata): krótki sezon w czerwcu, zbiór, suszenie i miodowy napar. Tradycja przy przeziębieniu — zielnik Sabiny Józefczyk.",
    note: "Kwiat lipy to polski czerwiec w słoiku. Słodki, miodowy napar, który babcie stawiały przy przeziębieniu. Zbiór krótki — sezon nie czeka.",
    lead: "Kwiat lipy to polski czerwiec w słoiku: krótki, pachnący, nie do odrobienia w sierpniu. Miodowy napar, który babcie stawiały przy przeziębieniu, zbiera się w kilka dni — sezon nie czeka.",
    recognize:
      "Kwiatostany zwisają na długiej podsadce, liść sercowaty, brzeg piłkowany. Lipa drobnolistna (Tilia cordata) kwitnie zwykle trochę później niż szerokolistna. Zapach niesie się nad aleją. Nie zbieraj z drzew przy ruchliwej drodze.",
    harvest:
      "Tylko w pełni kwitnienia, w suche przedpołudnie. Zrywaj kwiatostany z podsadką, nie gałęzie. Sezon trwa krótko — często tydzień, dwa. Susz cienką warstwą, szybko, w cieniu. Zbrązowiały, zgnieciony kwiat traci zapach i sens.",
    prepare:
      "Napar: łyżka suszu na szklankę, przykryć, 10 minut. Pachnie miodem i sianem. Pije się ciepły. Nie gotuj kwiatu — zrobi się płaski. Słoik trzymaj szczelnie, z dala od kuchni pełnej pary.",
    tradition:
      "W polskim domu kwiat lipy stał przy gorączce, kaszlu i zimowym wieczorze. To napar pocieszenia i potu, nie antybiotyk. Tradycja jest ciepła i konkretna: zbierz w czerwcu, ususz, miej na zimę. Reszta to marketing.",
    caution:
      "Osoby z chorobami serca i przy lekach na ciśnienie niech nie piją litrów „na pocenie” bez konsultacji. Silnie napotny napar nie jest dla odwodnionych dzieci „na wszelki wypadek”. Brudne drzewo przy spalinach — pomiń.",
    faqs: [
      {
        q: "Kiedy zbierać kwiat lipy w Polsce?",
        a: "Zwykle w czerwcu, gdy drzewo jest w pełni kwitnienia. Sezon jest krótki. Lipa szerokolistna często trochę wcześniej, drobnolistna później.",
      },
      {
        q: "Czy kwiat lipy pomaga na przeziębienie?",
        a: "W tradycji był naparem przy gorączce i zimowym osłabieniu. Wspiera pot i odpoczynek. Nie zastępuje leczenia. Przy duszności, wysokiej gorączce u dziecka, bólu w klatce — lekarz.",
      },
      {
        q: "Jak suszyć kwiat lipy, żeby nie zbrązowiał?",
        a: "Cienka warstwa, cień, przeciąg, bez słońca i bez folii. Nie zamykaj wilgotnego kwiatu w słoiku. Gotowy jest kruchy, jasny i mocno pachnie.",
      },
    ],
    related: ["rumianek", "melisa"],
  },
  {
    slug: "melisa",
    name: "Melisa",
    latin: "Melissa officinalis",
    image: "/images/tea.webp",
    alt: "Filiżanka naparu z liśćmi melisy lekarskiej i kwiatami rumianku",
    season: "lato",
    part: "liście i wierzchołki pędów",
    habitat: "ogrody, ziołowe rabaty, miejsca ciepłe i osłonięte — rzadko dziko w Polsce",
    seoTitle: "Melisa lekarska — napar, uprawa i uspokojenie | Zielarka",
    seoDescription:
      "Melisa lekarska (Melissa officinalis): cytrynowy zapach, zbiór liści, napar na wieczór. Czym różni się od mięty i herbaty z supermarketu — zielnik Zielarka.pl.",
    note: "Cytrynowy zapach, miękkie liście. Melisa uspokaja nerwy tam, gdzie herbata z supermarketu już nic nie robi. Rośnie chętnie — byle nie zagłuszyć jej miętą.",
    lead: "Melisa lekarska pachnie cytryną, zanim ją zerwiesz. To ogrodowa roślina wieczoru: miękkie liście, cichy napar, zero krzyku z etykiety „na stres”. Z supermarketu często dostajesz kurz. Z krzaczka — olejek.",
    recognize:
      "Liście jajowate, karbowane, miękkie, o wyraźnym cytrynowym zapachu po roztarciu. Kłos kwiatowy niepozorny, białawy. Melisa (Melissa officinalis) jest z rodziny jasnotowatych, jak mięta, ale nie pachnie miętą. Jeśli nie ma cytryny w palcach — to nie melisa.",
    harvest:
      "Zbieraj liście i wierzchołki przed pełnym kwitnieniem, w suchy dzień. Kilka pokosów w sezonie, jeśli krzak jest silny. Susz szybko — melisa łatwo czernieje i traci olejek. W ogrodzie sadź z dala od mięty, która ją zagłuszy.",
    prepare:
      "Napar krótki: łyżka świeżych albo łyżeczka suszu na szklankę, przykryć, 5–8 minut. Dłuższe parzenie robi się trawiaste. Świeża melisa jest lepsza niż stary susz. Wieczór, nie litr w ciągu dnia „dla nerwów”.",
    tradition:
      "W europejskim zielarstwie melisa od wieków stała przy niepokoju, sercu które „puka bez powodu” i trudnym zasypianiu. W polskim ogrodzie jest gościem z południa, który się przyjął. Tradycja mówi: zapach ma pracować. Bez zapachu nie ma rośliny.",
    caution:
      "Może nasilać senność przy lekach uspokajających i alkoholu. Przed zabiegiem, w ciąży, przy tarczycy — nie na własną rękę. Melisa nie leczy depresji. Jeśli sen i lęk trwają miesiącami, ziele jest tłem, nie terapią.",
    faqs: [
      {
        q: "Czym melisa różni się od mięty?",
        a: "Zapachem: cytryna, nie mentol. Liść melisy jest bardziej miękki i jajowaty. Mięta jest agresywniejsza w ogrodzie i w filiżance. Do wieczoru zwykle lepsza jest melisa.",
      },
      {
        q: "Dlaczego suszona melisa z sklepu nic nie pachnie?",
        a: "Olejek ulatnia się przy złym suszeniu i długim leżeniu. Szukaj liścia zielonego, silnie cytrynowego. Albo uprawiaj sama — to jedna z łatwiejszych roślin w donicy.",
      },
      {
        q: "Czy melisa pomaga na sen?",
        a: "W tradycji pito ją wieczorem przy niepokoju. Może być częścią rytuału. Przy bezsenności, apatii albo lęku uogólnionym potrzebna jest diagnoza, nie kolejny słoik.",
      },
    ],
    related: ["rumianek", "lipa"],
  },
  {
    slug: "szalwia",
    name: "Szałwia",
    latin: "Salvia officinalis",
    image: "/images/sage.webp",
    alt: "Szare, filcowate liście i fioletowe kwiaty szałwii lekarskiej (Salvia officinalis)",
    season: "cały sezon wegetacji",
    part: "liście",
    habitat: "słoneczne rabaty, przepuszczalna gleba, ogrody — pochodzenie śródziemnomorskie",
    seoTitle: "Szałwia lekarska — płukanka, liść i ostrożność | Zielarka",
    seoDescription:
      "Szałwia lekarska (Salvia officinalis): gorzkawy liść, płukanka do gardła, przyprawa. Kiedy zbierać i kiedy odłożyć — zielnik Sabiny Józefczyk.",
    note: "Gorzkawa, żywiczna, mocna. W tradycji płukanka do gardła i przyprawa do tłustych dań. Szałwia nie jest „herbatką na wszystko” — jest konkretna.",
    lead: "Szałwia lekarska jest gorzkawa, żywiczna i mocna. W kuchni kroimy ją do tłustego mięsa. W tradycji płuczemy nią gardło. Nie jest herbatką na wszystko i nie pije się jej litrami.",
    recognize:
      "Liście podłużne, szarozielone, filcowate, z wyraźnym unerwieniem. Zapach kamforowo-ziołowy. Kwiaty fioletowe, wargowe. Szałwia lekarska (Salvia officinalis) to krzewinka z ogrodu, nie szałwia łąkowa i nie „szałwia wróżebna” z internetu.",
    harvest:
      "Liście przez cały sezon wegetacji, najlepiej słoneczne przedpołudnie, zanim krzew mocno zakwitnie. Nie ogołacaj pędu. Susz szybko — szary liść ma zostać szary, nie czarny. Zimą w Polsce bywa kapryśna: sucho i słonecznie u korzenia.",
    prepare:
      "Płukanka: łyżeczka liścia na szklankę wrzątku, przykryć, 10 minut, ostudzić. Do picia — znacznie mniej i nie codziennie. W kuchni: świeży albo suszony liść do tłustych dań, nie do deseru. Smak ma być obecny, nie przytłoczyć talerza.",
    tradition:
      "Salvia — od salvare, ratować. W europejskiej tradycji szałwia była rośliną mędrców, gardła i stołu. W Polsce weszła do kuchni i do apteczki jako płukanka. Konkret, nie magia. Kto pije szałwię jak miętę, nie zrozumiał liścia.",
    caution:
      "Nie w ciąży, nie przy karmieniu, nie w dużych dawkach przez długi czas — olejek (tujon) nie jest niewinny. Przy padaczce, przy problemach z piersią, przy lekach — odłóż. Płukanka to nie to samo co picie. Dzieciom nie serwuj „dla odporności”.",
    faqs: [
      {
        q: "Czy szałwię się pije, czy tylko płucze gardło?",
        a: "W tradycji częściej płukanka i przyprawa niż codzienny napar. Picie mocnego wywaru przez tygodnie nie jest obyczajem, który warto kopiować.",
      },
      {
        q: "Czym szałwia lekarska różni się od szałwii łąkowej?",
        a: "Lekarska jest krzewinką o szarych, filcowatych liściach z ogrodu. Łąkowa (Salvia pratensis) to bylina z łąki, inny użytek. Do kuchni i płukanki — officinalis.",
      },
      {
        q: "Dlaczego szałwii nie poleca się w ciąży?",
        a: "Tradycja i skład olejku (m.in. tujon) każą ją odłożyć w ciąży i przy karmieniu. To nie roślina „na wszelki wypadek”. Wątpliwość — lekarz, nie internet.",
      },
    ],
    related: ["krwawnik", "rumianek"],
  },
];

export function getHerb(slug: string) {
  return herbs.find((herb) => herb.slug === slug);
}

export function relatedHerbs(herb: Herb) {
  return herb.related
    .map((slug) => getHerb(slug))
    .filter((item): item is Herb => Boolean(item));
}