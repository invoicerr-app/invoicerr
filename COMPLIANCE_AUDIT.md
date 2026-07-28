# AUDIT — Architecture compliance / e-invoicing

> Audit READ-ONLY réalisé le 2026-07-12 sur `feat/compliance-architecture` (PR #363).
> Méthode : 9 audits parallèles (FR, PL, IT, Peppol/DE/ES, matrice 106 pays, axes
> architecture / wiring / tests / frontend), chaque affirmation vérifiée dans le code
> (fichier:ligne) ; les findings bloquants ont été re-vérifiés indépendamment par
> l'orchestrateur. Aucun code modifié.
>
> **Preuves exécutées pendant l'audit** : `npm run build` backend ✅ + frontend (`tsc -b && vite build`) ✅ ·
> suite jest complète **1455 passed / 0 failed** (68 skipped = specs live gated, attendu) ·
> boot réel de l'app ✅ (« Nest application successfully started », 146 routes dont 22 compliance,
> aucune `UnknownDependenciesException`) · CI PR #363 verte (Docker Build ✅, Business Scenarios ✅,
> Cypress ✅).

---

## Verdict en une phrase

L'architecture déclarative (« a country is data », profils × archétypes × registries × ports) est
**saine et sans orphelin** (garanti par CI), les briques individuelles (formats, crypto KSeF,
signature XAdES/CAdES/PAdES, clients PDP/SdI/Peppol) sont **réelles et bien testées isolément** —
mais le **câblage bout-en-bout est cassé à plusieurs maillons centraux** : la boucle de statut
asynchrone ne peut jamais fonctionner en production (3 verrous indépendants), le statut d'un
document ment quand la transmission échoue, la sélection de signature ignore le pays/syntaxe, et
une faille multi-tenant traverse presque tous les controllers compliance. Rien de tout cela n'est
visible dans la suite de tests (1455 verts) parce que les tests — y compris les preuves live —
contournent précisément ces maillons.

---

## 1. MATRICE PAR PAYS

Légende : ✅ prouvé-live · 🟢 implémenté (mocké/offline-vérifié) · 🟡 partiel/scaffold ·
🔴 stub / cassé · ⛔ absent.

Note colonne **Signature** : le schéma de profil n'a **aucun champ signature** — l'algo est dérivé
par `executor.chooseSignAlgo()` (executor.ts:113-116) qui ne connaît que `XAdES|none`
(`regime.blocking || archival.integrity==='SIGNED'` → XAdES). La colonne montre *ce que le
pipeline ferait réellement* vs ce que le pays exige.

### 1.1 Profils bespoke (OFFICIAL)

