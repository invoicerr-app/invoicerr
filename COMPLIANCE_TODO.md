# Invoicerr — Compliance / E‑Invoicing — ÉTAT COMPLET (fait + à faire)

> Tableau de bord exhaustif : tout ce qui est **fait** (coché) et tout ce qu'il **reste** (décoché),
> pour montrer où on en est. Statut au 2026‑06‑29. Branche `feat/compliance-architecture`.
>
> **Légende :** `[x]` fait · `[ ]` à faire. Suffixes : ✅ prouvé live · 🟢 implémenté+testé (mocké),
> preuve live en attente de creds · 🟡 partiel/échafaudé · 🔴 stub (log.todo) · ⛔ absent.
>
> **Principe :** « a country is data ». Un profil (`profiles/data/*.ts`) déclare format(s), canal(aux),
> signature, lifecycle, numbering, archival, reporting *par date*. Le moteur exécute
> `build → sign → transmit → archive → report`.

---

## 0. Socle (déjà en place)

- [x] Moteur + lifecycle + 3 drivers (poll/timer/inbound), event‑sourced.
- [x] `ComplianceExecutor.process()` : `totals → number → build → sign → regime → transmit → archive → report`.
- [x] Wiring NestJS (`ComplianceModule`), cron `@Interval(30s)` poll + `@Interval(60s)` timer.
- [x] Persistance Prisma : `ComplianceDocument`, `ScheduledJob`, `CallbackRegistration`, `InboundMessage`.
- [x] Câblé dans le flux facture : `createDraft` / `issueInvoice` / `sendInvoiceByEmail`(=`send`) / `correct` /
  `cancel` / `cancelAndReplace` / `markPaid`.
- [x] `getAvailableActions` + `flow` (FlowDescriptor) exposés ; UI lifecycle (badges, pipeline, timeline).
- [x] Config de canaux **par société chiffrée** (AES‑256‑GCM, `CREDENTIALS_ENCRYPTION_KEY`), une seule
  config active par (société, provider) sinon SKIP.
- [x] Réglages canaux **pilotés par pays** : endpoint `GET …/companies/:id/required-channels` (canaux
  actuels + à venir, `availableFrom`) + UI `channels.settings.tsx` (Connect/Edit, secrets masqués, erreurs surfacées).
- [x] Refactor `Controller → Service → PrismaService` (pas de Prisma/`any` dans les controllers) ; DI vérifiée au boot.
- [x] Hygiène libs : builder `@fin.cx/einvoice` → `@e-invoice-eu/core` ; validateur saxon/compilateur maison
  → `node-schematron` ; XSD `xmllint` subprocess → `xmllint-wasm` ; `pdf-lib` déclarée ; Prisma singleton + `$transaction`.
- [x] **Reconcile au boot + sweep 12h** (cf. §4) — fait (`onApplicationBootstrap` + `@Interval(12h)`).

---

## 1. FORMATS (`providers/format/`, `modules/invoice-rendering/`)

### 1.1 Famille EN 16931 (`@e-invoice-eu/core`)
- [x] **EN16931_CII** — `exportXml('cii')` ✅ (FR→PDP prouvé).
- [x] **FACTURX / PDF_A3** — PDF/A‑3 hybride (`renderPdfFormat`) ✅ (copie humaine FR).
- [x] **EN16931_UBL** — `exportXml('ubl')`.
- [x] Validation EN16931 Schematron (`node-schematron`) + XSD CII/FA(2) (`xmllint-wasm`).
- [x] `cii-post-process.ts` réduit au strict (namespaces + routing PDP).
- [ ] 🟡 **XRECHNUNG** — gap data **BR‑DE‑11/12/13/14** (tel+email vendeur, EndpointID acheteur, code moyen de paiement) à modéliser.
- [ ] 🟡 **ZUGFERD** — aliasé sur Factur‑X (`invoice-rendering.service.ts:46`) ; distinguer les vrais profils.
- [ ] 🟡 **PEPPOL_BIS** — approximé `'ubl'` ; poser le bon `CustomizationID`/`ProfileID` BIS Billing 3.0.

