# TODO_FEATURES — fonctionnalités manquantes vs. concurrents (2026-09-10)

> Tâche d'ANALYSE uniquement (aucun code touché). Méthode : §1 est reconstruit à 100 % depuis le
> code (modules `backend/src/modules/`, écrans `frontend/src/pages/`, specs `e2e/cypress/e2e/`) —
> jamais deviné. §2/§3 recoupent cet inventaire avec une recherche web sur les logiciels de
> facturation concurrents (SaaS et self-hosted, y compris closed-source) pour ne garder que les
> manques réellement récurrents chez eux. Chaque ligne de manque porte une case "e2e" : ce qu'un
> test devrait prouver le jour où l'item est implémenté — **rien n'est implémenté ici**.
>
> Ce fichier est complémentaire à `TODO_MANDANT.md` (credentials/démarches de conformité e-invoicing)
> et à `COMPLIANCE_TODO.md`/`TODO_ISSUES.md` (le moteur de conformité pays). Il ne les recoupe pas :
> il couvre les fonctionnalités "métier" génériques (paiement, relances, portail, stock, temps…) que
> la quasi-totalité des concurrents proposent et qu'invoicerr n'a pas encore, indépendamment de la
> conformité e-invoicing par pays (déjà très avancée, voir §1.7).

---

## Suivi (mise à jour 2026-09-11)

- **Rang 2 — relances automatiques (dunning)** : ✅ FAIT — sweep BullMQ quotidien (`reminders/reminder-sweep.ts`
  pur + `reminder-sweep-runner.ts`, même patron que conformity/currency-rate), **opt-in par société**
  (`Company.remindersEnabled` défaut OFF — aucun envoi surprise), paliers 7/14/30 j de retard (ton
  croissant, le plus bas palier dû-et-non-envoyé par passe → jamais de rafale). Idempotent via
  `DocumentReminder @@unique([documentId, tier])` (migration `20260911062312`). Détection du retard
  réutilise le pipeline settlement (jamais recalculé), envoi via `MailService`. **Factures uniquement**
  cette passe (devis non signés = extension 1 fichier, notée). jest 31 (sélection de palier + idempotence
  mordues par mutation), **validé bout-en-bout contre la vraie DB de test** (envoi + ligne `DocumentReminder`
  + 2ᵉ passe no-op via la vraie contrainte unique). Pas d'écran (job de fond) — le flag `remindersEnabled`
  sera exposé par le chemin admin que le produit décidera.