| Pays | Format | Canal | Signature | Numérotation | Champs obligatoires | Inbound | Statut global |
|---|---|---|---|---|---|---|---|
| **FR** | 🟢 EN16931_CII (primary) + FACTURX PDF/A-3 (human), build réel `@e-invoice-eu/core`, `cii-post-process` minimal — mais validation Schematron EN16931 **jamais exécutée en prod** (F-11) | ✅ PDP transport prouvé live (superpdp) / 🟢 AFNOR transport prouvé, contenu rejeté / 🔴 **Chorus Pro B2G non fonctionnel** (F-6) / 🔴 boucle de statut cassée (F-2/F-3) | 🟢 `none` — cohérent (piste d'audit fiable + hash-chain), pas un bug | ✅ GAPLESS_SELF réel DB-backed + hash-chain réel (`immutableHash`/`previousHash`) | 🟢 SIRET requis + Luhn réel, TVA ; endpoint required-fields OK | 🟢 factures fournisseurs (dedup+scoping réels) / 🔴 webhook statut PDP inopérant (F-2) | ⚠️ transport prouvé, boucle de statut et B2G cassés |
| **PL** | 🟢 FA_VAT **FA(2) uniquement** — FA(3) absent malgré KSeF 2.0 (F-14) ; XSD réel mais résultat jeté (F-11) ; corrections = stub (F-13) | ✅ KSeF émission prouvée live (CLEARED + ksefNumber, env test) / 🔴 prod = crash ENOENT (PEM MF prod absents, F-10) / 🔴 poll prod cassé (F-3) | 🔴 collision latente : `chooseSignAlgo`→XAdES pour PL (blocking+SIGNED) → FA_VAT enveloppé XAdES si un cert est configuré → non conforme XSD KSeF (F-5) | ✅ bonne séparation : numéro facture GAPLESS_SELF ≠ `ksefNumber` (authorityId) | 🟢 NIP requis + checksum réel, REGON optionnel, onboarding câblé | ⛔ **réception des factures d'achat KSeF absente** et non trackée (F-15) | ⚠️ émission prouvée, prod/corrections/inbound manquants |
| **IT** | 🟢 FatturaPA 1.2 via `@digitalia/fatturapa` + XSD réel + business-rules yup — mais toujours FPR12, `CodiceDestinatario:'XXXXXXX'` (F-16), pas de bollo/ritenuta/forfettario (F-17) | 🟢 SdI honnêtement stubé (port SOAP SDICoop fidèle, `throw` explicite, pas de faux transport) — accréditation AdE manquante / 🔴 corrélation notifiche cassée (F-2) | 🔴 CAdES `.p7m` réel mais **jamais sélectionné** — le pipeline signerait XAdES (mauvaise enveloppe pour SdI) (F-5) | 🟢 GAPLESS_SELF ; progressivo SdI dérivé d'une clé arbitraire (mineur) | 🟢 P.IVA + Codice Fiscale avec checksums réels / ⛔ Codice Destinatario & PEC jamais modélisés ni demandés (F-16) | 🟢 notifiche parsées (6 types) mais UNMATCHED (F-2) / 🔴 pas de désenveloppement `.p7m` des factures fournisseurs (M-11) | ⚠️ format solide, canal/signature/statut cassés bout-en-bout |
| **DE** | 🟢 XRechnung 3.0 — builder émet Contact/PaymentMeans (BR-DE-11/12/14) mais **aucune validation BR-DE** (stub `valid:true`, F-18) ; CustomizationID CIUS non injecté ; Leitweg-ID déclaré au profil mais jamais injecté au XML | 🔴 PEPPOL déclaré mais **structurellement inatteignable** (F-7) / 🟢 EMAIL réel | 🟢 `none` — cohérent (post-audit, GoBD sans signature) | 🟢 GAPLESS_SELF | 🟢 USt-IdNr (checksum ISO 7064), Leitweg-ID déclaré | ⛔ aucun canal de retour | ⚠️ post-audit OK par email ; Peppol/B2G non fonctionnels |
| **ES** | 🟢 Facturae 3.2.2 + XSD officiel vendorisé **réellement testé** (meilleure preuve du lot) ; risque décimales >8 non arrondies (M-13) | 🔴 `es-aeat` = tier generic-portal (HTTP port qui throw, F-8) / 🔴 PEPPOL inatteignable (F-7) / ⛔ **FACe B2G absent** malgré le commentaire du profil (F-19) | 🟢 XAdES via `xadesjs` — correct pour Facturae (le seul pays où l'heuristique tombe juste) | 🟢 GAPLESS_SELF (seriesScope YEAR) | ✅ NIF/CIF checksums réels (mod-23 + algo CIF officiel) | ⛔ | ⚠️ format prouvé offline ; SII/Verifactu stubs génériques + date Verifactu douteuse (F-20) |
| **MX** | 🟡 CFDI 4.0 partiel (seam Sello/CSD, pas de timbrado PAC) | 🟡 PAC implémenté-mocké, PAC réel manquant (connu) | 🔴 XAdES choisi par l'heuristique — le CFDI exige un sello CSD, pas du XAdES | 🔴 **AUTHORITY_RANGE jamais alimenté** : `FolioPool.loadRange()` sans aucun appelant → aucune facture MX n'obtient de numéro, warning avalé (F-9) | 🟢 RFC/CURP déclarés | ⛔ | 🔴 « cas canonique CLEARANCE » du projet, non fonctionnel |
| **US** | 🟢 PLAIN_PDF | 🟢 EMAIL réel | 🟢 none | 🟢 GAPLESS_SELF | EIN optionnel | ⛔ (pas de mandat) | ✅ pour ce qu'il prétend (post-audit sans mandat) |
| **MC** | délègue à FR (`delegatesTo`, résolution testée) | — | — | — | — | — | 🟢 délégation propre |

### 1.2 Archétypes régionaux (98 profils) — condensé

Mécanique de résolution vérifiée par script + garantie CI (`profiles/data-integrity.spec.ts`) :
**0 syntax orpheline, 0 providerId orphelin** sur 53+53 déclarés ; `GOV_PORTAL_API` sans
`providerId` → SKIPPED explicite (garde runtime + test). `NATIONAL_XML` n'est utilisé
qu'explicitement (GR, HU). Fallback `XX` : PLAIN_PDF+EMAIL, `taxSystem NONE`, safe et testé.

| Tier | Pays | Statut réel |
|---|---|---|
| Clients « profonds » (auth/submit/poll réels, HTTP mocké) | RO/anaf, AR/afip, BR/sefaz, CL/sii, CO/dian, EC/sri, UY/uy-dgi, PE/OSE, TR/gib, EG/eg-eta, NG/firs, KE/ke-kra, IN/in-irp, MY/myinvois, ID/id-coretax | 🟢 implémentés, jamais prouvés live (creds par autorité manquants — connu, §14 COMPLIANCE_TODO) |
| Generic-portal (37 pays : ES/GR/HU + LATAM/MENA/Africa/Asia/Europe long-tail) | bo-sin, cr-hacienda, dgii, gt-sat, pa-dgi, sifen, sv-mh, seniat, jofotara, tn-ttn, gh-gra, rw-rra, tz-tra, ug-ura, zm-zra, zw-zimra, ci-dgi, bj-dgi, tw-mof, kz-isesf, ph-bir, th-rd, np-ird, bd-nbr, pk-fbr, cn-sta, vn-gdt, ua-dps, me-fiscal, hr-fiskalizacija, al-cis, lv-vid, sk-financnasprava, rs-sef, es-aeat, gr-aade, hu-nav | 🔴 structurellement non câblables : `SimpleHttpPort` par défaut **throw**, aucun point d'injection d'un port réel n'existe en prod (F-8). Échec géré proprement (REJECTED) mais jamais consulté par `send()` (F-4) |
| ZATCA (SA) | zatca | 🔴⚠ **stub à faux-succès** : sans `configSchema`, `transmit()` appelé sans creds renvoie PENDING pour toujours, jamais SKIPPED/REJECTED (F-1 de la matrice, ici F-8bis) |
| Post-audit Peppol/Email (UE + AU/NZ/JP…) | AT, BE, NL, SE, NO, PT, DK, FI, EE, LT, LU, LV, MT, BG, CY, CZ, MD, LI, AO, MZ, AU, NZ, JP, SG, AE… | 🟢 email réel ; Peppol réel **seulement si** le format primaire est PEPPOL_BIS/EN16931_UBL/CII (vrai pour ces profils, contrairement à DE/ES) |
| Planifié / pas de mandat | ~18 (GB, CH, CA, VA, BH, OM, QA, KW, DZ, MA, CM, SN, ET, BA, MK, HN, NI, LK + IE/SI en attente de bascule) | 🟡 correctement modélisés, rien à faire |

Approximations réglementaires long-tail relevées (BEST_EFFORT assumé) : AR `AUTHORITY_RANGE`
probablement faux (AFIP = auto-numérotation + CAE a posteriori) ; BR modélisé en VAT unique 17 %
(réalité : ICMS/ISS/IPI/PIS/COFINS) ; MY `vat(8)` pour une SST (auto-flagué dans le code) ;
TR e-Fatura/e-Arşiv non distingués ; SA/IN sans découpage B2B/B2C alors que le schéma le permet.

---

## 2. FINDINGS

Classés par sévérité. Chaque finding vérifié dans le code ; ceux marqués **[vérifié orchestrateur]**
ont été re-contrôlés indépendamment du subagent qui les a trouvés.

### 🔴 BLOQUANT

**F-1 — IDOR / fuite cross-tenant sur la quasi-totalité des controllers compliance.** [vérifié orchestrateur]
`nest/channel-credentials.controller.ts:33-106`, `nest/signing-certificates.controller.ts:35-101`,
`nest/inbound-invoice.controller.ts:76-98`, `nest/audit-export.controller.ts:11-14`,
`nest/compliance-pipeline.service.ts:57,129`.
- *Symptôme* : `companyId` pris de l'URL (`@Param`) sans jamais être comparé à `request.companyId`
  (session), aucun `@Roles` (le `RolesGuard` global est no-op sans décorateur) ; le pattern correct
  `@ActiveCompany()` existe et est utilisé partout ailleurs (`invoices.controller.ts:34`).
  `CompliancePipelineService` et `ComplianceService.list()` (audit-export) n'ont **aucun** filtre société.
- *Pourquoi* : n'importe quel utilisateur authentifié (MEMBER inclus, société tierce incluse) peut
  lire/écraser/supprimer les credentials de canal (token KSeF, OAuth PDP…) et **uploader un
  certificat de signature PFX** pour n'importe quelle société ; `/compliance` et l'export CSV
  d'audit exposent les documents/rapports de **toutes** les sociétés. C'est une escalade
  horizontale, pas un simple défaut de rôle. Aucun spec ne couvre le scoping de ces controllers.
- *Correctif* : `@ActiveCompany()` + vérification `companyId === request.companyId` (ou
  appartenance multi-société) sur tous les handlers ; `@Roles(OWNER, ADMIN)` sur les mutations
  credentials/certs ; filtre `companyId` dans `CompliancePipelineService` (documents via
  `invoice.companyId` — `ComplianceDocument` n'a pas de colonne directe) et `list()` ; spec
  « user A ne voit pas B ».

**F-2 — La boucle de statut asynchrone est débranchée du flux réel : le runtime lifecycle + 3 drivers ne sont jamais armés.** [vérifié orchestrateur]
`operations/compliance-service.ts:210-237` (aucune référence à ApplySignal/runtime — grep vérifié),
`nest/apply-signal.ts:82-124` (seul endroit qui crée PollJob/CallbackRegistration),
`lifecycle/triggers.ts:42-43`, `lifecycle/drivers/inbound-parsers.ts:17-25` (aveu explicite en
commentaire), `lifecycle/runtime.ts:142-158`.
- *Symptôme* : `ComplianceService.send()` (le vrai chemin appelé par `invoices.service.ts:1309`)
  avance les statuts via sa state machine privée `transition()` et **n'émet jamais de signal** dans
  le runtime event-sourcé. Seul `ApplySignalService.apply()` traduit les effets `SCHEDULE_POLL`/
  `AWAIT_CALLBACK` en jobs persistés — et il n'est appelé que par les drivers eux-mêmes. Donc pour
  une facture réelle : **aucun PollJob créé, aucune CallbackRegistration**. S'y ajoutent deux
  verrous supplémentaires : (b) même armé, `correlationKey` serait `documentId` interne alors que
  les webhooks arrivent avec l'ID externe (`invoice_id` PDP / `idSdI` / `messageId` Peppol) →
  UNMATCHED garanti ; (c) même corrélé, `eventForStatus()` ne reconnaît que des mots-clés
  (`accept/refus/…`) — les codes `fr:205`/`fr:210` du PDP ne matchent rien → NOOP silencieux.
  Et aucun POLL de secours n'est armé pour les canaux `ASYNC_CALLBACK` (PDP/SdI/Peppol).
- *Pourquoi* : une facture FR/IT/Peppol envoyée par l'app reste en `PENDING_CLEARANCE`/`DELIVERED`
  **pour toujours** ; le webhook authentifié et le cron 30 s existent mais sont des culs-de-sac.
  Le joyau de l'architecture (runtime + drivers, 349 tests verts) tourne à vide. Les preuves live
  (pdp-live, ksef-live, peppol-sh-live) appellent `transmit()`/`poll()` directement au niveau
  provider et ne peuvent pas révéler ce trou.
- *Correctif* : router `send()`/`issue()` à travers `ApplySignalService` (unifier les deux state
  machines) ; après `transmit()`, persister `TransmissionResult.ref` et enregistrer le callback
  avec cet ID externe comme `correlationKey` ; traduire les codes canal (fr:xxx, notifiche, MLR)
  avant `eventForStatus` ; armer un POLL de secours pour `ASYNC_CALLBACK`.

**F-3 — PollScheduler et ApplySignalService câblés sur la registry NUE (sans credentials) : le poll ne peut jamais résoudre un statut en prod.** [vérifié orchestrateur]
`nest/compliance.module.ts:82-90` (`txRegistry: defaultTransmissionRegistry`) et
`new ApplySignalService(prisma)` (txRegistry par défaut) vs la vraie registry DI construite avec
`{mail, credentials}` quelques lignes plus haut ; `providers/transmission/registry.ts:196`
(`export const defaultTransmissionRegistry = new TransmissionProviderRegistry()` → tous les
providers avec `credentials: undefined`) ; `ksef-transmission.ts:180` / `pdp-transmission.ts:324-326`
(`if (!this.credentials) → PENDING 'no credentials port'`).
- *Pourquoi* : même si F-2 était corrigé, chaque tick 30 s et chaque reconcile renverraient
  PENDING pour toujours. KSeF n'a pas de webhook : le statut CLEARED est **inatteignable** par
  l'application. Double verrou avec F-2.
- *Correctif* : injecter le token DI `TransmissionProviderRegistry` dans les factories de
  `PollScheduler` et `ApplySignalService`.

**F-4 — `send()` ignore le résultat réel de la transmission : le statut ment.** [vérifié orchestrateur]
`operations/compliance-service.ts:211-237` — `execution.transmissions[]` (SENT/SKIPPED/REJECTED/…)
n'est jamais inspecté ; transition inconditionnelle vers `DELIVER` ou `SUBMIT_CLEARANCE`.
- *Pourquoi* : tous canaux SKIPPED (pas de creds/config) ou REJECTED (generic-portal qui throw) →
  le document passe quand même à `DELIVERED`/`PENDING_CLEARANCE` et l'invoice à `SENT`
  (`invoices.service.ts:1315-1319`), sans aucun signal utilisateur. Combiné au message d'erreur
  unique « check your SMTP configuration » (`invoices.service.ts:1308-1313`) hors-sujet pour les
  autres canaux. Aggravé par l'absence totale d'état `ERROR/FAILED` dans la state machine
  (`lifecycle/state-machine.ts:5-19`).
- *Correctif* : inspecter `execution.transmissions` ; refuser DELIVER si tout est SKIPPED/REJECTED ;
  introduire un état/flag d'échec exposé à l'UI.

**F-5 — Sélection de signature aveugle au pays/syntaxe : CAdES et PAdES sont du code mort ; XAdES appliqué à tort à PL/IT/MX.** [vérifié orchestrateur]
`execution/executor.ts:113-116` (`chooseSignAlgo` : binaire XAdES/none), `:171-172` (certRef par
companyId, tous artifacts signés sans filtre) ; grep : `'CAdES'` n'est jamais retourné hors
specs/providers.
- *Pourquoi* : IT (blocking+SIGNED) → XAdES enveloppé au lieu du `.p7m` CAdES exigé par SdI ;
  PL → FA_VAT enveloppé XAdES (non conforme au XSD KSeF) dès qu'un cert est configuré pour la
  société (résolution par companyId, pas par pays — réel pour un tenant multi-juridictions) ;
  MX → XAdES au lieu du sello CSD. Le `[x] CAdES .p7m (réel)` du COMPLIANCE_TODO est vrai en
  isolation, faux bout-en-bout. Aucun test n'asserte l'algo réellement appliqué
  (`execution/europe.spec.ts` s'arrête à la présence de l'artefact). Latent aujourd'hui uniquement
  parce que sans cert configuré le provider repasse l'artifact inchangé (filet accidentel).
- *Correctif* : dispatcher l'algo par `RenderedArtifact.syntax` (FATTURAPA→CAdES, FA_VAT→none,
  ES_FACTURAE→XAdES, PDF→PAdES) ou ajouter un champ signature déclaratif au profil ; test qui
  asserte `signature.algo` par pays.

**F-6 — Chorus Pro (FR B2G) ne peut pas fonctionner, même avec des creds PISTE valides.**
`providers/transmission/choruspro-transmission.ts:103-107` (`STUB_HTTP.post` → throw,
utilisé en dur dans transmit/poll l.191/247 ; aucune implémentation réelle du port dans le repo) +
`providers/transmission/national-portals.ts:121` (`new ChorusProTransmissionProvider()` instancié
**sans** credentials, contrairement à tous ses voisins).
- *Pourquoi* : le TODO §14 dit « il manque les creds » — en réalité il manque aussi le transport
  HTTP. Le mapping statuts/syntaxe est correct ; seul l'adaptateur n'a jamais été écrit. En prime,
  le spec live `choruspro-live.spec.ts:125-130` peut passer VERT sans déposer de facture (return
  anticipé si TECH_LOGIN/PASSWORD absents, non couverts par le gate) — faux-vert du pattern KSeF.
- *Correctif* : implémenter `ChorusProHttpPort` (fetch), passer `providers?.credentials` au
  constructeur, durcir le gate du spec live.

**F-7 — Peppol structurellement inatteignable pour DE et ES (et tout pays à CIUS national).** [vérifié orchestrateur]
`engine/compliance-engine.ts:157-178` (`buildArtifacts` n'émet que primary/human/buyer du profil)
vs `providers/transmission/peppol-transmission.ts:180-191` (cherche exclusivement
PEPPOL_BIS/EN16931_UBL/EN16931_CII).
- *Pourquoi* : DE (primary XRECHNUNG) et ES (primary ES_FACTURAE) déclarent PEPPOL dans leurs
  canaux mais l'artifact compatible n'est jamais construit → SKIPPED garanti à chaque envoi. La
  preuve live peppol.sh (2026-07-11) injecte l'artifact `PEPPOL_BIS` à la main et contourne
  exactement ce point. FR passe par chance (primary EN16931_CII).
- *Correctif* : croiser canaux et artifacts dans `buildArtifacts()` (ajouter un artifact
  PEPPOL_BIS/UBL quand `channels` contient PEPPOL) ; test du chemin complet
  `resolve(DE) → execute → transmit`.

**F-8 — Tier generic-portal (37 pays) : transport structurellement mort + ZATCA en faux-succès.**
`providers/transmission/generic-portal.ts:138-146` (SimpleHttpPort par défaut → throw ; aucun
point d'injection d'un port réel : les 5 fichiers régionaux appellent `buildGenericPortalProviders`
sans httpPort, `compliance.module.ts` n'en passe pas non plus) ; cas aggravé **ZATCA** :
`national-portals.ts:94-100` construit `zatca` sans `configSchema` → `transmitAll` saute la
résolution de creds et le stub renvoie **PENDING pour toujours** (jamais SKIPPED/REJECTED) — une
facture saoudienne est « en cours de clearance » éternellement sans aucun I/O.
- *Pourquoi* : combiné à F-4, un utilisateur de ces 37 pays configure ses creds (l'UI le laisse
  faire, cf. M-16), envoie, voit `SENT` — et rien n'est jamais parti. Le job CI
  `national-portals-live` ne pourra **jamais** réussir même avec de vrais secrets tant que le port
  HTTP n'existe pas (illusion de « il ne manque que les creds »).
- *Correctif* : ajouter `configSchema` à zatca (ou le migrer vers generic-portal) ; prévoir un
  point d'injection httpPort ; exposer un flag de maturité par provider (cf. M-16).

**F-9 — AUTHORITY_RANGE (MX/AR/CL) : `FolioPool.loadRange()` n'a aucun appelant — la numérotation ne peut jamais fonctionner.**
`lifecycle/numbering.ts:41-58` ; grep : seul `numbering.ts` référence `loadRange`. L'erreur est
avalée en warning (`compliance-service.ts:178-184` / `executor.ts:156-160`) et le document passe
quand même à ISSUED avec `number: undefined`.
- *Pourquoi* : MX est documenté comme « the canonical CLEARANCE case » (mx.ts:4-8) et ne peut pas
  émettre. Note : pour AR le modèle lui-même est probablement faux (AFIP = auto-numérotation +
  CAE a posteriori, pas d'allocation de plage).
- *Correctif* : endpoint/service de chargement de ranges (PAC/SAT, CAF SII) + blocage dur de
  l'issue quand le modèle est AUTHORITY_RANGE sans range ; requalifier AR en GAPLESS_SELF.

**F-10 — KSeF prod : clés publiques MF absentes → crash ENOENT au premier envoi prod.**
`providers/transmission/ksef/ksef-public-keys.ts:39-43` (readFileSync fail-fast) ; seul
`certs/ksef/test/` existe sur disque. Déjà tracké (COMPLIANCE_TODO §14 item 10) mais aucun garde-fou :
une société configurée `environment=prod` crashe à l'envoi, pas à la config.
- *Correctif* : vendoriser les PEM prod avant tout go-live PL + refuser `environment=prod` dans
  `channel-settings.service.ts` tant que les clés manquent.

### 🟠 MAJEUR

**M-1 — Validation format jamais bloquante, et Schematron EN16931 jamais exécuté en prod pour CII/Factur-X.** [vérifié orchestrateur]
`providers/format/registry.ts:68` (`await provider.validate(built, log)` — résultat jeté pour
TOUTES les syntaxes) ; `providers/format/providers.ts:98-102` (pour tout sauf PEPPOL_BIS :
`log.todo` + `valid:true`) ; `operations/compliance-service.ts:502-509` (`validate()` = stub).
Le Schematron réel (`node-schematron`) et les XSD (xmllint-wasm) existent et sont testés — mais
uniquement depuis les specs. Rien n'empêche de transmettre un CII/FA_VAT/FatturaPA invalide.

**M-2 — Erreurs compliance avalées sur 10 points d'intégration sur 11.**
`invoices.service.ts` (createInvoice :314, issueInvoice :392, correctInvoice :572,
cancelAndReplace :740, edit :921, delete :983, archive :1239, proforma :1407, deposit :1590) +
`payments.service.ts:277-294` — l'invoice est déjà committée puis l'appel compliance échoue en
`logger.warn` silencieux ; seul `sendInvoiceByEmail` re-throw. Aucun état ERROR (cf. F-4) : un
ComplianceDocument peut rester en DRAFT à vie sans aucun signal UI.

**M-3 — Archivage légal = stub pur pour tous les pays.**
`providers/archive/providers.ts:13-49` — URI factice + `contentHash: 'stub-sha256'` codé en dur ;
aucun octet stocké, malgré `retentionYears: 10` déclaré par FR/PL/IT/DE/ES. (Le hash-chain
d'intégrité du document, lui, est réel.) De même **PL : les octets UPO ne sont jamais téléchargés**
— seule l'URL (expirable, `downloadUrlExpirationDate` jamais lu) est persistée
(`ksef-transmission.ts:271-287`).

**M-4 — PL : corrections post-clearance (faktura korygująca) = stub complet.**
`lifecycle/corrections.ts:29-34` (`log.todo`) alors que `cancellation.allowed=false` fait de
CORRECTIVE_INVOICE le **seul** mécanisme légal de correction PL post-2026-02 ; le builder ne sait
produire que `RodzajFaktury:'VAT'` (fa-vat.ts:170), jamais KOR.

**M-5 — PL : FA(3) absent malgré KSeF 2.0.**
`fa-vat.ts:105-109` (namespace crd.gov.pl/2023, `kodSystemowy="FA (2)"` en dur), seuls des XSD
FA(2) vendorisés ; les commentaires « (FA(2)/FA(3)) » sont trompeurs. La preuve live du 2026-06-28
montre que l'env test acceptait encore FA(2) ; l'échéance réelle de bascule FA(3) est à confirmer,
mais aucune logique de version n'existe.

**M-6 — PL : réception des factures d'achat via KSeF totalement absente et non trackée.**
Grep exhaustif : aucun code, `ksef-client.ts` n'expose aucun endpoint de query entrante, aucune
mention dans COMPLIANCE_TODO. Obligation métier de base d'un acheteur PL en régime KSeF — angle
mort complet (même pas un stub).

**M-7 — IT : la notifica NE (esito EC01/EC02) n'a aucun état d'atterrissage.**
`it.ts` ne déclare pas `lifecycle.response` → `BuyerResponsePhase` ne contribue jamais
AWAITING_RESPONSE/REFUSED au graphe IT ; un refus acheteur arrivé après livraison est
silencieusement droppé (`log.todo`, runtime.ts:142-158).

**M-8 — IT : B2G impossible et données fiscales manquantes.**
`fattura-pa.ts:104-169` : FPR12 + `CodiceDestinatario:'XXXXXXX'` en dur, jamais FPA12/code réel ;
Codice Destinatario/PEC absents du modèle et des `requiredIdentifiers` (jamais demandés à
l'onboarding) ; pas de DatiBollo/DatiRitenuta ; `RegimeFiscale:'RF01'` en dur (pas de RF19
forfettario — cœur de cible indépendants IT) ; `taxSystem.schemes` sans FLAT_RATE.

**M-9 — DE : XRechnung sans aucune validation BR-DE ; Leitweg-ID jamais injecté.**
`providers.ts:98-102` (stub valid:true), aucun Schematron `schemas/de/`, `knownGap` des fixtures
lu par aucun test (gate mort) ; CustomizationID CIUS XRechnung non injecté (générique EN16931) ;
Leitweg-ID déclaré au profil mais aucune trace dans le builder → B2G DE non conforme.

**M-10 — ES : FACe absent, SII/Verifactu génériques, date Verifactu douteuse.**
`es.ts:19` (commentaire prometteur) vs canaux réels sans FACe ; `reporting/generators.ts:49-105`
(E_REPORTING FR-shaped : supplierSiret !) et `:386-423` (ledger PE/CL-shaped) réutilisés pour ES —
aucune ressemblance avec SuministroLR ni le hash-chain Huella/QR Verifactu ; `es.ts:105`
`validFrom: '2025-07-01'` vs mandat réel scindé 2026-01/2026-07 selon contribuable (à confirmer).

**M-11 — IT : pas de désenveloppement `.p7m` des factures fournisseurs.**
`reception/` : zéro référence pkcs7/p7m — une fattura passive signée (cas courant) part dans le
parser regex comme du binaire → champs faux ou vides sans erreur signalée.

**M-12 — Race conditions : double-send possible + apply-signal non verrouillé.**
(a) `compliance-service.ts:208-230` : `executor.execute()` (effet de bord réel) AVANT la garde de
state machine ; l'appelant ne passe pas d'idempotencyKey → clé aléatoire à chaque appel → le dédup
5 min ne protège rien : double-clic = double email/double soumission autorité.
(b) `nest/apply-signal.ts:43-53` : lecture du doc hors transaction, pas de verrou optimiste — un
poll et un webhook simultanés peuvent écrire des statuts incohérents avec l'historique d'events.

**M-13 — Webhook `received-invoices` : authentification faible et fail-open silencieux.**
`nest/inbound-invoice.controller.ts:30-39` : comparaison `!==` non constant-time d'un secret
partagé, skip **sans aucun log** si `COMPLIANCE_WEBHOOK_SECRET` absent, `body.companyId` pris du
payload non authentifié → injection de factures reçues pour n'importe quelle société. La solution
(`assertWebhookAuth` HMAC + timingSafeEqual + allowlist IP) existe dans le fichier voisin
`webhook-auth.ts` et est utilisée par l'endpoint jumeau — dérive documentée par les TODO du fichier
lui-même. L'endpoint jumeau `/compliance/inbound/:channel` est correct mais fail-open (warn
one-shot) sans secret configuré.

**M-14 — Intégrité des tests : 3 specs live tolérants + 1 chemin critique jamais couvert en CI.**
`pdp-live.spec.ts:200` tolère REJECTED en fin de poll (contredit son propre commentaire l.181-182
et le hard-success contract de live-gate.ts) ; `peppol-live.spec.ts:214` tolère PENDING/SENT après
la boucle ; `choruspro-live.spec.ts` cf. F-6 ; `nest/apply-signal.live.spec.ts` gaté par
`COMPLIANCE_LIVE_DB_TESTS` **jamais défini dans aucun workflow** → la transition d'état atomique
n'a jamais tourné en CI. E2e : `assertCompliance()` (full-lifecycle.cy.ts:23-33) vérifie seulement
qu'un statut existe, pas sa valeur — passerait avec REJECTED.

**M-15 — Le workflow live n'a JAMAIS tourné avec succès en CI.** [vérifié orchestrateur]
`gh run list --workflow compliance-live.yml` : un seul run (2026-06-30, échec, ancienne version du
fichier déclenchée par push). Le cron nightly (`schedule: 0 3 * * *`) **ne se déclenchera jamais
depuis la branche** : GitHub n'exécute les workflows `schedule` que depuis la branche par défaut
(`main`). Toutes les preuves live (KSeF, PDP, AFNOR, Email, Peppol) sont **locales** — réelles,
mais la garantie « nightly » revendiquée est aspirationnelle jusqu'au merge (et personne n'a fait
de `workflow_dispatch` depuis).

**M-16 — UI : carte « Connect » identique pour un canal prouvé et un stub qui échouera toujours.**
`generic-portal.ts:132-199` expose un `configSchema` complet → `channels.settings.tsx:274-286`
affiche Connect/Connected normalement pour les 37 pays du tier generic-portal ; aucun flag de
maturité dans `RequiredChannel`. L'utilisateur saisit de vraies clés, voit « Connected », et rien
ne partira jamais (cf. F-8 + F-4 : même pas d'erreur à l'envoi).

**M-17 — FR : profil sans dimension taille d'entreprise ni routage B2B/B2G effectif.**
`profiles/schema.ts:27-30` (selector = roles/supply seulement) → staggering réel (grandes 2026-09,
PME 2027-09 ; PL : 02/2026 vs 04/2026) non modélisable — sur-restriction pour les PME (fenêtre
PL fév-avr 2026 : factures bloquées en PENDING_CLEARANCE à tort). `fr.ts:64-67` : les 4 canaux sur
la même règle sans `appliesTo` — une société configurant PDP **et** Chorus Pro verrait chaque
facture tentée sur les deux (auto-documenté comme « future engine work »).

**M-18 — `EmailTransmissionProvider` fallback ment « SENT ».**
`email-transmission.ts:76-81` : sans port mail injecté → `status:'SENT'` + log.todo. Pas emprunté
par le chemin prod actuel (le gateway est injecté) mais c'est exactement la registry nue que le
PollScheduler utilise (F-3) ; un stub ne doit jamais retourner SENT.

### 🟡 MINEUR

- **m-1** — Annuaires acheteur codés mais jamais injectés en prod : `compliance.module.ts` construit
  la registry sans `buyerDirectory` → résolution AFNOR (`afnor-directory-lookup.ts`) et SMP
  (`smp-buyer-directory.ts`) mortes ; chaque société doit saisir `buyerEndpointId` à la main.
- **m-2** — Numérotation compliance interne in-memory (`lifecycle/numbering.ts:21-33`) : champ
  `complianceDocument.number` vestigial, jamais utilisé dans un artefact, exposé au frontend —
  trompeur (le vrai numéro légal DB-backed est ailleurs et correct).
- **m-3** — Idempotence transmit : TTL 5 min en mémoire process, non persistée — un retry
  post-restart peut re-soumettre ; pas d'outbox durable pour l'envoi sortant (fire-and-forget
  au-delà de l'appel synchrone).
- **m-4** — `fail()` (API jasmine, inexistante sous Jest 29) dans 6 specs live — échoue quand même
  (ReferenceError) mais perd le message de diagnostic ; `peppol-sh-live.spec.ts` a déjà le bon
  pattern (`throw new Error`).
- **m-5** — PL : `Adnotacje` P_16-P_23 codés en dur à « Non », `PKWiU:'00'`, pas de GTU — fausse
  déclaration potentielle pour reverse-charge/split-payment ; mode offline/awaria KSeF non
  spécialisé (aucun profil ne déclare `contingency`, `enterContingency` non exposé).
- **m-6** — IT : progressivo du nom de fichier SdI dérivé de `key.slice(-5)` (collision possible) ;
  extension jamais `.p7m`.
- **m-7** — ES : `facturae.ts` injecte des flottants JS bruts sans arrondi — pattern XSD
  `DoubleUpToEightDecimalType` (8 déc. max) violable avec des prix non ronds ; les fixtures rondes
  masquent le cas.
- **m-8** — Frontend : `useGet` sans gestion d'`error` sur 4 écrans compliance (page blanche
  silencieuse) ; `invoice-progression.tsx:78-112` actions en dur au lieu de `flow.manualActions` ;
  un MEMBER peut atteindre `/settings/channels` par URL directe (masqué en nav seulement — le vrai
  problème est F-1 côté backend).
- **m-9** — `SigningProviderRegistry.get()` retombe silencieusement sur `none` pour un algo
  inconnu (piège futur) ; `InboundInvoiceController` injecte 3 deps et court-circuite son service
  (contredit son en-tête) ; `express` importé mais non déclaré dans package.json ;
  `refreshKeysFromApi()` KSeF jamais appelé (rotation clés 2027 non automatisée).
- **m-10** — FR : `response.statuses` sans « approuvée » alors que le mapping PDP la reconnaît ;
  champ déclaratif sans effet runtime aujourd'hui — à réconcilier avec le référentiel AFNOR.

### ⚪ COSMÉTIQUE

- Commentaire obsolète référençant `@fin.cx/einvoice` (fixtures format) — lib remplacée par
  `@e-invoice-eu/core`.
- `PE_UBL` dans `DocumentSyntax` : mort de naissance (PE utilise EN16931_UBL).
- IT : TD01/TP02/MP05 en dur (moot tant qu'il n'y a pas d'avoirs).
- KSeF poll : ré-authentification complète à chaque tick (4 appels HTTP/poll) — coûteux mais correct.
- `ksef-live.spec.ts` Run A : fixture XML avec balise ouvrante/fermante dépareillée (sans impact).
- DE/ES dupliqués entre `europe.ts` (shadow) et bespoke — voulu, documenté, testé.

---

## 3. VERDICT PAR AXE

| Axe | Verdict | Justification |
|---|---|---|
| **A — Architecture & propreté** | ⚠️ à surveiller | Layering controller→service→Prisma respecté (0 Prisma dans un controller compliance, 0 `as any` prisma en prod, `import type` sans danger grâce au composition-root explicite) ; ports fins + Null offline-safe ; registries sans fallback dangereux (sauf signing, m-9) ; **tous les smells connus éradiqués et vérifiés** : compilateur Schematron maison supprimé, zéro round-trip fromXml CII, zéro XML métier écrit à la main dans les specs, assets nest-cli (`.pem/.xsd/.sch/.json`) couvrent exactement les lectures runtime, deps mortes bien retirées. Restent : webhook non constant-time (M-13), double-send race (M-12), PEM prod manquants (F-10). |
| **B — Wiring bout-en-bout** | 🔴 cassé | Le chemin nominal (créer→issue→send email) fonctionne et est prouvé, mais tout ce qui est asynchrone est débranché : pont send→runtime absent (F-2), poll sans credentials (F-3), statut qui ment (F-4), erreurs avalées (M-2), pas d'état ERROR. Le sous-système lifecycle/drivers — la pièce maîtresse — ne reçoit jamais un seul job du flux réel. |
| **C — Correction par pays** | 🔴 pour les 3 marchés primaires en « prod-ready », 🟢 pour la mécanique données | La mécanique profils→providers est saine (0 orphelin, gardé par CI, fallback sûr). Mais aucun pays — pas même FR/PL/IT — n'a aujourd'hui une boucle complète émission→statut→correction conforme : FR (B2G mort, statuts morts), PL (FA(3), corrections, inbound, prod), IT (signature, notifiche, B2G, bollo), ES/DE (Peppol inatteignable, validations stubs), MX (numérotation), SA (faux-succès). |
| **D — Intégrité des tests** | ⚠️ | La discipline live-gate est réelle et majoritairement dure (KSeF Run B, AFNOR, SdI, Email, peppol-sh exigent la preuve réelle) ; les mocks échantillonnés sont ancrés sur les vraies API (URLs/terminologie réelles), pas inventés. Mais : 3 specs tolérants (PDP/Peppol/ChorusPro — le pattern faux-vert KSeF réapparaît), apply-signal jamais exécuté en CI, e2e `assertCompliance` vide de sens, et **le nightly live n'a jamais tourné** (M-15). Surtout : les preuves live valident les providers isolés, jamais le pipeline complet — c'est structurel (F-2/F-5/F-7 sont invisibles pour elles). |
| **E — Frontend** | 🔴 (à cause du backend) | Le frontend lui-même est bon : cartes canaux pilotées par le pays via required-channels, FlowDescriptor réellement consommé (view + list), secrets write-only, i18n compliance 100 % FR/PL/IT vérifié programmatiquement, badge availableFrom réel. Mais il repose sur des endpoints troués (F-1 : IDOR creds/certs, fuite /compliance et audit-export) et promeut des canaux stubs comme connectables (M-16). |

---

## 4. PROUVÉ LIVE vs SEULEMENT MOCKÉ

**⚠️ Mise en garde transverse** : toutes les preuves live appellent `transmit()`/`poll()`
**directement au niveau provider**. Aucune ne traverse `ComplianceEngine.resolve()` →
`ComplianceExecutor.execute()` → lifecycle. Elles prouvent le transport et le format, **pas**
l'intégration (F-2/F-3/F-4/F-5/F-7 leur sont invisibles).

| Canal / brique | Preuve | Statut |
|---|---|---|
| KSeF (PL, env test) | round-trip réel 2026-06-28 : FA(2) → CLEARED + ksefNumber (assertions dures) | ✅ prouvé live (émission, test env, hors executor) |
| PDP superpdp (FR) | facture réelle acceptée (ids 89xxx), transmit+poll réels | ✅ prouvé live (transport) |
| PDP AFNOR (FR) | POST /afnor-flow accepté, flowId réel i_90103 — contenu rejeté (ack=Error) | ✅ transport / 🔴 contenu |
| Email SMTP | Ethereal : messageId + preview réels | ✅ prouvé live |
| Peppol via peppol.sh | 2026-07-11 : UBL BIS 3.0 → delivered → CLEARED (~13 s), zéro secret | ✅ prouvé live (adaptateur AP isolé — le pipeline DE/ES ne l'atteint jamais, F-7) |
| TSA RFC 3161 | FreeTSA : TST DER réel + SignatureTimeStamp XAdES-T (2026-06-30) | ✅ prouvé live |
| Signatures XAdES/CAdES/PAdES | vérifiées offline (18+ tests, certs in-memory) | 🟢 offline — CAdES/PAdES jamais atteints par le pipeline (F-5) |
| Facturae (ES) | XSD officiel vendorisé + tests positif/négatif sur la sortie réelle du builder | 🟢 prouvé offline (meilleure preuve format du lot) |
| FatturaPA (IT) | XSD réel + business-rules yup, 4 fixtures | 🟢 prouvé offline |
| SdI (IT) | client SOAP fidèle, 6 notifiche mappées, spec live dur — jamais exécuté (accréditation AdE) | 🟢 mocké honnête |
| Chorus Pro (FR B2G) | client PISTE + mocks fidèles — transport HTTP inexistant (F-6), spec live faux-vert | 🔴 non fonctionnel |
| Storecove, PAC (MX), OSE (PE) | mocks | 🟢/🟡 mockés, live-deferred |
| ~15 clients nationaux « profonds » (anaf, afip, sefaz, sii, dian, sri, uy-dgi, gib, eg-eta, firs, ke-kra, in-irp, myinvois, id-coretax…) | mocks ancrés sur les vraies API (URLs/champs réels vérifiés sur échantillon) | 🟢 mockés, creds-gated |
| 37 portails generic-portal + ZATCA | aucun transport possible (F-8) | 🔴 structurellement morts |
| **CI nightly compliance-live** | 1 seul run, échoué (2026-06-30) ; `schedule` inopérant hors `main` | 🔴 n'a jamais prouvé quoi que ce soit — toutes les preuves ci-dessus sont **locales** |
| Suite mockée (1455 tests) + boot + builds + Cypress PR | exécutés pendant cet audit | ✅ verts — mais ne couvrent aucun des bloquants F-1→F-9 (c'est le point) |

---

## 5. LES 3 FINDINGS LES PLUS GRAVES

1. **F-1 — IDOR/fuite multi-tenant sur les controllers compliance** : n'importe quel utilisateur
   authentifié peut écraser les credentials de canal et les certificats de signature de n'importe
   quelle société, et lire les documents compliance de tous les tenants. À corriger avant tout
   merge — c'est une faille de sécurité exploitable aujourd'hui, indépendamment de l'e-invoicing.
2. **F-2 + F-3 — La boucle de statut asynchrone ne peut pas fonctionner en production** : le
   runtime lifecycle n'est jamais armé par le flux réel, et le poll tourne sans credentials. Toute
   facture FR/PL/IT resterait figée en PENDING_CLEARANCE/DELIVERED pour toujours ; le cœur
   architectural du module (drivers event-sourcés) tourne à vide.
3. **F-4 + F-5 — Le pipeline ment et signe mal** : statut DELIVERED même quand rien n'est parti,
   et sélection de signature aveugle au pays (IT recevrait du XAdES au lieu de CAdES .p7m, PL un
   FA_VAT invalide si un cert est configuré). Les deux sont invisibles pour les 1455 tests verts.
