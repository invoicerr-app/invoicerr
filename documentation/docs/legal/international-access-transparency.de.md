---
title: Transparenz des internationalen Datenzugriffs
language: de
---

:::warning Entwurf
Entwurf — noch nicht anwaltlich geprüft.
:::

Diese Seite wird gemäß Artikel 28 der Verordnung (EU) 2023/2854 (der „Data Act“) veröffentlicht, der
einen Anbieter eines Datenverarbeitungsdienstes verpflichtet, öffentlich zugänglich zu machen (a) die
Rechtsordnungen, denen die zur Verarbeitung der Daten dieses Dienstes verwendete IKT-Infrastruktur
unterliegt, und (b) eine allgemeine Beschreibung der technischen, organisatorischen und vertraglichen
Maßnahmen, die er ergreift, um einen behördlichen Zugriff auf in der Union gespeicherte
nicht-personenbezogene Daten oder deren Übermittlung zu verhindern, wenn ein solcher Zugriff oder eine
solche Übermittlung im Widerspruch zum Recht der Union oder eines Mitgliedstaats stünde. Sie gilt nur
für das **gehostete Angebot** von Invoicerr — die
[Allgemeinen Geschäftsbedingungen (AGB)](./terms-of-service.md), Abschnitt 14.4, nehmen auf diese Seite
Bezug. Sie gilt nicht für die selbst gehostete Software, die uns niemals Daten übermittelt.

## 1. Rechtsordnungen

Die Infrastruktur, die die eigenen Daten des Dienstes verarbeitet — die Kontodaten Ihres Unternehmens
und Ihre Daten (die Dokumente, Geschäftsunterlagen und Konfigurationen, die Sie über den Dienst
erstellen) — befindet sich ausschließlich in **Frankreich**:

| Komponente | Anbieter | Rechtsordnung |
| --- | --- | --- |
| Anwendungs-/Kubernetes-Infrastruktur, verwaltete PostgreSQL-Datenbank und Objektspeicher für Dokumente | Scaleway SAS | Frankreich (Region Paris) |

Jede der oben genannten Komponenten liegt bei einem einzigen Anbieter, in einer einzigen Region, die
über das eigene private Netzwerk von Scaleway erreicht wird, statt über das öffentliche Internet — die
Datenbank ist kein separater Sprung mehr zu einem anderen Anbieter oder in ein anderes Land. Weder die
eigene Infrastruktur des Dienstes noch Ihre Daten werden außerhalb Frankreichs/der EU gehostet,
gespiegelt oder gesichert. Soweit ein in der
[Datenschutzerklärung](./privacy-policy.md), Abschnitt 4, und im
[Auftragsverarbeitungsvertrag (AVV)](./data-processing-agreement.md), Abschnitt 7, genannter
Unterauftragsverarbeiter (Polar für die Abonnementabrechnung, Resend für transaktionale E-Mails,
Cloudflare und Google LLC für eingehende Support-Korrespondenz) ein Unternehmen außerhalb der EU ist
oder Daten außerhalb des EWR verarbeiten kann, beschränkt sich diese Verarbeitung auf
Konto-/Abrechnungsdaten oder Support-Korrespondenz — niemals auf Ihre Daten oder die über den Dienst
erstellten Dokumente — und stützt sich auf die eigenen Garantien dieses Anbieters nach Kapitel V der
DSGVO, wie in der Datenschutzerklärung, Abschnitt 5, beschrieben.

Zwei öffentliche, statische Websites — die Marketing-Website (`invoicerr.app`) und diese
Dokumentations-Website (`docs.invoicerr.app`) — werden auf **GitHub Pages** gehostet, betrieben von
GitHub, Inc. (USA, einer hundertprozentigen Tochtergesellschaft der Microsoft Corporation). Keine der
beiden Websites ist eine IKT-Infrastruktur, die Daten des Dienstes verarbeitet: wie sowohl das
[Impressum](./legal-notice.md), Abschnitt 3, als auch die Datenschutzerklärung, Abschnitt 10,
feststellen, erhält oder speichert GitHub niemals die über den Dienst erstellten Konto-, Abrechnungs-
oder Dokumentdaten — sondern lediglich den für die Auslieferung einer statischen Seite üblicherweise
erforderlichen Besucherverkehr. Sie werden hier der Vollständigkeit halber aufgeführt, nicht weil sie in
den von Artikel 28 erfassten Anwendungsbereich fielen.

## 2. Maßnahmen gegen unrechtmäßigen internationalen Zugriff

