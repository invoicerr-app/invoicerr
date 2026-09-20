---
title: Przejrzystość Międzynarodowego Dostępu
language: pl
---

:::warning Wersja robocza
Wersja robocza — jeszcze niezweryfikowana przez prawnika.
:::

Niniejsza strona jest publikowana zgodnie z art. 28 rozporządzenia (UE) 2023/2854 („Data Act”), który
nakłada na dostawcę usługi przetwarzania danych obowiązek podania do publicznej wiadomości (a)
jurysdykcji, którym podlega infrastruktura ICT wykorzystywana do przetwarzania danych tej usługi, oraz
(b) ogólnego opisu środków technicznych, organizacyjnych i umownych, jakie stosuje w celu zapobieżenia
dostępowi organów rządowych do danych nieosobowych przechowywanych w Unii lub ich przekazaniu, jeżeli
taki dostęp lub przekazanie byłyby sprzeczne z prawem Unii lub państwa członkowskiego. Ma zastosowanie
wyłącznie do **oferty hostowanej** Invoicerr — [Regulamin Świadczenia Usług](./terms-of-service.md),
sekcja 14.4, włącza niniejszą stronę przez odniesienie. Nie ma zastosowania do oprogramowania
self-hosted, które nigdy nie przesyła nam żadnych danych.

## 1. Jurysdykcje

Infrastruktura przetwarzająca własne dane Usługi — dane konta Twojej Firmy oraz Twoje Dane (dokumenty,
dane biznesowe i konfigurację tworzone przez Ciebie za pośrednictwem Usługi) — znajduje się wyłącznie we
**Francji**:

| Komponent | Dostawca | Jurysdykcja |
| --- | --- | --- |
| Infrastruktura aplikacyjna/Kubernetes, zarządzana baza danych PostgreSQL oraz obiektowa pamięć masowa dokumentów | Scaleway SAS | Francja (region Paryża) |

Każdy z powyższych komponentów znajduje się u jednego dostawcy, w jednym regionie, dostępnym poprzez
własną sieć prywatną Scaleway, a nie poprzez publiczny internet — baza danych nie jest już odrębnym
ogniwem u innego dostawcy ani w innym kraju. Ani własna infrastruktura Usługi, ani Twoje Dane nie są
hostowane, replikowane (mirror) ani archiwizowane (backup) poza Francją/UE. W zakresie, w jakim dalszy
podmiot przetwarzający wskazany w
[Polityce Prywatności](./privacy-policy.md), sekcja 4, oraz w
[Umowie Powierzenia Przetwarzania Danych](./data-processing-agreement.md), sekcja 7 (Polar w zakresie
rozliczeń subskrypcji, Resend w zakresie transakcyjnej poczty e-mail, Cloudflare i Google LLC w zakresie
przychodzącej korespondencji wsparcia) jest podmiotem spoza UE lub może przetwarzać dane poza EOG,
przetwarzanie to jest ograniczone do danych konta/rozliczeniowych lub korespondencji wsparcia — nigdy do
Twoich Danych ani dokumentów tworzonych przez Ciebie za pośrednictwem Usługi — i opiera się na własnych
zabezpieczeniach takiego dostawcy zgodnie z rozdziałem V RODO, opisanych w Polityce Prywatności,
sekcja 5.

Dwie publiczne, statyczne strony internetowe — strona marketingowa (`invoicerr.app`) oraz niniejsza
strona dokumentacji (`docs.invoicerr.app`) — są hostowane na **GitHub Pages**, obsługiwanym przez
GitHub, Inc. (USA, spółkę zależną w całości należącą do Microsoft Corporation). Żadna z tych stron nie
stanowi infrastruktury ICT przetwarzającej dane Usługi: jak wskazano zarówno w
[Nocie Prawnej](./legal-notice.md), sekcja 3, jak i w Polityce Prywatności, sekcja 10, GitHub nigdy nie
otrzymuje ani nie przechowuje danych konta, rozliczeniowych ani danych z dokumentów tworzonych za
pośrednictwem Usługi — a jedynie ruch odwiedzających zwykle niezbędny do obsługi strony statycznej. Są
tu wymienione dla kompletności, a nie dlatego, że mieszczą się w zakresie objętym art. 28.

## 2. Środki przeciwko bezprawnemu dostępowi międzynarodowemu

- **Rezydencja danych uwzględniona już w fazie projektowania.** Własna baza danych i przechowywanie
  dokumentów Usługi są hostowane wyłącznie we Francji, u jednego dostawcy (sekcja 1 powyżej) — jest to
  świadomy wybór, a nie ustawienie domyślne, który sam w sobie utrzymuje dane poza zasięgiem
  jakiegokolwiek żądania dostępu, które nie przebiega odpowiednią drogą prawną UE lub Francji.
