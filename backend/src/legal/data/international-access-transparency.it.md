---
title: Trasparenza sull'Accesso Internazionale
language: it
---

:::warning Bozza
Bozza — non ancora verificata da un legale.
:::

La presente pagina è pubblicata in conformità dell'articolo 28 del Regolamento (UE) 2023/2854 (il
"Data Act"), che impone a un fornitore di un servizio di trattamento dei dati di rendere pubblici (a)
le giurisdizioni cui è soggetta l'infrastruttura TIC utilizzata per trattare i dati di tale servizio, e
(b) una descrizione generale delle misure tecniche, organizzative e contrattuali che adotta per
impedire l'accesso governativo a dati non personali detenuti nell'Unione, o il loro trasferimento,
qualora tale accesso o trasferimento sia in contrasto con il diritto dell'Unione o di uno Stato membro.
Si applica esclusivamente all'**offerta ospitata** (hosted) di Invoicerr — i
[Termini di Servizio](./terms-of-service.md), Sezione 14.4, incorporano la presente pagina per
riferimento. Non si applica al software self-hosted, che non ci invia mai alcun dato.

## 1. Giurisdizioni

L'infrastruttura che tratta i dati propri del Servizio — i dati di account della Sua Azienda e i Suoi
Dati (i documenti, i dati commerciali e le configurazioni che crea tramite il Servizio) — si trova
esclusivamente in **Francia**:

| Componente | Fornitore | Giurisdizione |
| --- | --- | --- |
| Infrastruttura applicativa/Kubernetes, database PostgreSQL gestito e storage a oggetti dei documenti | Scaleway SAS | Francia (regione di Parigi) |

Ogni componente sopra indicato si trova presso un unico fornitore, in un'unica regione, raggiungibile
tramite la rete privata propria di Scaleway anziché tramite l'internet pubblico — il database non è più
un passaggio distinto verso un altro fornitore o un altro paese. Né l'infrastruttura propria del
Servizio né i Suoi Dati sono ospitati, replicati (mirror) o sottoposti a backup al di fuori di
Francia/UE. Laddove un sub-responsabile del trattamento indicato
nell'[Informativa sulla Privacy](./privacy-policy.md), Sezione 4, e nell'
[Accordo sul Trattamento dei Dati](./data-processing-agreement.md), Sezione 7 (Polar per la fatturazione
dell'abbonamento, Resend per le e-mail transazionali, Cloudflare e Google LLC per la corrispondenza di
supporto in entrata) sia un'entità extra-UE o possa trattare dati al di fuori dello SEE, tale
trattamento è limitato ai dati di account/fatturazione o alla corrispondenza di supporto — mai ai Suoi
Dati né ai documenti che crea tramite il Servizio — e si basa sulle garanzie proprie di tale fornitore
ai sensi del Capo V del GDPR, come descritto nell'Informativa sulla Privacy, Sezione 5.

Due siti web pubblici e statici — il sito di marketing (`invoicerr.app`) e questo sito di documentazione
(`docs.invoicerr.app`) — sono ospitati su **GitHub Pages**, gestito da GitHub, Inc. (USA, una
controllata al 100% di Microsoft Corporation). Nessuno dei due siti costituisce un'infrastruttura TIC
che tratta i dati del Servizio: come indicato sia nelle [Note Legali](./legal-notice.md), Sezione 3,
sia nell'Informativa sulla Privacy, Sezione 10, GitHub non riceve né conserva mai i dati di account,
fatturazione o documenti creati tramite il Servizio — bensì solo il traffico dei visitatori normalmente
necessario per servire una pagina statica. Sono elencati qui per completezza, non perché rientrino
nell'ambito di applicazione dell'articolo 28.

## 2. Misure contro l'accesso internazionale illecito

- **Residenza dei dati fin dalla progettazione.** Il database e l'archiviazione dei documenti propri
  del Servizio sono ospitati esclusivamente in Francia, presso un unico fornitore (Sezione 1 sopra) —
  una scelta, non un'impostazione predefinita, che di per sé tiene i dati fuori dalla portata di
  qualsiasi richiesta di accesso che non segua un canale legale dell'UE o francese.