- **Rang 6 — relevé de compte client** : ✅ FAIT (endpoint company-scopé `GET /clients/:id/statement`
  → `settlement/client-statement.ts` : agrège les factures « sent » du client, réutilise
  `compute-settlement`/`credits` sans réinventer un calcul, produit une balance âgée par devise
  (current/0-30/31-60/60+) ; écran `clients/_components/client-statement.tsx` ouvert depuis la fiche
  client ; jest `client-statement.spec.ts`+`clients.service.statement.spec.ts` (23 tests, boundaries
  et isolation société), e2e `47-client-statement`. **Reste** : export PDF du relevé (laissé en TODO
  explicite — la donnée et l'écran existent, seul le rendu PDF manque).
- **Rang 8 — QR de paiement SEPA / EPC069-12 (GiroCode)** : ✅ FAIT (`rendering/sepa-qr.ts` :
  `buildEpcPayload` pur (EPC069-12 v002, BIC vide car pas de colonne BIC, EUR-only, troncatures) +
  `renderSepaQrDataUri` async ; drapeau descripteur `usesPaymentQr` (invoice uniquement) ; bloc
  `<img>` gated dans `render-html.ts`, câblé par `sepaPaymentQrFor` dans `render-instance-pdf.ts`
  (gardes : type + IBAN posé + devise EUR + total > 0). `qrcode` déjà présent (dépendance existante,
  aucune install). jest : `sepa-qr.spec`+`render-html.spec`+`render-instance-pdf.spec` (62 tests,
  contenu EPC exact + gardes), e2e `48-payment-qr` (le PDF EUR+IBAN embarque le QR — prouvé par la
  taille —, absent sans IBAN ou en non-EUR).
- **Rang 9 — taux de change automatiques (flux BCE)** : ✅ FAIT — sweep BullMQ quotidien (métronome,
  même patron que `conformity-sweep` : `currency-rate-sweep.ts` pur + `currency-rate-sweep-runner.ts`
  + repeatable enregistré dans le dispatcher, routé par le processor, provider dans le worker-module).
  `ecb-rates-client.ts` récupère le flux BCE gratuit sans clé (`eurofxref-daily.xml`, timeout 10s,
  parse `@xmldom/xmldom`), `computeCrossRate` calcule les paires en `Prisma.Decimal` (pas de float).
  Le runner rafraîchit les paires `(from,to)` DÉJÀ présentes par société (jamais de paires inventées),
  idempotent par `asOf` (pas de contrainte unique en base). `convert.ts` INCHANGÉ (résout déjà la
  dernière ligne par `asOf`, sans filtre de source → les lignes `ecb` sont prises automatiquement).
  jest 29 (dont `computeCrossRate` mordu par mutation, idempotence mordue) + test LIVE réel BCE
  (`ECB_LIVE=1`, gate) ; validé bout-en-bout contre la vraie DB de test + le vrai flux BCE (écriture
  ecb réelle → `convert` la résout → 2ᵉ passe no-op). Pas d'écran (job de fond) → preuve = round-trip
  live + intégration DB réelle, pas Cypress.
- **Rang 7 — référence client / n° de commande** : ✅ FAIT (champ descripteur `clientReference` sur
  devis/factures, `hideWhenEmpty`, rendu PDF + liste ; e2e 46-client-reference).
- **Rang 10 — écran déclarations mydata/NAV** : ⚠️ ÉTUDE DE COMPATIBILITÉ FAITE (2026-09-11,
  sous-agent, sources primaires citées) — **aucun des 5 pays gardés n'entre dans le mécanisme de
  déclaration existant** (`reporting/`). Ce mécanisme modèle « le vendeur DÉCLARE les données de la
  facture à SON autorité fiscale en temps réel et reçoit un identifiant émis par l'autorité »
  (`DeclarationResult.authorityId` obligatoire) — NAV (HU) et myDATA (GR) sont les deux seules formes
  livrées, et ces deux pays ont été retirés. Verdicts :
  - **FR** : ne correspond pas — l'e-reporting transite PAR la PDP→PPF (axe transport), transmission
    périodique (bi-mensuelle à 3×/mois selon régime TVA), pas une API de déclaration temps réel.
  - **PL/IT** : ne correspondent pas — KSeF/SdI sont de la clearance/transport, déjà modélisée dans
    `transports/` (+ pollers → `DocumentAuthorityEvent`). L'esterometro IT a été absorbé dans SdI en
    2022.
  - **DE** : ne correspond pas — le Meldesystem n'est pas encore législé (BMF : « prévu à un stade
    ultérieur »).
  - **PT** : SEUL candidat honnête, mais nécessite un NOUVEAU provider complet (webservice SOAP
    WS-Security de l'AT, comunicação de faturas, DL 198/2012 art. 3(4)) — taille comparable au build
    NAV/myDATA d'origine, PAS un quick win. Deux caveats : l'AT ne renvoie pas d'identifiant émis
    (juste un code de résultat → `authorityId` à synthétiser), et le webservice temps réel n'est QU'UN
    des 3 canaux légaux (webservice / SAF-T mensuel / saisie portail) → tension avec la posture « pas
    de déclaration optionnelle » du schéma.
  - **Anti-pattern à ne PAS faire** : écrire `reporting/data/{fr,pl,it}.json` avec `pdp`/`ksef`/`sdi`
    comme `providerId` (données qui roulent sur le tuyau transport ≠ ce mécanisme), ou `de.json`
    (obligation légale inexistante à ce jour). C'est exactement le forçage que l'en-tête de
    `reporting/schema.ts` proscrit.
  - **Alternative rapide et honnête** pour le besoin produit (« donner du contenu à l'écran ») :
    re-scoper l'écran pour lister génériquement les `DocumentAuthorityEvent` (événements d'autorité /
    clearance) — cette table reçoit DÉJÀ des événements temps réel par facture pour FR (PDP
    200→201→202), PL (KSeF) et IT (SdI, RC/NS/NE/DT/AT poussés), sans aucun provider neuf. C'est un
    re-scope du FEATURE (renommer « événements d'autorité », pas « déclarations » — ce sont des
    événements de clearance, pas des déclarations vendeur→autorité), pas un détournement du mécanisme
    `reporting/`.
  - **DÉCISION PRISE (2026-09-11) : option A — provider Portugal livré.** `reporting/providers/pt-at-client.ts`
    + `pt-declaration-provider.ts` (providerId `pt-at`, AT « comunicação de faturas », WS-Security
    UsernameToken RSA/AES, mappe `DeclaredInvoice`→`RegisterInvoiceRequest`), `reporting/data/pt.json`
    (provenance `legal` : DL 198/2012 art. 3º n.º1 lu en source primaire). Statut **implemented-
    awaiting-accreditation** (comme SdI) — jamais éprouvé en réel, 2 gaps consignés (mTLS non câblé,
    padding RSA unverified) → TODO_ISSUES + credentials → TODO_MANDANT §D. jest (reporting) 88✓/5 skip,
    contenu/gating mordus par mutation ; round-trip réel gated `PT_AT_LIVE=1`.
- Quick wins TOUS FAITS (rangs 6, 7, 8, 9). Rang 10 : décision produit en attente (voir plus haut).

## 1. Inventaire de l'existant (100 % code)

### 1.1 Documents (devis, factures, avoirs, dépenses, factures reçues)
Un seul mécanisme générique — `backend/src/modules/documents/descriptors/` (`type-registry.ts` +
un descripteur par type : `quote.descriptor.ts`, `invoice.descriptor.ts`,
`credit-note.descriptor.ts`, `expense.descriptor.ts`, `received-invoice.descriptor.ts`) — pilote
tout : champs, statuts, actions, numérotation, email, contributions dashboard/statistics. Aucun type
n'a son propre contrôleur/service Prisma ; `documents.service.ts` + `persistence.ts` sont génériques.
Preuves e2e : `17-document-descriptor`, `19-document-pdf`, `20-document-totals`,
`21-document-lifecycle`, `22-document-numbering`, `23-document-email`, `28-document-async-send`.

- **Devis → facture** : conversion intégrale (`actions/convert-to-invoice.ts`) ou **acompte en %**
  (`actions/request-deposit.ts`, recalcule le TTC du devis, refuse si plusieurs taux de TVA sans
  ligne unique) — e2e `26-document-deposit`.
- **Avoirs (credit notes)** : type dédié, seul type autorisé à réduire une facture
  (`settlement/credits.ts`) — e2e via `24-document-payments`/`25-document-settlement`.
- **Dépenses** : type "expense" minimal — description/montant/devise/date/notes, **aucune pièce
  jointe, aucune catégorie** (voir §3 — gap).
- **Factures reçues (AP)** : module dédié `received-invoices/` avec extraction (`extraction.ts`),
  OCR (`received-invoices/ocr/`, moteurs Mistral **et** local Tika — `ocr-service/`), et
  rapprochement fournisseur automatique/manuel (`supplier-reconciliation.ts`, marque
  `Client.isSupplier`) — e2e `36-received-invoices`.
- **Lignes** : remise en % par ligne déjà supportée, appliquée avant TVA
  (`totals/compute-totals.ts`).
- **Paiements & lettrage** : `DocumentPayment` générique à tout type de document
  (`settlement/payments.ts`), conversion multi-devise **au moment du paiement** avec taux figé
  (`settlement/convert-payment.ts`) — e2e `24-document-payments`, `27-multi-currency-consolidation`.
- **Récurrence** : moteur générique `schedules/` (cadence weekly/monthly/quarterly/yearly,
  `cadence.ts`), rejoue une action sur un document gabarit, option `{thenSend:boolean}` pour
  enchaîner l'envoi — écran `settings/recurring.settings.tsx` — e2e `29-document-recurrence`.
- **Partage/consultation publique** : lien à jeton hashé, PDF seul (`share-links/`,
  `public/public-documents.controller.ts`), **pas de portail authentifié** (voir §3) — e2e
  `37-document-share-link`.
- **Signature électronique** : OTP par email, jeton dédié (`signatures/otp.ts`,
  `signature-token.ts`), webhook `DOCUMENT_SIGNED` — e2e `45-signature`.
- **Archivage légal / WORM** : `archive/` (`persistence.ts`, `storage.ts`,
  `archive-verdict-on-terminal.ts`, `verdict-artifact.ts`), rétention (`archive/retention/`) — e2e
  `34-document-archive`.

### 1.2 Conformité e-invoicing (le cœur de la branche)
Voir `CLAUDE.md` et `documentation/compliance/COMPLIANCE_ARCHITECTURE.md`. En bref, déjà en place et
prouvé par des specs dédiées (hors périmètre de ce document, non reproduit ici en détail) :
- Formats nationaux + sémantiques (`formats/national`, `formats/semantic`, `formats/vendored/{en16931,peppol,pl,es,nl,de,it}`) — e2e `30-document-xml-format`.
- Canaux/transports (`transports/{pdp,ksef,sdi,chorus-pro,face,peppol,anaf}`) — e2e
  `31-national-channels`, `32-channel-mandate`.
- B2G (`b2g-routing/`, 15 pays livrables selon `B2G_COVERAGE.md`) — e2e `40-b2g-routing`.
- Politique pays (types de documents disponibles, mentions obligatoires, identifiants requis,
  routes de correction/annulation) : `country-policy/`, `mentions/`, `country-identifiers/`,
  `correction-routes/` — e2e `39-document-conformity`, `43-correction-routes`, `44-country-policy`.
- Fiscalité transfrontalière par composition de profils, jamais une matrice N×N (`tax/tax-engine.ts`)
  — e2e `35-cross-border-tax`.
- **Mentions légales calculées** : ex. FR — indemnité forfaitaire de recouvrement (40 €) et taux de
  pénalités de retard (taux BCE + 10 pts, figé à l'émission) générés automatiquement
  (`mentions/data/fr.json`) — une sophistication que peu de concurrents grand public égalent.
- **Déclarations temps réel** : fournisseurs `reporting/providers/{mydata,nav}-*` (Grèce, Hongrie),
  déclenchées à l'envoi (`report-on-send.ts`) — **aucun écran dédié** pour voir l'historique de ces
  déclarations (voir §3, item mineur).

### 1.3 Clients, articles, fournisseurs
- `modules/clients/` : CRUD complet, `ClientType` (particulier/société), `ClientKind`
  (BUSINESS/GOVERNMENT — routage B2G), flag `isSupplier` indépendant (réconciliation AP) — écran
  `pages/(app)/clients/`, e2e `05-clients`.
- `modules/articles/` : catalogue produit/service, pré-remplissage de ligne depuis le catalogue —
  e2e `14-articles`. **Aucun champ de quantité en stock.**
- `modules/company-lookup/` + `modules/sirene/` : enrichissement automatique à la création d'un
  client depuis un registre officiel (SIRENE FR + ~250 capacités par pays, REGISTER/PARTIAL) — e2e
  `16-company-lookup`.

### 1.4 Multi-société, auth, API
- `modules/companies/` + `modules/company/` (+ `signing-certificates/`, `channels/`,
  `currency-rates/`) : multi-société par utilisateur (`UserCompany`, `CompanyRole`
  OWNER/ADMIN/MEMBER), `@ActiveCompany()` scope toutes les requêtes — e2e `15-multi-company`,
  `02-company`.
- Auth better-auth + fallback clé API (`modules/api-keys/`, scopes) — e2e `13-api-keys`,
  `01-register`, `03-auth`.
- `modules/invitations/` : invitation de membres par code — écran
  `settings/_components/invitations.settings.tsx`.
- `modules/danger/` : reset app/société avec confirmation OTP.
- Taux de change (`company/currency-rates/`) : **saisie manuelle uniquement**
  (`CurrencyRate.source` par défaut `"manual"`, aucun fournisseur de taux live câblé) — voir §3.

### 1.5 Intégrations & extensibilité
- **Webhooks** : `modules/webhooks/` — 7 types de destination (`WebhookType`: GENERIC, DISCORD,
  MATTERMOST, SLACK, TEAMS, ZAPIER, ROCKETCHAT), événements génériques `DOCUMENT_*`/`CLIENT_*`/
  `COMPANY_*`/`WEBHOOK_*` (purgés de ~80 valeurs mortes en 2026-09-03, ne restent que celles avec un
  émetteur réel) — e2e `42-webhooks`.
- **Serveur MCP** : `modules/mcp/` — outils génériques par type de document, scopés par clé API
  (`tools/tool-registry.ts`), permet à un agent IA de piloter l'appli.
- **Plugins in-app** : `modules/plugins/` — `PluginType` SIGNING/STORAGE/OCR, registre interne
  (le mécanisme de plugins tiers chargés dynamiquement a été retiré en 2026, voir le commentaire de
  tête de `plugins.service.ts` — jugé sans point d'extension réel).

### 1.6 PDF, mails, i18n
- Rendu PDF par template Handlebars/HTML **édité en code brut** dans
  `settings/_components/pdf.settings.tsx` (éditeur texte + prévisualisation), pas de galerie de
  thèmes ni d'éditeur WYSIWYG — e2e `19-document-pdf`.
- Templates email par type de document + par défaut plateforme
  (`actions/email-template.ts`, `actions/company-email-templates.ts`) — écran
  `settings/_components/templates.settings.tsx`.
- i18n : UI entièrement `t()`-isée, gérée par Weblate, `npm run i18n:check` en CI ; les libellés de
  descripteurs de documents suivent le même mécanisme avec repli sur le texte brut
  (`descriptor-i18n`, e2e `38-descriptor-i18n`). **Pas de langue de document par client** (le
  `Client` n'a pas de champ langue — un PDF est toujours généré dans la langue du descripteur, pas
  dans celle du destinataire).

### 1.7 Dashboard, reporting interne
- Dashboard et Statistics sont le **même mécanisme de "contributions"** (`contributions/`) : chaque
  type de document peut publier des widgets dashboard et/ou statistics, jamais un champ en dur —
  invoice/quote/credit-note/expense/received-invoice y contribuent déjà.
- Consolidation multi-devises **opt-in** sur ces widgets (`contributions/currency-consolidation.ts`,
  `Company.referenceCurrency`) — e2e `27-multi-currency-consolidation`.
- **Pas de relevé de compte client** (solde agrégé + âge de créance par client) — voir §3.

---

## 2. Ce que font les concurrents (recherche web, 8 requêtes)

Sources consultées (contenu non fiable, extrait uniquement pour repérer des *familles de
fonctionnalités*, aucune instruction suivie, aucun texte copié) :
- Concurrents self-hosted directement comparables : Invoice Ninja, Akaunting, Crater, InvoiceShelf.
- SaaS grand public : Zoho Invoice, Xero, FreshBooks, QuickBooks, Stripe Billing/Invoicing, PayPal
  Invoicing, Salesforce Billing.
- Marché FR TPE/PME : Evoliz, Sellsy, Kwixéo, Abby, Tiime.
- Roundups génériques 2026 (Zapier, Capterra, GetApp, TheDigitalPM) sur les fonctionnalités
  "must-have" et les intégrations comptables (QuickBooks/Xero/DATEV).

Familles récurrentes chez ces concurrents, absentes ou partielles chez invoicerr (détail en §3) :
paiement en ligne (carte/SEPA), relances automatiques programmées, portail client authentifié,
rapprochement bancaire, export comptable vers un tiers (FEC/DATEV/Xero/QuickBooks), suivi du temps
et facturation de projets, gestion de stock, notes de frais avec pièce justificative/catégories,
bons de commande/achats, workflows d'approbation multi-niveaux, personnalisation de template
sans code, taux de change automatiques, facturation échelonnée multi-jalons, champs
personnalisés/tags, application mobile native.

---

## 3. Manques classés par IMPORTANCE décroissante (une seule liste)

> Rang unique du plus au moins important (impact utilisateur × fréquence chez les concurrents).
> **⚡ = quick win** : faible effort, à faire en priorité pour le retour sur investissement, même
> quand son rang d'importance brute est plus bas. Colonne « Externe payant ? » = nécessite des
> credentials/contrat côté mandant. Chaque ligne porte l'e2e à prouver le jour de l'implémentation.

| Rang | ⚡ | Fonctionnalité | Effort | Externe payant ? | État actuel | e2e à prouver |
|---:|:--:|---|:--:|:--:|---|---|
| 1 |  | **Paiement en ligne (carte, SEPA, PayPal)** — lien « Payer » qui encaisse via Stripe/GoCardless/PayPal, marque la facture payée (webhook → `DocumentPayment`). LA fonctionnalité la plus universelle chez tous les concurrents. | L | **Oui** | Absent (`PaymentMethodType.PAYPAL` n'est qu'une étiquette manuelle). | Un lien public sur une facture ISSUED → paiement sandbox → `DocumentPayment` créé + `DOCUMENT_SETTLED` franchi, sans saisie. |
| 2 |  | **Relances automatiques (dunning)** — cadence de rappels J-3/J+7/J+14, ton croissant, aussi pour devis non signés. 2ᵉ fonctionnalité la plus citée ; impact direct sur le DSO. | M | Non | Absent, mais l'infra de cadence existe (`schedules/cadence.ts`, `schedule-sweep.ts`) — à réutiliser. | Une facture en retard de N jours envoie un email de relance une fois par palier, visible dans les logs d'envoi. |
| 3 |  | **Portail client authentifié** — espace où le client voit TOUS ses documents, son solde, paie, accepte/refuse un devis. Argument de vente central chez Zoho/Xero/Invoice Ninja. | L | Non (sauf le paiement qu'il expose) | Partiel : le lien de partage ne sert qu'UN document PDF ; la signature OTP est ponctuelle. | Un client avec ≥2 factures accède à un espace les listant (statut + solde) sans repasser par un email à chaque fois. |
| 4 |  | **Export comptable (CSV générique → FEC/DATEV)** — écritures importables par l'expert-comptable ; FEC attendu en FR, DATEV en DE/AT. | M (CSV) / L (FEC) | Non | Absent — aucun module d'export comptable. | Un export sur une période produit un fichier dont chaque ligne = une facture/avoir/paiement réel, montants/dates cohérents avec `compute-settlement.ts`. |
| 5 |  | **Rapprochement bancaire (import relevé)** — importer CSV/OFX (ou open banking) et matcher les lignes aux factures. Jugée la plus importante par les utilisateurs dans les comparatifs. | L | CSV/OFX : non · open banking : oui | Absent — paiements 100 % saisis à la main (`settlement/payments.ts`). | Importer un relevé CSV dont une ligne matche une facture ouverte crée le `DocumentPayment` correspondant sans saisie. |
| 6 | ⚡ | **Relevé de compte client (statement)** — vue agrégée par client : ouvertes/réglées/avoirs/solde/balance âgée, exportable PDF. | M | Non | Absent comme écran ; la donnée existe (`settlement/compute-settlement.ts`, `credits.ts`). | Depuis la fiche client, un relevé liste chaque facture avec solde dû et une balance âgée (0-30/31-60/60+) cohérente. |
| 7 | ⚡ | **Champ « référence client / n° de commande »** — champ dédié imprimé sur le PDF. Quasi-universel ; exigé par les acheteurs B2G/B2B. | S | Non | Absent comme champ de premier ordre (seul `notes` libre existe). | Une facture avec `clientReference` → apparaît sur le PDF et la liste ; absent si vide. |
| 8 | ⚡ | **QR-code de paiement SEPA (EPC/GiroCode) sur le PDF** — virement pré-rempli scannable. Quasi-standard DE/AT/NL/BE ; aucune intégration payante (`Company.iban` déjà stocké). | S | Non | Absent — `Company.iban` stocké mais jamais rendu en QR. | Un PDF avec IBAN contient un QR EPC069-12 valide (IBAN, montant, réf.) ; absent si `iban` null. |
| 9 | ⚡ | **Taux de change automatiques (flux live)** — récupérer les taux BCE quotidiens au lieu d'une saisie manuelle. | S/M | Non | Partiel : `CurrencyRate` existe mais `source` toujours `"manual"`. | Un job insère un `CurrencyRate` daté `source:"ecb"` par paire active ; un paiement du jour résout ce taux sans saisie. |
| 10 | ⚡ | **Écran « déclarations » (mydata/NAV)** — visibilité des déclarations temps réel déjà envoyées automatiquement (GR/HU) : statut, date, erreurs. | S/M | Non | Mécanisme existant (`reporting/report-on-send.ts`) mais AUCUN écran ne l'expose. | Envoyer une facture GR/HU déclenche une déclaration ; l'écran la liste avec son statut, même en échec. |
| 11 |  | **Suivi du temps & facturation de projets** — logger des heures/tâches par client, les convertir en lignes HOUR/DAY. Cœur de l'offre freelances/consultants. | L | Non | Absent : `ItemType.HOUR/DAY` existe mais rien ne logue de temps. | Un temps loggé puis sélectionné à la création → ligne HOUR dont la quantité = les heures, marquées « facturées ». |
| 12 |  | **Facturation échelonnée multi-jalons** — depuis un devis, générer plusieurs factures programmées (30/40/30 %). Attendu en BTP/conseil/formation. | M | Non | Partiel : `request-deposit.ts` ne gère qu'UN acompte %. | Un devis à 3 échéances génère 3 factures draft aux dates prévues, somme = TTC du devis. |
| 13 |  | **Notes de frais enrichies** — pièce jointe (photo reçu), catégories, kilométrage, approbation. | M | Non (réutilise l'OCR existant) | Partiel : type « expense » volontairement minimal ; le pipeline OCR existe déjà (`received-invoices/ocr/`). | Une dépense avec image stocke le fichier et permet de le retélécharger ; une catégorie apparaît dans les stats. |
| 14 |  | **Langue du document par destinataire** — générer le PDF/email dans la langue du client. Attendu dès qu'on facture hors de son pays (marché FR/PL/IT). | M | Non | Absent : `Client` n'a pas de champ langue. | Un client langue « PL » reçoit un PDF aux libellés fixes en polonais ; sans langue → comportement actuel. |
| 15 |  | **Champs personnalisés / tags** — champs propres sur client/document sans toucher au code. Standard « custom fields ». | M | Non | Absent — champs définis uniquement par les descripteurs. | Un champ personnalisé créé en Settings apparaît sur le formulaire et le PDF des factures suivantes. |
| 16 |  | **Personnalisation de template sans code** — galerie de thèmes + éditeur visuel, en plus du Handlebars actuel. | M/L | Non | Partiel : `pdf.settings.tsx` complet mais réservé à un profil technique. | Un utilisateur non technique choisit un thème et voit le PDF changer sans toucher au HTML. |
| 17 |  | **Workflow d'approbation interne** — validation par un rôle supérieur au-dessus d'un seuil. | M | Non | Absent : `CompanyRole` global, pas de circuit par document. | Un MEMBER ne peut pas envoyer une facture au-dessus du seuil sans approbation d'un ADMIN/OWNER. |
| 18 |  | **Gestion de stock basique** — quantité par article, décrément à la facturation, alerte stock bas. | M | Non | Absent : `Article` n'a aucun champ de quantité. | Facturer N unités décrémente le solde ; sous le seuil → alerte visible. |
| 19 |  | **Bons de commande / achats fournisseurs** — émettre un BC, le rapprocher (3-way match) avec la facture reçue. | L | Non | Absent — seule la réception/rapprochement aval existe. | Un BC envoyé puis une facture reçue rapprochée affiche les écarts quantité/montant. |
| 20 |  | **Facturation par abonnement avancée (usage-based, paliers, essai)** — metered/tiered billing façon Stripe Billing. Segment SaaS différent du cœur B2B/compliance actuel. | L | Généralement oui | Absent — la récurrence rejoue un document identique, pas un calcul d'usage. | À ne traiter qu'après les items 1-13, sauf demande explicite. |
| 21 |  | **Application mobile native** — iOS/Android (créer, scanner un reçu, consulter). Annoncée dans le README, rien de livré. | L | Non | Absent ; l'API REST existe et pourrait la porter. | Hors échelle Cypress web — nécessiterait une suite mobile dédiée (Detox/Appium). |

### Notes de classement
- Les cinq premiers (paiement, relances, portail, export, rapprochement) sont les fonctionnalités
  « métier grand public » les plus universelles chez les concurrents — l'axe où invoicerr accuse le
  plus de retard, à l'inverse de la conformité e-invoicing où il est en avance (§1.2).
- Les ⚡ quick wins (rangs 6-10) sont peu coûteux et réutilisent de l'existant : à intercaler tôt,
  même s'ils passent après les cinq gros chantiers en importance brute.
- Le paiement en ligne (rang 1) débloque partiellement le portail (rang 3) et les abonnements
  (rang 20) : c'est le prérequis d'encaissement dont ils dépendent tous.