### 1.2 Formats nationaux majeurs
- [x] **FA_VAT** (PL, FA(2)) — `buildFaVat()` ✅ (prouvé KSeF).
- [x] **FATTURAPA** (IT, 1.2) — `@digitalia/fatturapa` (build) — transmission SdI à finir (§3).
- [ ] 🟡 **CFDI** (MX 4.0) — finir complément/addenda + sceau SAT + timbrado PAC.
- [ ] 🟡 **ES_FACTURAE** (3.2.x) — finir + XAdES + SII/Verifactu.
- [ ] 🔴 **KSA_UBL** (ZATCA FATOORA) — UBL 2.1 + hash + QR + sceau XAdES.

### 1.3 Formats nationaux 🔴 (stubs `national-formats.ts`) — build + validation + signature + champs + profil + preuve
- [ ] LATAM : `AR_FE` · `BO_FE` · `NFE`(BR) · `CL_DTE` · `CR_FE` · `DO_ECF` · `EC_FE` · `GT_FEL` · `PA_FE` ·
  `PY_DE` · `SV_DTE` · `UY_CFE` · `VE_FE`
- [ ] MENA : `JO_JOFOTARA` · `TN_TEIF` · `TR_EFATURA` · `EG_ETA`
- [ ] Afrique : `NG_FIRS` · `KE_ETIMS` · `GH_EVAT` · `RW_EBM` · `TZ_VFD` · `UG_EFRIS` · `ZM_SMARTINVOICE` ·
  `ZW_FDMS` · `CI_FNE` · `BJ_MECEF`
- [ ] Asie : `ID_EFAKTUR` · `TW_EGUI` · `KZ_ESF` · `PH_EIS` · `TH_ETAX` · `NP_CBMS` · `BD_NBR` · `PK_FBR` ·
  `CN_EFAPIAO` · `IN_IRP` · `VN_TT78`
- [ ] Europe (national) : `UA_TAXINVOICE` · `ME_FISCAL` · `HR_ERACUN` · `AL_FISCALIZATION`
- [ ] `NATIONAL_XML` placeholder → remplacer par des providers dédiés par pays.

### 1.4 Transverse formats
- [ ] Étendre validation : XSD/Schematron FatturaPA, CFDI, Facturae, + chaque format national.
- [ ] Gap `BR‑27` (prix net ligne / modèle remises EN16931) — modéliser les allowances.

---

## 2. SIGNATURE (`providers/signing/`) — 🔴 TOUT EST STUB