- **Szyfrowanie podczas przesyłania.** Cały ruch do i z Usługi jest szyfrowany end-to-end za pomocą TLS,
  z zakończeniem na poziomie ingress przy użyciu certyfikatu wystawianego i odnawianego automatycznie
  (cert-manager / Let's Encrypt) — zob. `deploy/helm/invoicerr/templates/ingress.yaml`.
- **Szyfrowanie w spoczynku danych uwierzytelniających do połączeń.** Poświadczenia i tokeny
  przechowywane przez Usługę w celu połączenia Twojej Firmy z kanałem lub platformą podmiotu trzeciego
  (transport e-fakturowania, dostawca OIDC, certyfikat podpisu, sekret webhooka) są szyfrowane w
  spoczynku za pomocą AES-256-GCM przed zapisaniem w bazie danych — zob.
  `backend/src/utils/secret-crypto.ts` — dzięki czemu sama kopia bazy danych ich nie ujawnia.
- **Szyfrowanie kopii zapasowych.** Kopie zapasowe dokumentów i plików przechowywanych przez Usługę są
  szyfrowane (AES-256-GCM), zanim opuszczą naszą infrastrukturę, za pomocą klucza, którego dostawca
  magazynu nigdy nie posiada — zob. Umowa Powierzenia Przetwarzania Danych, sekcja 9 — dzięki czemu
  żądanie skierowane bezpośrednio do tego dostawcy, lub kopia samego magazynu kopii zapasowych,
  dociera wyłącznie do zaszyfrowanego tekstu, nigdy do dokumentów.
- **Kontrola dostępu.** Dostęp do danych danej Firmy w ramach Usługi jest ograniczony rolami
  przypisanymi w tej Firmie (właściciel/administrator/członek); dostęp do infrastruktury produkcyjnej i
  danych w ramach naszej własnej organizacji jest ograniczony do zakresu niezbędnego do obsługi i
  wsparcia Usługi, zgodnie z opisem w Polityce Prywatności, sekcja 7, oraz w Umowie Powierzenia
  Przetwarzania Danych, sekcja 9.
- **Zabezpieczenia umowne z dalszymi podmiotami przetwarzającymi.** Każdy dalszy podmiot przetwarzający
  jest umownie zobowiązany do przestrzegania obowiązków w zakresie ochrony danych zasadniczo
  równoważnych Umowie Powierzenia Przetwarzania Danych (art. 28 ust. 4 RODO) — zob. Umowa
  Powierzenia Przetwarzania Danych, sekcja 7 — oraz, w zakresie, w jakim dalszy podmiot przetwarzający
  może przetwarzać dane poza EOG, standardowym klauzulom umownym Komisji Europejskiej lub innemu
  zabezpieczeniu przewidzianemu w rozdziale V RODO.
- **Brak stałego lub zautomatyzowanego dostępu dla zagranicznego organu.** Nie przyznajemy żadnemu
  rządowi, organowi ani podmiotowi trzeciemu stałego, zautomatyzowanego ani ukrytego (backdoor) dostępu
  do infrastruktury lub bazy danych opisanych w sekcji 1. Jakiekolwiek żądanie udostępnienia Twoich
  Danych ze strony organu publicznego musiałoby zostać złożone za pomocą prawnie wiążącego instrumentu
  uznawanego na mocy prawa UE lub prawa francuskiego; w przeciwnym razie zostanie odrzucone. Jeżeli
  będzie to prawnie dozwolone, powiadomimy zainteresowaną Firmę przed ujawnieniem jakichkolwiek danych w
  odpowiedzi na takie żądanie.

## 3. Aktualizacja tej strony

Ta strona jest aktualizowana za każdym razem, gdy jurysdykcja własnej infrastruktury Usługi lub środki
opisane powyżej ulegają istotnej zmianie — to samo zobowiązanie, jakie
[Regulamin Świadczenia Usług](./terms-of-service.md), sekcja 20.1, przyjmuje w odniesieniu do tego
dokumentu. Jest to materiał o charakterze informacyjnym: dostępny pod adresem
`GET /api/legal/documents`, podobnie jak każdy wymieniony tam dokument, jednak — podobnie jak Nota
Prawna, Umowa Powierzenia Przetwarzania Danych oraz Polityka dotycząca Plików Cookie i Dopuszczalnego
Użytkowania — jego akceptacja nigdy nie jest wymagana do korzystania z Usługi.

## 4. Kontakt

Pytania dotyczące tej strony można kierować na adres **contact@invoicerr.app**.