- **Datenresidenz durch Technikgestaltung.** Die eigene Datenbank und der Dokumentenspeicher des
  Dienstes werden ausschließlich in Frankreich, bei einem einzigen Anbieter, gehostet (Abschnitt 1
  oben) — eine bewusste Entscheidung, keine Standardeinstellung, die die Daten allein dadurch außerhalb
  der Reichweite jeder Zugriffsanfrage hält, die nicht über einen Rechtsweg der EU oder Frankreichs
  erfolgt.
- **Verschlüsselung bei der Übertragung.** Der gesamte Datenverkehr zum und vom Dienst wird durchgehend
  über TLS verschlüsselt und am Ingress mit einem automatisch ausgestellten und erneuerten Zertifikat
  (cert-manager / Let's Encrypt) terminiert — siehe `deploy/helm/invoicerr/templates/ingress.yaml`.
- **Verschlüsselung der Verbindungsdaten im Ruhezustand.** Die Zugangsdaten und Token, die der Dienst
  speichert, um Ihr Unternehmen mit einem Kanal oder einer Plattform eines Drittanbieters zu verbinden
  (ein E-Invoicing-Transportweg, ein OIDC-Anbieter, ein Signaturzertifikat, ein Webhook-Secret), werden
  vor dem Schreiben in die Datenbank mit AES-256-GCM im Ruhezustand verschlüsselt — siehe
  `backend/src/utils/secret-crypto.ts` — sodass eine bloße Kopie der Datenbank sie nicht offenlegt.
- **Zugriffskontrolle.** Der Zugriff auf die Daten eines Unternehmens innerhalb des Dienstes ist auf die
  eigenen Rollen dieses Unternehmens beschränkt (Owner/Admin/Mitglied); der Zugriff auf
  Produktionsinfrastruktur und -daten innerhalb unserer eigenen Organisation ist auf das beschränkt, was
  zum Betrieb und zur Unterstützung des Dienstes erforderlich ist, wie in der Datenschutzerklärung,
  Abschnitt 7, und im Auftragsverarbeitungsvertrag (AVV), Abschnitt 9, beschrieben.
- **Vertragliche Garantien mit Unterauftragsverarbeitern.** Jeder Unterauftragsverarbeiter ist
  vertraglich zu Datenschutzpflichten verpflichtet, die den im Auftragsverarbeitungsvertrag (AVV)
  enthaltenen Pflichten inhaltlich gleichwertig sind (Art. 28 Abs. 4 DSGVO) — siehe
  Auftragsverarbeitungsvertrag (AVV), Abschnitt 7 — und, soweit ein Unterauftragsverarbeiter Daten
  außerhalb des EWR verarbeiten darf, den Standardvertragsklauseln der Europäischen Kommission oder
  einer anderen Garantie nach Kapitel V der DSGVO entsprechen.
- **Kein dauerhafter oder automatisierter Zugriff für eine ausländische Behörde.** Wir gewähren keiner
  Regierung, Behörde oder einem Dritten dauerhaften, automatisierten oder heimlichen (Backdoor-)Zugriff
  auf die in Abschnitt 1 beschriebene Infrastruktur oder Datenbank. Jede Anfrage einer Behörde nach
  Ihren Daten müsste über ein rechtsverbindliches Instrument erfolgen, das nach EU-Recht oder
  französischem Recht anerkannt ist; andernfalls wird sie abgelehnt. Soweit uns dies rechtlich gestattet
  ist, werden wir das betroffene Unternehmen benachrichtigen, bevor wir als Reaktion auf eine solche
  Anfrage Daten offenlegen.

## 3. Aktualisierung dieser Seite

Diese Seite wird jedes Mal aktualisiert, wenn sich die Rechtsordnung der eigenen Infrastruktur des
Dienstes oder die oben beschriebenen Maßnahmen wesentlich ändern — dieselbe Verpflichtung, die die
[Allgemeinen Geschäftsbedingungen (AGB)](./terms-of-service.md), Abschnitt 20.1, für dieses Dokument
eingehen. Es handelt sich um Referenzmaterial: erreichbar unter `GET /api/legal/documents` wie jedes
dort aufgeführte Dokument, aber — wie das Impressum, der Auftragsverarbeitungsvertrag (AVV) und die
Cookies und Richtlinie zur zulässigen Nutzung — ist seine Annahme nie erforderlich, um den Dienst zu
nutzen.

## 4. Kontakt

Fragen zu dieser Seite können an **contact@invoicerr.app** gerichtet werden.