- [ ] **XAdES** (XML) — ‑B/T/LT/LTA + TSA. Pour Facturae, FatturaPA option, KSA, LATAM, TR.
- [ ] **CAdES** (.p7m) — pour **SdI** (FatturaPA `CAdES‑BES`), etc.
- [ ] **PAdES** (PDF) — Factur‑X/PDF signés (étendre `plugins/signing`, Documenso déjà présent + pdf‑lib).
- [ ] Gestion des **certificats de signature** par société (PFX/PKCS#12 + mot de passe), chiffrés ; validité/chaîne/renouvellement.
- [ ] Mapper « algo + certificat » **par profil** (champ signature → vrais providers).
- [ ] Horodatage **TSA** (niveaux ‑T/‑LT/‑LTA).
- [x] (réf.) KSeF scelle/chiffre lui‑même côté client ; clés MF vendorisées `certs/ksef/{test,prod}`.

---

## 3. TRANSMISSION (`providers/transmission/`)

### 3.1 Faits / prouvés
- [x] **KSeF** (PL) ✅ round‑trip prouvé (CLEARED + ksefNumber).
- [ ] KSeF : chemin **prod** (clés MF prod) ; archivage **UPO** ; `sendStatus` si requis.
- [x] **PDP** (FR, superpdp propriétaire) ✅ facture acceptée (89xxx).
- [ ] **PDP‑AFNOR** (`apiStyle: afnor`) — ⛔ à prouver live (superpdp expose l'API Flux ; comparer au Swagger
  `AFNOR-Flow_Service-1.0.2-swagger.json`, corriger endpoints/payload si rejet).
- [ ] PDP : **API Annuaire** (résoudre `buyerEndpointId` du client) ; `sendStatus` (déposée/refusée/encaissée) 🔴.
- [x] **Email SMTP par société** 🟢 (`MailService.sendMail(opts, smtpOverrides?)`, fallback global).
- [ ] Email : **preuve réelle** (vrais creds SMTP) + vrai contenu (sujet/corps i18n + PDF + XML).

### 3.2 Implémentés (mocké) — preuve live en attente
- [x] **SdI** (IT) 🟢 — client + mapping des 6 notifiche (RC/NS/MC/NE/DT/AT) + tests.
- [ ] SdI : transport réel **SDICoop (SOAP)**/**SFTP** + **accréditation AdE** + **PFX qualifié** ; signature **CAdES .p7m** ; entrant ; preuve live.
- [x] **Peppol** 🟢 — lookup SMP/SML + envoi passerelle AP + mapping + tests.
- [ ] Peppol : **Access Point** réel + cert AP + lookup SML/SMP réel + MLR/Invoice Response → lifecycle ; preuve live.

### 3.3 Stubs 🔴
- [ ] **PAC** (MX) — timbrado, UUID/folio fiscal, clearance async.
- [ ] **OSE** (PE) — CDR.
- [ ] **PRINT** — représentation imprimable + QR.

### 3.4 Taxonomie portails
- [x] Suppression du `gov-portal` générique ; `GOV_PORTAL_API` **exige un `providerId`** (sinon SKIPPED explicite) + test garde.
- [x] Ajout des providers nommés `choruspro` (FR B2G), `gr-aade` (GR), `hu-nav` (HU) ; ~50 portails nommés présents.
- [ ] Implémenter chaque portail 🔴 (auth + build + submit + poll/`sendStatus` + mapping) :
  - [ ] LATAM : `afip` · `bo-sin` · `sefaz` · `sii` · `dian` · `cr-hacienda` · `dgii` · `sri` · `gt-sat` · `pa-dgi` · `sifen` · `sv-mh` · `uy-dgi` · `seniat`
  - [ ] MENA : `zatca` · `jofotara` · `tn-ttn`
  - [ ] Afrique : `firs` · `ke-kra` · `gh-gra` · `rw-rra` · `tz-tra` · `ug-ura` · `zm-zra` · `zw-zimra` · `ci-dgi` · `bj-dgi`
  - [ ] Asie : `id-coretax` · `tw-mof` · `kz-isesf` · `ph-bir` · `th-rd` · `np-ird` · `bd-nbr` · `pk-fbr` · `cn-sta` · `in-irp` · `vn-gdt` · `myinvois`
  - [ ] Europe : `choruspro` · `es-aeat` · `ua-dps` · `me-fiscal` · `hr-fiskalizacija` · `al-cis` · `lv-vid` · `sk-financnasprava` · `anaf` · `rs-sef` · `gib` · `gr-aade` · `hu-nav` · `eg-eta`

### 3.5 Transverse transmission
- [ ] **`sendStatus` sortant** réel PDP/SdI/Peppol (aujourd'hui QUEUED stub).
- [ ] **`poll()`** réel pour tous les `ASYNC_POLL` (KSeF/PDP ok ; reste à finir).
- [ ] Vérifier l'**idempotence** des envois côté providers.

---

## 4. LIFECYCLE — fraîcheur des statuts (PRIORITÉ)

- [x] Drivers poll(30s)/timer(60s) ; inbound‑router (pur) ; webhook `/compliance/inbound/:channel` ; `applySignal`.
- [x] PollJob/TimerJob persistés (les polls dus reprennent au prochain tick après un downtime).
- [x] **Reconcile au boot** — `ComplianceCron.onApplicationBootstrap` (fire‑and‑forget, non bloquant) →
  `PollScheduler.reconcile()` poll **tous** les jobs en cours (rattrape downtime + push manqués) + tick timers.
- [x] **Sweep 12h** — `@Interval(COMPLIANCE_RECONCILE_HOURS|12 h)` `reconcile()` (filet anti‑webhook‑manqué),
  garde anti‑chevauchement, erreurs catchées. `PollJobStore.pending()` ajouté (jobs en cours, hors filtre due).
- [ ] Rejouer les `InboundMessage` reçus mais non appliqués au boot (dedup) — pas encore.
- [ ] Câbler **toutes** les sources de statut : poll (pull) ✅, webhook (push, par canal) 🔴, polling d'inbox
  (SdI SFTP/mailbox) 🔴, action UI « rafraîchir » 🔴.
- [ ] Compléter le lifecycle par juridiction (statuts/transitions) ; FR push `encaissée` réel ; régimes bloquants MX.

---

## 5. ENTRANT (réception)

- [x] `InboundRouter.receive()` (pur) + webhook controller + corrélation/dedup de base.
- [ ] **Recevoir des factures** (fournisseurs) par canal : PDP, KSeF, SdI, Peppol — parse/valide/stocke/UI.
- [ ] **Statuts entrants** réels par canal → `INBOUND_STATUS` runtime (corrélation ref/idSdI/flowId/ksefNumber).
- [ ] **Acks à émettre** (Peppol Invoice Response, SdI esito committente…).
- [ ] Authenticité des webhooks (signature/mTLS/allowlist).

---

## 6. REPORTING (`reporting/reporting-handler.ts`, `ReportingKind`)

- [x] `reportAll()` câblé (ex. `markPaid` FR déclenche le stub e‑reporting).
- [ ] **E_REPORTING** (FR B2C + transfrontalier) réel vers PDP/PPF.
- [ ] **SAF‑T** · **OSS** · **IOSS** · **EC_SALES_LIST** · **INTRASTAT** · **SALES_PURCHASE_LEDGER** · **CUSTOMS_EXPORT**.
- [ ] Planification (mensuel/trimestriel) + idempotence + preuve de dépôt.

---

## 7. IDENTIFIANTS & DONNÉES DE RÉFÉRENCE

- [x] **SIREN ← SIRET** (schemeID 0002 = 9 premiers chiffres du SIRET 14).
- [ ] **Routing acheteur** via annuaire (AFNOR Directory / Peppol SMP) plutôt qu'en config société.
- [ ] **Validation identifiants** : VAT (VIES), SIRET (SIRENE), NIP, Codice Fiscale/P.IVA, RFC… (format+checksum+existence).
- [ ] Champs manquants au modèle : EndpointID/Peppol ID par client, tel/email vendeur, code moyen de paiement, NIC.
- [ ] Table + lookup + cache **annuaire** des participants.

---

## 8. CREDENTIALS & CERTIFICATS

- [x] Config canal par société chiffrée ; `CREDENTIALS_ENCRYPTION_KEY` requise (sinon 503) — à documenter en déploiement.
- [ ] **Stockage des certificats de signature** (PFX/PKCS#12 + mdp) par société, chiffré ; validité/chaîne/renouvellement.
- [ ] Certificats canal : SdI (PFX qualifié), Peppol (cert AP) ; KSeF token ✅ ; PDP OAuth ✅.
- [ ] Rotation des secrets ; audit d'accès ; jamais de secret en clair dans les logs (✅ vérifié pour SMTP).

---

## 9. MATRICE PAR PAYS (profils complets : FR, PL, IT, MX, US, MC, XX)

- **🇫🇷 FR** — [x] EN16931_CII(→PDP) + Factur‑X · [x] PDP(superpdp) · [ ] AFNOR preuve · [ ] ChorusPro B2G ·
  [x] Peppol(mocké) · [x] Email · [ ] signature · [ ] push PDP `encaissée` · [ ] e‑reporting B2C.
- **🇵🇱 PL** — [x] FA(2) · [x] KSeF(test) · [ ] KSeF prod · [ ] archivage UPO.
- **🇮🇹 IT** — [x] FatturaPA(build) · [x] SdI(mocké) · [ ] SdI live · [ ] CAdES .p7m · [ ] notifiche entrant.
- **🇲🇽 MX** — [ ] CFDI(finir) · [ ] PAC/timbrado · [ ] sceau SAT · [ ] folios bloquants.
- **🇺🇸 US** — [x] post‑audit Email/Peppol (vérifier le profil).
- **🇲🇨 MC** — [x] délègue à FR.
- **XX** — [x] Email/print fallback (vérifier).
- [ ] Étendre : DE (XRechnung+Peppol B2G), ES (Facturae+SII), + nouveaux pays archétype→profil.

---

## 10. VALIDATION & QUALITÉ

- [x] Validateur EN16931 (`node-schematron`) + XSD (`xmllint-wasm`).
- [ ] Schématron/XSD FatturaPA, CFDI, Facturae, FA(2) prod, formats nationaux.
- [ ] Gap `BR‑27` (allowances EN16931).
- [ ] Harnais de validation par format ; valider via lib, pas de XML à la main.

---

## 11. PREUVE LIVE & TESTS

- [x] Round‑trips live : **KSeF** ✅, **PDP‑superpdp** ✅.
- [ ] Round‑trips live : PDP‑AFNOR ⛔, SdI ⛔, Peppol ⛔, Email ⛔, chaque portail ⛔.
- [x] Tests d'intégration mockés (filets) : PDP, KSeF, Email, SdI, Peppol, executor‑e2e. **635 tests verts.**
- [x] Discipline « boot test » (l'app démarre, DI/routes OK).
- [ ] Tests gated `*_LIVE=1` par canal, assertions dures (pas de REJECTED/SKIPPED toléré).
- [x] CI : jest backend + cypress e2e (workflow « Tests »).

---

## 12. FRONTEND

- [x] Réglages canaux par pays (cartes Connect/Edit, secrets masqués, erreurs surfacées, auto‑fill).
- [x] Flow lifecycle (badges, available‑actions, pipeline, timeline).
- [ ] Affichage des **factures entrantes** (après §5).
- [ ] Étiquette « disponible à partir du {date} » (`availableFrom` déjà renvoyé).
- [ ] Gestion des **certificats de signature** dans les réglages société.
- [ ] Action « rafraîchir le statut » (poll manuel).

---

## 13. INFRA / DÉPLOIEMENT

- [x] `CREDENTIALS_ENCRYPTION_KEY` (générée localement, gitignored) ; PEM KSeF copiés au build (`**/*.pem`).
- [x] `xmllint-wasm` + `maxWorkers:4` jest.
- [x] Env : `COMPLIANCE_RECONCILE_HOURS` (défaut 12) — câblé au sweep périodique.
- [ ] Env : PEM KSeF **prod**, clés/URL par défaut.
- [ ] Verrou cron multi‑instances (éviter le double‑poll : lock distribué / leader).

---

## Ordre conseillé
1. [x] **Lifecycle freshness** (§4 : boot + sweep 12h) — fait (reste : replay inbound + webhooks push par canal).
2. [ ] **Signature réelle** (§2) — débloque SdI (.p7m), Facturae, KSA, LATAM.
3. [ ] **Prouver PDP‑AFNOR** + **Email réel** (§3.1) — rapides, creds dispo.
4. [ ] **SdI live** puis **Peppol live** (§3.2) — dès creds/AP.
5. [ ] **Entrant** (§5) + **sendStatus** (§3.5) — boucle complète.
6. [ ] **Reporting** (§6) + élargissement formats/portails nationaux (§1.3, §3.4) par marché.
