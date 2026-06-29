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
- [x] **XRECHNUNG** — BR‑DE‑11/12 `cac:Contact` + BR‑DE‑14 `PaymentMeans` ; **code UNCL4461** complet (BANK_TRANSFER→58, DIRECT_DEBIT→59 + `PaymentMandate`, CARD→48, PSP→97) + IBAN (`PayeeFinancialAccount`).
- [x] **ZUGFERD** — alias no‑op retiré ; ZUGFeRD 2.x = même profil CII/EN16931 + PDF/A‑3 + CustomizationID que Factur‑X (pas de profil divergent dans `@e-invoice-eu/core`) — alignement documenté.
- [x] **PEPPOL_BIS** — `CustomizationID`/`ProfileID` BIS Billing 3.0 réels injectés (au lieu d'UBL générique).

### 1.2 Formats nationaux majeurs
- [x] **FA_VAT** (PL, FA(2)) — `buildFaVat()` ✅ (prouvé KSeF).
- [x] **FATTURAPA** (IT, 1.2) — build + **XSD validé** (`Schema_VFPR12.xsd`) — transmission SdI à finir (§3).
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
- [x] Validation **XSD FatturaPA 1.2** (`Schema_VFPR12.xsd`) + **XSD CFDI 4.0** (`cfdv40.xsd`+catalogues, 128 MB) + **Schematron Peppol BIS** (`PEPPOL-EN16931-UBL.sch`) vendorisés + câblés (xmllint‑wasm/node‑schematron), tests positifs+négatifs. Builders FatturaPA/CFDI/UBL corrigés pour passer le XSD réel.
- [x] **Allowances document + ligne** — `discountRate`/items négatifs → `AllowanceCharge` doc (BG‑20) + `allowances[]` par ligne (BG‑27) ; **`BR‑27` fermé** (plus de prix net négatif ; `CII_KNOWN_SCHEMATRON_GAPS` vide).
- [ ] Facturae XSD — **introuvable hors‑ligne** (facturae.gob.es + miroirs GitHub 404) ; 2 tests `todo` honnêtes. [ ] XSD/Schematron de chaque format national.

---

## 2. SIGNATURE (`providers/signing/`) — signatures réelles en place

- [x] **XAdES‑BES** (XML) — `xadesjs` + WebCrypto ; **vérifié offline** (signature valide, références résolues). Pour Facturae, FatturaPA option, LATAM, TR.
- [x] **CAdES‑BES** (.p7m) — `node-forge` PKCS#7 ; **vérifié offline**. Pour **SdI** (FatturaPA `.p7m`).
- [x] **PAdES‑B** (PDF) — `@signpdf` + node-forge P12 ; **vérifié offline**. Factur‑X/PDF signés.
- [x] **Algo→provider par profil** : `executor` sélectionne l'algo ; `none` = pass‑through réel ; `SigningCredentialsPort` (mirroir du port creds) ; sans cert → renvoie non signé avec note (testé). 18 tests (cert auto‑signé in‑memory).
- [x] **Stockage cert en DB** : `SigningCertificatesService implements SigningCredentialsPort` (PFX/PKCS#12 + mdp chiffrés AES‑256‑GCM), résolution active par (société, algo, env), check d'expiration, → wiré dans `SigningProviderRegistry` (remplace `NullSigningCredentials`). Modèle `CompanySigningCertificate` + migration + UI upload. 8 tests. [ ] chaîne/renouvellement.
- [x] **Horodatage TSA + niveau ‑T** réels (XAdES `SignatureTimeStamp` ETSI EN 319 132 + CAdES `signature-time-stamp` EN 319 122) via `TsaPort` RFC 3161 (`HttpTsaClient`/`NullTsaClient` défaut offline) ; BES inchangé (byte‑identique). 16 tests (TSA mockée). [ ] ‑LT/‑LTA (CRL/OCSP) + PAdES‑T = seams ; [ ] preuve TSA live.
- [x] (réf.) KSeF scelle/chiffre lui‑même côté client ; clés MF vendorisées `certs/ksef/{test,prod}`.

---

## 3. TRANSMISSION (`providers/transmission/`)

### 3.1 Faits / prouvés
- [x] **KSeF** (PL) ✅ round‑trip prouvé (CLEARED + ksefNumber).
- [x] KSeF : **référence UPO** persistée sur CLEARED (`upoDownloadUrl`→`ComplianceAuthorityId{scheme:UPO}` + ksefNumber). [ ] chemin **prod** (clés MF prod) + télécharger/stocker les **octets UPO** ; `sendStatus` si requis.
- [x] **PDP** (FR, superpdp propriétaire) ✅ facture acceptée (89xxx).
- [x] **PDP‑AFNOR** (`apiStyle: afnor`) — **transport prouvé live** : `POST /afnor-flow/v1/flows` accepte la soumission, flowId réel `i_90103` assigné, transmit→PENDING (fix : `processingRule` omis, sinon superpdp renvoie 501). [ ] validation **contenu** du flow (le sandbox rejette la facture de test — diagnostiquer le motif de rejet AFNOR).
- [x] PDP : `sendStatus` (déposée/refusée/encaissée → fr:205/210/211/212) implémenté (mocké, live deferred).
- [ ] PDP : **API Annuaire** (résoudre `buyerEndpointId` du client).
- [x] **Email SMTP par société** 🟢 (`MailService.sendMail(opts, smtpOverrides?)`, fallback global).
- [x] Email : **preuve réelle SMTP** via Ethereal (`EMAIL_LIVE=1` email-live.spec) — vrai messageId + preview URL à travers `MailService.sendMail`. [ ] vrai contenu i18n soigné (sujet/corps + PDF + XML).

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
    `bo-sin`/`cr-hacienda`/`dgii`/`gt-sat`/`pa-dgi`/`sifen`/`sv-mh`/`seniat` génériques ; `dian`(CO) scaffoldé (OAuth2+UBL+CUFE poll). [ ] endpoints/auth réels par autorité.
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
- [x] **Idempotence des envois** — clé `${base}:${providerId}:${idx}` dédupliquée (TTL 5 min) dans `transmitAll` (duplicate→SKIPPED) + clé executor en `randomUUID`.

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
- [x] **Polling d'inbox** — `InboxPoller` (`@Interval(60s)` + cron‑lock) via `InboxPort` (défaut `NullInboxPort` offline‑safe) → `InboundRouter.receive` (dedup) ; seam SdI SFTP/IMAP. 7 tests.
- [x] Action UI « rafraîchir » (cf. §12).
- [x] Lifecycle par juridiction complété : FR `markPaid`→push `encaissée` (PDP, mocké) ; **MX bloquant** (PENDING_CLEARANCE bloque DELIVER/ACCEPT/REPORT, REJECTED terminal) ; cohérence profils FR/PL/IT/DE/ES/MX (BFS sans état orphelin, `CANCELLED` retiré si non atteignable, entrées pré‑mandat PL/IT). 22 tests.

---

## 5. ENTRANT (réception)

- [x] `InboundRouter.receive()` (pur) + webhook controller + corrélation/dedup de base.
- [x] **Recevoir des factures** (fournisseurs) — modèle `InboundInvoice` (migration) ; parsers CII/UBL/FatturaPA/FA_VAT (structurels) → champs canoniques ; dedup `(channel, externalId)` ; endpoints list/get/accept/reject + `receive/:channel` ; UI page `/received-invoices` + détail + download raw. 8 tests.
- [x] **Statuts entrants** par canal → `INBOUND_STATUS` (parsers PDP webhook / SdI notifica RC‑NS‑MC‑NE‑DT‑AT /
  Peppol MLR → `InboundInput`, corrélation par ref externe + dedup ; 21 tests). Reste : re‑armer le callback avec le ref transmit après envoi (corrélation auto, cf. note code).
- [x] **Acks à émettre** — Peppol Invoice Response + SdI esito committente câblés via `sendStatus` (mockés).
- [x] Authenticité des webhooks — **HMAC‑SHA256** sur le corps brut (`X-Signature`, `timingSafeEqual`) par canal (`WEBHOOK_SECRET_{PDP,SDI,PEPPOL}`) + **IP allowlist** + fallback secret partagé ; appliqué aux 4 endpoints. 12 tests. [ ] mTLS.

---

## 6. REPORTING (`reporting/reporting-handler.ts`, `ReportingKind`)

- [x] `reportAll()` câblé + **8 générateurs purs** (E_REPORTING, SAF‑T, OSS, IOSS, EC_SALES_LIST, INTRASTAT, SALES_PURCHASE_LEDGER, CUSTOMS_EXPORT) ; modèle Prisma `ComplianceReport` (migration) ; 30 tests.
- [x] **E_REPORTING** (FR B2C + transfrontalier) — payload structuré (classification du plan). [ ] soumission réelle PDP/PPF (mockée).
- [x] **SAF‑T** — XML OECD SAF‑T 1.04 (xmlbuilder2), structurellement valide. [ ] variantes pays (PL/NO) + XSD.
- [x] **OSS/IOSS/EC_SALES_LIST/INTRASTAT/SALES_PURCHASE_LEDGER/CUSTOMS_EXPORT** — agrégation structurée. [ ] Intrastat `commodityCode` (catalogue produits).
- [x] **Idempotence** (kind, period, company, invoiceRef) — 2e run = no‑op + preuve de dépôt (`markSubmitted` ref). Period key mensuel/trimestriel par kind.
- [x] **Planification batch** — `@Cron('0 2 * * *')` `tickReportingClose` : clôture les périodes échues, soumet les `ComplianceReport` PENDING (idempotent, comparaison lexicographique periodKey), sous cron‑lock. [ ] soumission autorité réelle (mockée).

---

## 7. IDENTIFIANTS & DONNÉES DE RÉFÉRENCE

- [x] **SIREN ← SIRET** (schemeID 0002 = 9 premiers chiffres du SIRET 14).
- [x] **Routing acheteur via annuaire** — `BuyerDirectoryPort` : `AfnorDirectoryLookup` (PDP `searchDirectoryLines`, SIREN/SIRET→addressingIdentifier) + `SmpBuyerDirectory` (DnsSmpLookup→AP endpoint) ; PDP transmit résout le buyer si absent de la config (non bloquant) ; défaut `Null` offline‑safe. 18 tests. [ ] table/cache annuaire.
- [x] **Validation identifiants — checksums offline** : SIREN/SIRET (Luhn), NIP (mod‑11), VAT FR (mod‑97)/IT/DE (ISO 7064)/ES NIF‑NIE (mod‑23)/PL, Codice Fiscale (mod‑26). `validateContextIdentifiers` câblé en step 0 de l'executor (warnings, non bloquant). 74 tests (valides+invalides cités). RFC/CIF/clé alpha FR = structurel.
- [x] **Existence distante (port)** : `ViesExistenceClient` (VIES REST, sans creds) + `SireneExistenceClient` (INSEE, Bearer) derrière `IdentifierExistencePort` ; défaut `Null` (offline‑safe), tests mockés. Live deferred.
- [x] Existence VIES/SIRENE branchée (executor step 0b, warnings `[existence]` non bloquants) + `CachedExistenceClient` (TTL 24h) ; défaut `Null` (offline‑safe).
- [x] Checksums durcis : **clé alpha FR VAT** (base‑34) + **CIF ES** (algo officiel, routage type d'org) avec vecteurs cités.
- [x] **Identifiants de routage** : `PEPPOL_ENDPOINT` (`schemeId:endpointId`) par client/société via `PartyIdentifier` (sans migration) → `cac:EndpointID schemeID` UBL Peppol BIS + XRechnung (acheteur+vendeur), fallback inchangé ; UI client+société (select scheme 0088/0192/0009/9925…). NIC dérivé du SIRET. tel/email vendeur + code paiement déjà faits. 5 tests rendering.
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
- **🇵🇱 PL** — [x] FA(2) · [x] KSeF(test) · [x] réf UPO sur CLEARED · [ ] KSeF prod · [ ] octets UPO.
- **🇮🇹 IT** — [x] FatturaPA(build) · [x] SdI(mocké) · [x] CAdES .p7m (réel) · [x] notifiche entrant (parser) · [ ] SdI live.
- **🇲🇽 MX** — [ ] CFDI(finir) · [ ] PAC/timbrado · [ ] sceau SAT · [ ] folios bloquants.
- **🇺🇸 US** — [x] post‑audit Email/Peppol (vérifier le profil).
- **🇲🇨 MC** — [x] délègue à FR.
- **XX** — [x] Email/print fallback (vérifier).
- [x] **DE** profil (XRechnung 3.0 + Peppol/Email, POST_AUDIT, GoBD 10 ans, LEITWEG_ID B2G) + **ES** profil (Facturae 3.2.2 + XAdES + SII REAL_TIME_REPORTING + Verifactu E_REPORTING daté). [ ] nouveaux pays archétype→profil.

---

## 10. VALIDATION & QUALITÉ

- [x] Validateur EN16931 (`node-schematron`) + XSD (`xmllint-wasm`).
- [x] XSD/Schematron : **FatturaPA + CFDI + Peppol BIS** vendorisés+câblés (cf. §1.4) ; FA(2) PL + EN16931 CII déjà. [ ] Facturae (introuvable) + formats nationaux.
- [x] Gap `BR‑27` (allowances EN16931) **fermé** (cf. §1.4).
- [x] Harnais de validation par format (XSD/Schematron via lib, docs construits par les vrais builders) : EN16931 CII + FA(2) + FatturaPA + CFDI + Peppol BIS couverts (positif + négatif).

---

## 11. PREUVE LIVE & TESTS

- [x] Round‑trips live : **KSeF** ✅, **PDP‑superpdp** ✅.
- [x] Round‑trips live : **Email** (Ethereal SMTP, messageId réel) ✅ · **PDP‑AFNOR transport** (flowId i_90103) ✅.
- [ ] Round‑trips live restants : PDP‑AFNOR contenu (ack=Error), SdI, Peppol, KSeF prod, chaque portail national (creds).
- [x] Tests d'intégration mockés (filets) : PDP, KSeF, Email, SdI, Peppol, executor‑e2e. **635 tests verts.**
- [x] Discipline « boot test » (l'app démarre, DI/routes OK).
- [ ] Tests gated `*_LIVE=1` par canal, assertions dures (pas de REJECTED/SKIPPED toléré).
- [x] CI : jest backend + cypress e2e (workflow « Tests »).

---

## 12. FRONTEND

- [x] Réglages canaux par pays (cartes Connect/Edit, secrets masqués, erreurs surfacées, auto‑fill).
- [x] Flow lifecycle (badges, available‑actions, pipeline, timeline).
- [x] Affichage des **factures entrantes** — page `/received-invoices` (table date/n°/expéditeur/montant/canal/statut, détail, accept/reject, download raw) + entrée sidebar.
- [x] Étiquette « disponible à partir du {date} » — badge ambre `availableFrom` futur dans channels.settings.
- [x] Gestion des **certificats de signature** dans les réglages société (onglet « Signing certs » : upload PFX+mdp, sujet/expiry/statut, delete ; secrets write‑only).
- [x] Action « rafraîchir le statut » — bouton dans la timeline compliance → `POST /compliance/documents/:id/refresh` (reconcile one‑off).

---

## 13. INFRA / DÉPLOIEMENT

- [x] `CREDENTIALS_ENCRYPTION_KEY` (générée localement, gitignored) ; PEM KSeF copiés au build (`**/*.pem`).
- [x] `xmllint-wasm` + `maxWorkers:4` jest.
- [x] Env : `COMPLIANCE_RECONCILE_HOURS` (défaut 12) — câblé au sweep périodique.
- [ ] Env : PEM KSeF **prod**, clés/URL par défaut.
- [x] Verrou cron multi‑instances — **lease table** `CronLock` (upsert atomique `ON CONFLICT … WHERE lockedUntil < NOW()`), TTL par tick, fail‑open ; enveloppe poll/timer/reconcile/reporting‑close. Migration `add_cron_lock`.

---

## Ordre conseillé
1. [x] **Lifecycle freshness** (§4 : boot + sweep 12h) — fait (reste : replay inbound + webhooks push par canal).
2. [x] **Signature réelle** (§2) — XAdES/CAdES/PAdES réels + vérifiés offline (reste : store cert DB + TSA).
3. [x] **PDP‑AFNOR transport prouvé** (flowId i_90103) ; [ ] validation contenu AFNOR + **Email réel** (§3.1).
4. [ ] **SdI live** puis **Peppol live** (§3.2) — dès creds/AP.
5. [x] **Entrant statuts** (§5) + **sendStatus** (§3.5) — boucle de statut complète (mockée). Reste : réception de factures fournisseurs + inbox SdI + durcissement webhook.
6. [ ] **Reporting** (§6) + élargissement formats/portails nationaux (§1.3, §3.4) par marché.
