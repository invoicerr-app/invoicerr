# Invoicerr — Compliance / E‑Invoicing — ÉTAT COMPLET (fait + à faire)

> Tableau de bord exhaustif : tout ce qui est **fait** (coché) et tout ce qu'il **reste** (décoché),
> pour montrer où on en est. Statut au 2026‑06‑29. Branche `feat/compliance-architecture`.
>
> **Légende :** `[x]` fait · `[~]` scaffoldé (structurel + mocké, non validé autorité, live‑deferred) · `[ ]` à faire. Suffixes : ✅ prouvé live · 🟢 implémenté+testé (mocké),
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
- [x] **XRECHNUNG** — BR‑DE‑11/12 `cac:Contact` (tel+email vendeur) + BR‑DE‑14 `cac:PaymentMeans` code émis. [ ] dériver le code moyen de paiement de `invoice.paymentMethod` + IBAN pour code 30.
- [x] **ZUGFERD** — alias no‑op retiré ; ZUGFeRD 2.x = même profil CII/EN16931 + PDF/A‑3 + CustomizationID que Factur‑X (pas de profil divergent dans `@e-invoice-eu/core`) — alignement documenté.
- [x] **PEPPOL_BIS** — `CustomizationID`/`ProfileID` BIS Billing 3.0 réels injectés (au lieu d'UBL générique).

### 1.2 Formats nationaux majeurs
- [x] **FA_VAT** (PL, FA(2)) — `buildFaVat()` ✅ (prouvé KSeF).
- [x] **FATTURAPA** (IT, 1.2) — `@digitalia/fatturapa` (build) — transmission SdI à finir (§3).
- [x] **ES_FACTURAE** (3.2.2) — builder + ns/SchemaVersion corrects + **XAdES câblé** (nœud Signature vérifié). [ ] XSD officiel non bundlé (validation structurelle) ; [ ] SII/Verifactu.
- [ ] 🟡 **KSA_UBL** (ZATCA FATOORA) — UBL 2.1 + **QR TLV 5 champs (base64)** + CustomizationID corrects. [ ] hash PIH‑chain + sceau tag‑6 (clearance) + XSD.
- [ ] 🟡 **CFDI** (MX 4.0) — ns `cfd/4` + seam Sello/Certificado (faux NoCertificado retiré). [ ] timbrado PAC (UUID/TimbreFiscalDigital) + sceau CSD + complément/addenda + XSD.

### 1.3 Formats nationaux 🔴 (stubs `national-formats.ts`) — build + validation + signature + champs + profil + preuve
- [~] LATAM **scaffoldé** (builders structurés + tests structurels, **non validé autorité, live‑deferred**) :
  `AR_FE` · `BO_FE` · `NFE`(BR) · `CL_DTE` · `CR_FE` · `DO_ECF` · `EC_FE` · `GT_FEL` · `PA_FE` · `PY_DE` ·
  `SV_DTE`(JSON) · `UY_CFE` · `VE_FE`. Reste par pays : champs obligatoires manquants + XSD + sceau/clearance (CAE/CUFE/claveAcceso).
- [~] MENA **scaffoldé** (builders + clients, mockés, live‑deferred) : `TR_EFATURA`(gib UBL‑TR), `EG_ETA`(UUID+hash) profonds ; `JO_JOFOTARA`(UBL+ISTD)·`TN_TEIF` génériques.
- [~] Afrique **scaffoldé** (builders + clients, mockés, live‑deferred) : `NG_FIRS`(IRN SHA‑256+QR), `KE_ETIMS`(VSCU+QR)
  profonds ; `GH_EVAT`·`RW_EBM`·`TZ_VFD`·`UG_EFRIS`·`ZM_SMARTINVOICE`·`ZW_FDMS`·`CI_FNE`·`BJ_MECEF` génériques. Reste : champs + device/OSCU + sceau + clearance.
- [~] Asie **scaffoldé** (builders + clients, mockés, live‑deferred) : `IN_IRP`(IRN SHA‑256), `MY MyInvois`(UBL+OAuth2),
  `ID_EFAKTUR`(Coretax) profonds ; `TW_EGUI`·`KZ_ESF`·`PH_EIS`·`TH_ETAX`·`NP_CBMS`·`BD_NBR`·`PK_FBR`·`CN_EFAPIAO`·`VN_TT78` génériques. Reste : champs obligatoires + XSD + sceau DSC/PKCS#7 + clearance.
- [~] Europe (national) **scaffoldé** (builders + clients, mockés, live‑deferred) : `HR_ERACUN`(UBL CIUS‑HR) profond ;
  `UA_TAXINVOICE`·`ME_FISCAL`·`AL_FISCALIZATION` génériques (+ portail `anaf` RO e‑Factura profond).
- [x] `NATIONAL_XML` placeholder → builders dédiés par pays (LATAM/Asie/Afrique/MENA/Europe) via `buildNationalXml()`.

### 1.4 Transverse formats
- [ ] Étendre validation : XSD/Schematron FatturaPA, CFDI, Facturae, + chaque format national.
- [ ] Gap `BR‑27` (prix net ligne / modèle remises EN16931) — modéliser les allowances.

---

## 2. SIGNATURE (`providers/signing/`) — signatures réelles en place

- [x] **XAdES‑BES** (XML) — `xadesjs` + WebCrypto ; **vérifié offline** (signature valide, références résolues). Pour Facturae, FatturaPA option, LATAM, TR.
- [x] **CAdES‑BES** (.p7m) — `node-forge` PKCS#7 ; **vérifié offline**. Pour **SdI** (FatturaPA `.p7m`).
- [x] **PAdES‑B** (PDF) — `@signpdf` + node-forge P12 ; **vérifié offline**. Factur‑X/PDF signés.
- [x] **Algo→provider par profil** : `executor` sélectionne l'algo ; `none` = pass‑through réel ; `SigningCredentialsPort` (mirroir du port creds) ; sans cert → renvoie non signé avec note (testé). 18 tests (cert auto‑signé in‑memory).
- [x] **Stockage cert en DB** : `SigningCertificatesService implements SigningCredentialsPort` (PFX/PKCS#12 + mdp chiffrés AES‑256‑GCM), résolution active par (société, algo, env), check d'expiration, → wiré dans `SigningProviderRegistry` (remplace `NullSigningCredentials`). Modèle `CompanySigningCertificate` + migration + UI upload. 8 tests. [ ] chaîne/renouvellement.
- [ ] **Niveaux ‑T/‑LT/‑LTA + horodatage TSA** — hooks stubbés.
- [x] (réf.) KSeF scelle/chiffre lui‑même côté client ; clés MF vendorisées `certs/ksef/{test,prod}`.

---

## 3. TRANSMISSION (`providers/transmission/`)

### 3.1 Faits / prouvés
- [x] **KSeF** (PL) ✅ round‑trip prouvé (CLEARED + ksefNumber).
- [ ] KSeF : chemin **prod** (clés MF prod) ; archivage **UPO** ; `sendStatus` si requis.
- [x] **PDP** (FR, superpdp propriétaire) ✅ facture acceptée (89xxx).
- [ ] **PDP‑AFNOR** (`apiStyle: afnor`) — ⛔ à prouver live (superpdp expose l'API Flux ; comparer au Swagger
  `AFNOR-Flow_Service-1.0.2-swagger.json`, corriger endpoints/payload si rejet).
- [x] PDP : `sendStatus` (déposée/refusée/encaissée → fr:205/210/211/212) implémenté (mocké, live deferred).
- [ ] PDP : **API Annuaire** (résoudre `buyerEndpointId` du client).
- [x] **Email SMTP par société** 🟢 (`MailService.sendMail(opts, smtpOverrides?)`, fallback global).
- [ ] Email : **preuve réelle** (vrais creds SMTP) + vrai contenu (sujet/corps i18n + PDF + XML).

### 3.2 Implémentés (mocké) — preuve live en attente
- [x] **SdI** (IT) 🟢 — client + mapping des 6 notifiche (RC/NS/MC/NE/DT/AT) + tests.
- [ ] SdI : transport réel **SDICoop (SOAP)**/**SFTP** + **accréditation AdE** + **PFX qualifié** ; signature **CAdES .p7m** ; entrant ; preuve live.
- [x] **Peppol** 🟢 — lookup SMP/SML + envoi passerelle AP + mapping + tests.
- [ ] Peppol : **Access Point** réel + cert AP + lookup SML/SMP réel + MLR/Invoice Response → lifecycle ; preuve live.

### 3.3 PRINT réel · PAC/OSE scaffoldés
- [x] **PRINT** — **réel** : PDF A4 (pdfkit) + QR (qrcode) embarqué, offline ; `transmit`→SENT, fallback universel. Test : magic `%PDF` + QR décodé (jsQR round‑trip).
- [~] **PAC** (MX) — client `timbrar`/`consultaEstado` (mocké) → CLEARED + UUID ; configSchema ; SKIP si non configuré. [ ] PAC réel + sceau SAT.
- [~] **OSE** (PE) — client `enviarComprobante`/`obtenerCdr` (mocké, codes SUNAT) ; `PE_UBL` ajouté. [ ] OSE réel + CDR signé.

### 3.4 Taxonomie portails
- [x] Suppression du `gov-portal` générique ; `GOV_PORTAL_API` **exige un `providerId`** (sinon SKIPPED explicite) + test garde.
- [x] Ajout des providers nommés `choruspro` (FR B2G), `gr-aade` (GR), `hu-nav` (HU) ; ~50 portails nommés présents.
- [ ] Implémenter chaque portail 🔴 (auth + build + submit + poll/`sendStatus` + mapping) :
  - [~] LATAM **scaffoldé** (clients auth/submit/poll, HTTP mocké, live‑deferred) : `afip`(WSAA→WSFE→CAE) ·
    `sefaz`(lote→protocolo) · `sii`(seed→token→EnvioDTE) · `sri`(claveAcceso) · `uy-dgi`(CAE) profonds ;
    `bo-sin`/`cr-hacienda`/`dgii`/`gt-sat`/`pa-dgi`/`sifen`/`sv-mh`/`seniat` génériques. [ ] `dian`(CO) reste stub ; [ ] endpoints/auth réels par autorité.
  - [~] MENA **scaffoldé** : `gib`(TR)·`eg-eta`(EG) profonds ; `jofotara`·`tn-ttn` génériques ; `zatca` (KSA, voir §1.2).
  - [~] Afrique **scaffoldé** (clients mockés, live‑deferred) : `firs`·`ke-kra` profonds ;
    `gh-gra`·`rw-rra`·`tz-tra`·`ug-ura`·`zm-zra`·`zw-zimra`·`ci-dgi`·`bj-dgi` génériques. [ ] auth/endpoints/device réels.
  - [~] Asie **scaffoldé** (clients mockés, live‑deferred) : `in-irp`·`myinvois`·`id-coretax` profonds ;
    `tw-mof`·`kz-isesf`·`ph-bir`·`th-rd`·`np-ird`·`bd-nbr`·`pk-fbr`·`cn-sta`·`vn-gdt` génériques. [ ] auth/endpoints réels.
  - [~] Europe **scaffoldé** (clients mockés, configSchema, live‑deferred) : `anaf`(RO) profond ; `ua-dps`·`me-fiscal`·
    `hr-fiskalizacija`·`al-cis`·`lv-vid`·`sk-financnasprava`·`rs-sef`·`es-aeat`·`gr-aade`·`hu-nav` génériques ; `choruspro` (FR B2G). [ ] auth/cert/endpoints réels.

### 3.5 Transverse transmission
- [x] **`sendStatus` sortant** réel PDP (`/lifecycle_events`) / SdI (esito EC01/EC02) / Peppol (Invoice Response AB/RE/UQ/AP) — config par société, mappage statut→code, erreurs→QUEUED ; tests mockés. Live deferred.
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
- [x] Rejouer les `InboundMessage` reçus mais non appliqués au boot — `InboundRouter.replayUnapplied()` (idempotent, NOOP si déjà appliqué) appelé dans `onApplicationBootstrap` (fire‑and‑forget).
- [x] Câbler les sources de statut : poll (pull) ✅, **webhook push par canal** 🟢 (parsers PDP/SdI/Peppol +
  endpoints typés `/compliance/inbound/{pdp/webhook,sdi/notifica,peppol/mlr}`, secret partagé).
- [ ] Restantes : polling d'inbox (SdI SFTP/mailbox) 🔴, action UI « rafraîchir » 🔴.
- [ ] Compléter le lifecycle par juridiction (statuts/transitions) ; FR push `encaissée` réel ; régimes bloquants MX.

---

## 5. ENTRANT (réception)

- [x] `InboundRouter.receive()` (pur) + webhook controller + corrélation/dedup de base.
- [ ] **Recevoir des factures** (fournisseurs) par canal : PDP, KSeF, SdI, Peppol — parse/valide/stocke/UI.
- [x] **Statuts entrants** par canal → `INBOUND_STATUS` (parsers PDP webhook / SdI notifica RC‑NS‑MC‑NE‑DT‑AT /
  Peppol MLR → `InboundInput`, corrélation par ref externe + dedup ; 21 tests). Reste : re‑armer le callback avec le ref transmit après envoi (corrélation auto, cf. note code).
- [x] **Acks à émettre** — Peppol Invoice Response + SdI esito committente câblés via `sendStatus` (mockés).
- [x] Authenticité des webhooks — gate **secret partagé** en place ; [ ] durcir (signature/mTLS/allowlist).

---

## 6. REPORTING (`reporting/reporting-handler.ts`, `ReportingKind`)

- [x] `reportAll()` câblé + **8 générateurs purs** (E_REPORTING, SAF‑T, OSS, IOSS, EC_SALES_LIST, INTRASTAT, SALES_PURCHASE_LEDGER, CUSTOMS_EXPORT) ; modèle Prisma `ComplianceReport` (migration) ; 30 tests.
- [x] **E_REPORTING** (FR B2C + transfrontalier) — payload structuré (classification du plan). [ ] soumission réelle PDP/PPF (mockée).
- [x] **SAF‑T** — XML OECD SAF‑T 1.04 (xmlbuilder2), structurellement valide. [ ] variantes pays (PL/NO) + XSD.
- [x] **OSS/IOSS/EC_SALES_LIST/INTRASTAT/SALES_PURCHASE_LEDGER/CUSTOMS_EXPORT** — agrégation structurée. [ ] Intrastat `commodityCode` (catalogue produits).
- [x] **Idempotence** (kind, period, company, invoiceRef) — 2e run = no‑op + preuve de dépôt (`markSubmitted` ref). Period key mensuel/trimestriel par kind.
- [ ] **Planification batch** (clôture de période via cron) — seam prêt, cron pas encore ; soumission autorité réelle (mockée).

---

## 7. IDENTIFIANTS & DONNÉES DE RÉFÉRENCE

- [x] **SIREN ← SIRET** (schemeID 0002 = 9 premiers chiffres du SIRET 14).
- [ ] **Routing acheteur** via annuaire (AFNOR Directory / Peppol SMP) plutôt qu'en config société.
- [x] **Validation identifiants — checksums offline** : SIREN/SIRET (Luhn), NIP (mod‑11), VAT FR (mod‑97)/IT/DE (ISO 7064)/ES NIF‑NIE (mod‑23)/PL, Codice Fiscale (mod‑26). `validateContextIdentifiers` câblé en step 0 de l'executor (warnings, non bloquant). 74 tests (valides+invalides cités). RFC/CIF/clé alpha FR = structurel.
- [x] **Existence distante (port)** : `ViesExistenceClient` (VIES REST, sans creds) + `SireneExistenceClient` (INSEE, Bearer) derrière `IdentifierExistencePort` ; défaut `Null` (offline‑safe), tests mockés. Live deferred.
- [ ] Brancher l'existence VIES/SIRENE dans le flux + cache ; durcir clé alpha FR VAT + CIF ES.
- [ ] Champs manquants au modèle : EndpointID/Peppol ID par client, tel/email vendeur, code moyen de paiement, NIC.
- [ ] Table + lookup + cache **annuaire** des participants.

---

## 8. CREDENTIALS & CERTIFICATS

- [x] Config canal par société chiffrée ; `CREDENTIALS_ENCRYPTION_KEY` requise (sinon 503) — à documenter en déploiement.
- [x] **Stockage des certificats de signature** (PFX/PKCS#12 + mdp) par société, chiffré + validité (cf. §2) ; UI upload. [ ] chaîne/renouvellement.
- [ ] Certificats canal : SdI (PFX qualifié), Peppol (cert AP) ; KSeF token ✅ ; PDP OAuth ✅.
- [ ] Rotation des secrets ; audit d'accès ; jamais de secret en clair dans les logs (✅ vérifié pour SMTP).

---

## 9. MATRICE PAR PAYS (profils complets : FR, PL, IT, MX, US, MC, XX)

- **🇫🇷 FR** — [x] EN16931_CII(→PDP) + Factur‑X · [x] PDP(superpdp) · [ ] AFNOR preuve · [ ] ChorusPro B2G ·
  [x] Peppol(mocké) · [x] Email · [ ] signature · [ ] push PDP `encaissée` · [ ] e‑reporting B2C.
- **🇵🇱 PL** — [x] FA(2) · [x] KSeF(test) · [ ] KSeF prod · [ ] archivage UPO.
- **🇮🇹 IT** — [x] FatturaPA(build) · [x] SdI(mocké) · [x] CAdES .p7m (réel) · [x] notifiche entrant (parser) · [ ] SdI live.
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
- [x] Gestion des **certificats de signature** dans les réglages société (onglet « Signing certs » : upload PFX+mdp, sujet/expiry/statut, delete ; secrets write‑only).
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
2. [x] **Signature réelle** (§2) — XAdES/CAdES/PAdES réels + vérifiés offline (reste : store cert DB + TSA).
3. [ ] **Prouver PDP‑AFNOR** + **Email réel** (§3.1) — rapides, creds dispo.
4. [ ] **SdI live** puis **Peppol live** (§3.2) — dès creds/AP.
5. [x] **Entrant statuts** (§5) + **sendStatus** (§3.5) — boucle de statut complète (mockée). Reste : réception de factures fournisseurs + inbox SdI + durcissement webhook.
6. [ ] **Reporting** (§6) + élargissement formats/portails nationaux (§1.3, §3.4) par marché.