- **Cifratura in transito.** Tutto il traffico da e verso il Servizio è cifrato end-to-end tramite TLS,
  con terminazione a livello di ingress mediante un certificato emesso e rinnovato automaticamente
  (cert-manager / Let's Encrypt) — vedere `deploy/helm/invoicerr/templates/ingress.yaml`.
- **Cifratura a riposo delle credenziali di connessione.** Le credenziali e i token che il Servizio
  memorizza per collegare la Sua Azienda a un canale o a una piattaforma di terzi (un trasporto di
  fatturazione elettronica, un provider OIDC, un certificato di firma, un segreto webhook) sono cifrati
  a riposo con AES-256-GCM prima di essere scritti nel database — vedere
  `backend/src/utils/secret-crypto.ts` — cosicché una semplice copia del database non li espone.
- **Cifratura dei backup.** Le copie di backup dei documenti e dei file conservati dal Servizio sono
  cifrate (AES-256-GCM) prima di lasciare la nostra infrastruttura, con una chiave che il fornitore di
  storage non detiene mai — vedere l'Accordo sul Trattamento dei Dati, Sezione 9 — cosicché una
  richiesta rivolta direttamente a tale fornitore, o una copia del bucket di backup stesso, raggiunge
  solo testo cifrato, mai i documenti.
- **Controllo degli accessi.** L'accesso ai dati di un'Azienda all'interno del Servizio è delimitato dai
  ruoli propri di tale Azienda (proprietario/amministratore/membro); l'accesso all'infrastruttura e ai
  dati di produzione all'interno della nostra organizzazione è limitato a quanto necessario per gestire
  e supportare il Servizio, come descritto nell'Informativa sulla Privacy, Sezione 7, e nell'Accordo sul
  Trattamento dei Dati, Sezione 9.
- **Garanzie contrattuali con i sub-responsabili del trattamento.** Ciascun sub-responsabile del
  trattamento è vincolato, per contratto, a obblighi di protezione dei dati sostanzialmente equivalenti
  all'Accordo sul Trattamento dei Dati (art. 28, par. 4, del GDPR) — vedere l'Accordo sul
  Trattamento dei Dati, Sezione 7 — e, laddove un sub-responsabile possa trattare dati al di fuori dello
  SEE, alle Clausole Contrattuali Standard della Commissione Europea o a un'altra garanzia prevista dal
  Capo V del GDPR.
- **Nessun accesso permanente o automatizzato per un'autorità straniera.** Non concediamo ad alcun
  governo, autorità o terzo un accesso permanente, automatizzato o backdoor all'infrastruttura o al
  database descritti nella Sezione 1. Qualsiasi richiesta dei Suoi Dati da parte di un'autorità pubblica
  dovrebbe essere effettuata mediante uno strumento giuridicamente vincolante riconosciuto dal diritto
  dell'UE o francese; in mancanza di ciò, essa viene respinta. Laddove siamo legalmente autorizzati a
  farlo, informeremo l'Azienda interessata prima di divulgare qualsiasi dato in risposta a tale
  richiesta.

## 3. Aggiornamento di questa pagina

Questa pagina viene aggiornata ogni volta che la giurisdizione dell'infrastruttura propria del Servizio,
o le misure sopra descritte, cambiano in modo sostanziale — lo stesso impegno assunto dai
[Termini di Servizio](./terms-of-service.md), Sezione 20.1, per tale documento. Si tratta di materiale
di riferimento: raggiungibile tramite `GET /api/legal/documents` come ogni documento ivi elencato, ma —
come le Note Legali, l'Accordo sul Trattamento dei Dati e la pagina Cookie e Politica di Utilizzo
Accettabile — la sua accettazione non è mai richiesta per utilizzare il Servizio.

## 4. Contatti

Eventuali domande su questa pagina possono essere inviate a **contact@invoicerr.app**.
