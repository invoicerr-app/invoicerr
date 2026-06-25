# Compliance — État d'implémentation

*Français · [English](COMPLIANCE_STATUS.md)*

> Branche : `feat/compliance-architecture` · Module : `backend/src/compliance/`
> Documents compagnons : [`COMPLIANCE_ARCHITECTURE.fr.md`](COMPLIANCE_ARCHITECTURE.fr.md) (conception, §1-§18) ·
> [`COMPLIANCE_LIFECYCLE.fr.md`](COMPLIANCE_LIFECYCLE.fr.md) (cycle de vie par juridiction : phases composées ×
> déclencheurs pilotés par canal × moteur événementiel) · [`documentation/compliance/`](.) (fiches par pays)
>
> **TL;DR** — Le cœur de résolution, les stubs de la couche d'exécution, le moteur du cycle de vie avec
> ses 3 drivers durables, la persistance Prisma/NestJS, et **la vraie détermination fiscale dans le
> flux réel de factures/devis/factures récurrentes** sont tous construits, reliés entre eux et testés
> (**334 tests — 331 unitaires + 3 d'intégration live-DB optionnels — 0 erreur de typage**). Il reste
> (1) à remplacer les stubs `TODO` nommés par de vraies intégrations externes, et (2) à piloter le
> runtime du cycle de vie lui-même (*clearance*, transmission, création du `ComplianceDocument`)
> depuis ce même flux réel — aujourd'hui seule la *détermination* fiscale est branchée, pas la
> *clearance*/transmission/persistance du document qui en résulte.

---

## ✅ Fait

### Architecture et documentation
- [x] `COMPLIANCE_ARCHITECTURE.fr.md` — RFC de conception (v1.1) : taxonomie à 16 axes, moteur fiscal,
  cycle de vie, patrons de fiabilité, cartographie complète des pays, "cas horribles" traités.
- [x] `COMPLIANCE_LIFECYCLE.fr.md` — RFC compagnon : le cycle de vie vu comme des **phases** (composées
  à partir du plan, émetteur ⊕ destinataire) × des **drivers** (liés au modèle de feedback du canal —
  poll/callback/timer/immédiat/manuel) × un **moteur événementiel** durable.
- [x] `documentation/compliance/FR-France.md` — la fiche du marché domestique (absente des 77 fiches d'origine).

### Cœur de résolution (pur, sans I/O — entièrement implémenté)
- [x] **Modèle canonique** (`canonical/`) — document agnostique au format, montants en unités mineures entières.
- [x] **Profils pays** (`profiles/`) — déclaratifs, **temporels** (`validFrom/validTo`), avec un
  registre, une **délégation** (Monaco→FR) et un **FALLBACK** de secours.
- [x] **Moteur de détermination fiscale** (`engine/tax-engine.ts`) — transfrontalier par composition :
  TVA/GST domestique, *autoliquidation* (reverse charge) intra-UE et intra-CCG / livraison intra-union,
  OSS (taux de destination depuis le vrai profil acheteur), export, sales tax US + nexus, origine sans
  TVA, régimes d'exonération/franchise.
- [x] **Moteur de compliance** (`engine/compliance-engine.ts`) — `resolve(tx) → CompliancePlan`
  (régime, formats, canaux, numérotation, cycle de vie, archivage, reporting, confiance, avertissements).

### Couverture pays — **106 juridictions câblées**
- [x] Les **106** fiches pays `documentation/compliance/*` (les 77 d'origine + ~29 ajoutées lors de la
  fusion de `dev`) + les majeurs sur-mesure (FR, US, MX, IT, PL ; DE/ES/GB/CA/AU/NZ/JP/… via archétypes).
- [x] Des **constructeurs d'archétypes** typés (`profiles/archetypes.ts`) → la plupart des pays se
  déclarent en une ligne ; **5 profils sur-mesure** portent des spécificités vérifiées, écrites à la main.
- [x] Le **test de couverture** (`profiles/coverage.spec.ts`) lit `documentation/compliance/` et fait
  échouer la CI si un pays documenté n'est pas câblé à un profil non-fallback.
- [x] **`data-integrity.spec.ts`** — invariants imposés par la CI : chaque profil bien formé et
  temporellement ordonné, chaque taux de TVA/GST cohérent, et — crucial — **chaque `DocumentSyntax` et
  `providerId` de canal référencé se résout vers un vrai provider** (une faute de frappe ne peut plus
  retomber silencieusement sur un catch-all).
- [x] Honnêteté via `confidence` : sur-mesure = `OFFICIAL` ; construit par archétype = `BEST_EFFORT` ;
  mandats annoncés = `PLANNED`.

### Couche d'exécution — providers (câblés de bout en bout ; les corps sont des stubs qui logguent `TODO`)
- [x] **Format** : famille EN16931, PlainPDF, CFDI, FatturaPA, KSA-UBL, FA_VAT, **43 formats nationaux
  dédiés** (NF-e, CL DTE, e-Fapiao, GST IRP, UBL-TR, ETA, eTIMS, JoFotara, TEIF, …), plus le catch-all
  générique `NATIONAL_XML` conservé uniquement comme filet de sécurité (aucun pays documenté n'y
  retombe par défaut désormais).
- [x] **Transmission** : Email, Peppol, PDP, PAC, SdI, KSeF, GovPortal, OSE, Print, **50 providers de
  portails nationaux dédiés** (SEFAZ, SII, AFIP, DIAN, ZATCA, IRP, GİB, ANAF, SEF, …) sélectionnés via
  `ChannelSpec.providerId` (pas de collision quand plusieurs partagent `GOV_PORTAL_API`) ; `gov-portal`
  conservé comme valeur par défaut de secours.
- [x] Chaque provider de transmission déclare un **modèle `feedback`** (`SYNC`/`ASYNC_POLL`/
  `ASYNC_CALLBACK`/`NONE` + `pollPolicy`) — c'est ce qui pilote le cycle de vie (voir plus bas) par
  canal, et non par pays.
- [x] Providers de **signature** + registre : XAdES, CAdES, PAdES, aucune.
- [x] Providers d'**archivage** + registre : WORM-S3 (routage par résidence des données), Local.
- [x] Handlers de **régime** + registre : post-audit, périodique, temps réel, *clearance* (bloquant —
  validation préalable par l'administration avant que la facture soit juridiquement valide), CTC.
- [x] Handlers de **système fiscal** + registre : VAT/GST/SalesTax/ConsumptionTax/None — calculent les
  totaux en unités mineures entières.
- [x] Handlers de **reporting** + registre : EC Sales List, Intrastat, OSS, IOSS, SAF-T, e-reporting,
  registre des ventes/achats, export douanier.

### Cycle de vie — phases composées × déclencheurs pilotés par canal × moteur événementiel
- [x] **Phases** (`lifecycle/phases/`) — des contributeurs purs (émission, *clearance*, livraison,
  réponse acheteur, reporting, corrections), chacun conditionné par le plan résolu, composés en un
  seul `LifecycleGraph` par transaction (`lifecycle/assembler.ts`), validé contre le sur-ensemble
  légal dans `lifecycle/state-machine.ts`.
- [x] **Déclencheurs** (`lifecycle/triggers.ts`) — `IMMEDIATE`/`POLL`/`CALLBACK`/`TIMER`/`MANUAL`/
  `CONTINGENCY`, liés au modèle `feedback` du canal.
- [x] **Runtime** (`lifecycle/runtime.ts`) — interpréteur événementiel : `dispatch(signal) → Effect[]` ;
  projections `availableActions()` / `pendingDrivers()` pour une future UI ; un signal périmé/inapplicable
  est toujours un `NOOP` sûr (ne corrompt jamais l'état) ; une `COMMAND` illégale lève une exception
  (garde-fou d'immutabilité).
- [x] **3 drivers durables**, chacun un cœur pur job/store + une fine bordure d'I/O injectée :
  - `poll-scheduler` — `tick()` interroge les jobs échus via le `poll()` du canal, backoff exponentiel,
    expiration. Prouvé de bout en bout en menant une *clearance* MX jusqu'à `CLEARED`.
  - `timer-scheduler` — minuteurs de fenêtre de silence (ex. **le silence de 8 jours du Chili =
    acceptation**, câblé sur le profil CL). Prouvé de bout en bout ; un déclenchement périmé après que
    le document a évolué est un `NOOP` sûr.
  - `inbound-router` — piloté par événement (pas de tick) : `register()` + `receive()`, avec
    déduplication idempotente des envois d'autorité at-least-once. Prouvé de bout en bout (IT SdI
    "consegnata" → `CLEARED` ; FR PDP "approuvée"/"refusée" → `ACCEPTED`/`REFUSED`).

### Persistance — Prisma + NestJS (revue ; pas encore branchée dans le flux de facturation réel)
- [x] **Modèles Prisma** (`prisma/schema.prisma`, migration `compliance_lifecycle`) : `ComplianceDocument`,
  `ComplianceEvent` (journal append-only), `ComplianceAuthorityId`, `ScheduledJob` (partagé entre poll
  et timer), `ComplianceCallbackRegistration`, `ComplianceInboundMessage`. Additif uniquement.
- [x] **Adaptateurs Prisma** (`persistence/`) implémentant les quatre ports de store (désormais
  **async**) — les implémentations en mémoire sont inchangées et passent toujours la suite de tests
  unitaires complète.
- [x] **Câblage NestJS** (`nest/`) : `ComplianceModule`, `ComplianceCron` (ticks `@Interval` pour les
  deux schedulers, avec une garde anti-chevauchement des exécutions), `ComplianceController` (une
  route webhook entrante par canal, protégée par secret partagé), et le vrai `ApplySignalService` —
  charge le runtime, dispatche le signal, et persiste la mise à jour du statut/événement **et** la
  (dé)planification des drivers **de façon atomique dans une seule transaction Prisma**, en annulant
  les drivers qui gardaient l'état *précédent* avant d'armer ceux du nouvel état.
- [x] **Test d'intégration live-DB** (`nest/apply-signal.live.spec.ts`, activable via
  `COMPLIANCE_LIVE_DB_TESTS=1`, ignoré par défaut) prouve tout ça contre un vrai Postgres.

### Façade d'opérations (`operations/compliance-service.ts`) — une méthode par opération du cycle de vie, async
- [x] Émission : `createDraft`, `editDraft` (DRAFT uniquement), `issue`, `issueAndSend`.
- [x] Envoi : `send`, `resend`, `sendViaChannel`.
- [x] *Clearance* : `submitForClearance`, `pollClearance`, `markCleared`, `markRejected`,
  `enterContingency`, `resubmitFromContingency`.
- [x] Modification : `correct`, `issueCreditNote`, `issueDebitNote`, `issueCorrectiveInvoice`,
  `cancel` (conditionné par la politique), `cancelAndReplace`.
- [x] Réponse : `openResponseWindow`, `applyResponse`, `handleResponseTimeout`.
- [x] Entrant : `receive`, `acknowledgeInbound` (+ `ReceptionService`).
- [x] Divers : `report`, `markPaid`, `archiveDocument`, `validate`, requêtes.
- [x] Port `ComplianceDocumentStore` — **implémentations en mémoire et Prisma disponibles toutes les deux**.

### Branchement réel — détermination fiscale (premier morceau du « flux de facturation réel »)
- [x] **`compliance/integration/invoice-tax.ts`** — adaptateur pur : construit un `TransactionContext`
  à partir d'une société/client/lignes, appelle `resolve()` + `accumulateTotals()`, puis reconvertit
  vers le format `Float` (`totalHT`/`totalVAT`/`totalTTC`/`vatRate`) que le schéma réel utilise encore.
  Consommé par `invoices.service.ts`, `quotes.service.ts` et `recurring-invoices.service.ts` —
  l'ancien raccourci France uniquement `isVatExemptFrance` a disparu des trois.
- [x] **`Company.countryCode`/`Client.countryCode`** (additif, nullable) + `guessCountryCode()`
  (`utils/country-name-to-iso.ts`) — un normalisateur conservateur, à correspondance exacte
  uniquement, utilisé en repli quand le champ explicite est vide. `country` reste en texte libre ;
  ce n'est *pas* la migration ISO-3166 complète ci-dessous, juste assez de signal pour que le moteur
  résolve une juridiction.
- [x] L'exonération petite entreprise (`Company.exemptVat`) fonctionne désormais pour **n'importe
  quel** pays via `taxScheme: 'FRANCHISE_BASE'`, pas seulement `country === 'FRANCE'` — le premier
  bug concret corrigé par ce chantier.
- [x] L'export cross-border (destination hors union) résout désormais correctement à 0% au lieu du
  taux domestique plat — prouvé de bout en bout sur la suite e2e (client FR→US, `07-invoices.cy.ts` /
  `12-discount.cy.ts`, avec la justification légale consignée dans chaque assertion mise à jour).
- [ ] **L'autoliquidation UE/CCG B2B ne se déclenche pas encore en pratique** — `Company.VAT`/
  `Client.VAT` sont du texte libre, jamais validé, donc `resolveInvoiceTax` ne déclare délibérément
  jamais `validated: true` pour eux (le `TrustFlagVatValidator` du moteur est conservateur par
  conception : un n° de TVA non vérifié ne doit *pas* débloquer une taxation à 0%, sinon n'importe qui
  pourrait taper un faux numéro et sous-facturer la taxe). Tant qu'un vrai validateur n'est pas câblé
  (voir « Validation VIES / registre » plus bas), une vente B2B intra-union retombe sans risque sur
  le taux domestique du fournisseur — correct mais conservateur, pas encore le correctif complet.
- [ ] Le résultat n'est répercuté **nulle part ailleurs** où le traitement TVA est mentionné en texte
  — ex. le `vatExemptText` du PDF de facture est toujours l'ancienne chaîne France uniquement ; une
  facture export ou autoliquidation à 0% a désormais les bons *montants* mais aucune mention légale
  expliquant pourquoi (le moteur calcule déjà une mention par ligne — `TaxTreatment.mentions` — elle
  n'est simplement pas encore remontée jusqu'au PDF).
- [ ] Rien de tout cela ne pilote le runtime du cycle de vie — aucun `ComplianceDocument` n'est créé,
  aucune *clearance* n'est soumise, rien n'est transmis. C'est le prochain morceau (voir « Ordre
  suggéré » plus bas).

### Tests
- [x] **334 tests** répartis sur **32 fichiers de specs** : 331 tests unitaires toujours actifs
  (engine/profiles/providers/lifecycle/integration purs, sans I/O) + 3 tests d'intégration live-DB
  optionnels. `tsc --noEmit` propre ; `nest build` réussit ; `prisma validate` passe ; un
  `prisma migrate deploy` à froid s'applique sans erreur.

---

## 🚧 À faire

### 1. Remplacer les stubs `TODO` nommés par de vraies intégrations
Chaque stub loggue un `TODO` à l'endroit exact à remplir (grep `\.todo(` dans `backend/src/compliance/`
— **62 marqueurs** au moment de l'écriture, chacun nommant le schéma/API/certificat exact à implémenter).

| Domaine | Scopes des stubs | Ce qu'il faut implémenter |
| --- | --- | --- |
| **Formats** | `format/en16931`, `plain-pdf`, `cfdi`, `fatturapa`, `ksa-ubl`, `fa-vat`, + 43 stubs de formats nationaux dédiés, `national-xml` (catch-all) | Les vrais octets. `en16931` → encapsuler `@fin.cx/einvoice` ; `plain-pdf` → réutiliser `getInvoicePdf()` ; chaque stub national → son propre générateur de schéma/XSD + validation |
| **Transmission** | `email`, `peppol`, `pdp`, `pac`, `sdi`, `ksef`, `ose`, `print`, + 50 stubs de portails nationaux dédiés, `gov-portal` (catch-all) | `email` → `MailService` ; les autres → intégrer l'intermédiaire certifié / le portail (la *clearance* asynchrone renvoie des IDs, conformément au modèle `feedback` déclaré par chaque provider) |
| **Signature** | `signing/xades`, `cades`, `pades` | Vraie crypto + backends de certificats (CSD, ICP-Brasil, X.509, cachet qualifié) + payloads QR |
| **Archive** | `archive/s3-worm`, `local` | Vrai stockage WORM, application de la rétention, intégrité (chaîne de hachage / re-scellement) |
| **Régime** | `regime/clearance`, `decentralized-ctc`, `periodic-reporting`, `real-time-reporting` | Interaction avec l'administration + gestion des statuts |
| **Cycle de vie** | `numbering/folio-pool`, `gapless`, `lifecycle/response`, `lifecycle/corrections/*` | Demandes de plages de folios ; vraie chaîne de hachage ; construction des documents de correction (la piste de réponse et les minuteurs de silence eux-mêmes sont désormais réels — voir plus haut) |
| **Fiscalité** | `taxsystem/sales-tax`, `consumption-tax` | Empilement des taux county/city/district US ; arrondi à la japonaise |
| **Opérations** | `operations/issue`, `cancel`, `clearance`, `contingency`, `markPaid`, `validate` | Vrai hash ; accusé d'annulation par l'administration ; émission hors-ligne en contingence ; e-reporting des paiements ; agrégation du rapport de validation |
| **Réception** | `reception` | Parser/valider l'entrant ; émettre le statut acheteur obligatoire |

### 2. Câblage plateforme — ce qu'il reste après la persistance
- [x] ~~Module NestJS + persistance Prisma~~ — **fait** (voir ci-dessus).
- [x] ~~Remplacer la logique 293B codée en dur par le moteur fiscal~~ — **fait**, voir « Branchement
  réel — détermination fiscale » plus haut. Ce qui n'est *pas* fait : **piloter réellement le
  runtime** (appeler la façade, créer un `ComplianceDocument`, soumettre en *clearance*, transmettre)
  — `invoices.service.ts` ne fait encore que demander les bons chiffres au moteur, il ne pilote pas
  le cycle de vie construit pour lui.
- [ ] **Piloter le cycle de vie depuis `invoices.service.ts`** — construire sur le branchement de
  détermination fiscale ci-dessus : faire passer create/send/correct par la façade
  `ComplianceService`, créer le `ComplianceDocument`, restreindre l'`editInvoice` actuellement libre
  au `DRAFT` uniquement (maintenant que `DRAFT` est un vrai statut — ajouté par le chantier sans
  rapport `feat/invoice-status-progression` — rien ne conditionne encore l'édition à ce statut).
- [ ] **Migration ISO-3166 complète** — `Company.country`/`Client.country` texte libre → codes à 2
  lettres comme champ principal (aujourd'hui : une surcharge additive `countryCode` + une déduction
  best-effort depuis le nom en texte libre, suffisant pour la détermination fiscale, pas une vraie
  migration).
- [ ] **Migration monétaire** — colonnes `Float` d'`Invoice` → unités mineures entières.
- [ ] **Outbox + dispatcher** — I/O *sortant* durable at-least-once vers l'administration/l'acheteur
  avec idempotence (le côté *entrant* du cycle de vie — poll/timer/callback — est déjà durable ; ceci
  est la contrepartie sortante pour `transmit()`/la soumission de *clearance* elle-même).
- [ ] **Frontend** — configuration pays/compliance, affichage du statut de compliance (le runtime
  expose déjà `availableActions()`/une projection en forme de timeline), remontée des avertissements.

### 3. Modélisation plus profonde (anticipée dans la conception, pas encore construite)
- [ ] **Règles QR et de signature** comme champs de profil (QR SA/IT-B2C/PT/LATAM ; type de certificat
  par pays).
- [ ] **Retenue à la source et population multi-taxes** — le moteur n'émet actuellement qu'une seule
  composante pour la plupart des pays.
- [ ] **Multi-entité / fournisseur non établi** — l'app suppose un unique `company.findFirst()`.
- [ ] **Cycle de vie des certificats** — expiration/renouvellement/supervision HSM.
- [ ] **Validation VIES / registre** — câbler un vrai validateur derrière `VatValidator`. Ce n'est
  plus cosmétique : c'est désormais le bloqueur pour que l'autoliquidation UE/CCG B2B se déclenche
  réellement dans le flux réel (voir « Branchement réel » plus haut) — `resolveInvoiceTax` fait déjà
  passer les identifiants de TVA, seul un vrai validateur manque.
- [ ] **Modèles du §13 pas encore construits** : `FolioPool`, `Withholding`, `TaxComponent`,
  `LegalArchiveEntry`, `ReceivedDocument`, `DocumentResponse` — délibérément hors périmètre de la
  phase cycle de vie/persistance qui vient d'être terminée ; à ajouter quand la zone de stub
  correspondante sera réellement implémentée.

### 4. Exactitude des données
- [ ] Les profils construits par archétype portent des taux et dates `BEST_EFFORT`/`PLANNED` déduits
  de `documentation/compliance/` — les faire évoluer vers des profils sur-mesure `OFFICIAL` vérifiés,
  pays par pays, selon les besoins.

---

## Ordre suggéré
1. ~~**Moteur fiscal dans `invoices.service.ts`** (remplace le 293B codé en dur)~~ — **fait**.
2. **Piloter le cycle de vie depuis le flux réel** — `ComplianceService.createDraft`/`issue`,
   persister un `ComplianceDocument`, restreindre `editInvoice` au `DRAFT`. La façade/persistance
   dont elle a besoin existent déjà ; c'est désormais la prochaine étape concrète.
3. **Un vrai `VatValidator` (VIES)** — débloque l'autoliquidation UE/CCG B2B dans le flux réel
   (aujourd'hui sans effet par conservatisme, voir plus haut) — petit, isolé, à forte valeur.
4. **Une transmission de référence de bout en bout** (ex. FR PDP **ou** MX PAC) — remplacer un stub
   de provider par une vraie intégration ; les drivers du cycle de vie qui la rendent *vivante*
   (poll/callback) sont déjà construits.
5. **Outbox** pour le côté sortant, à l'image de la durabilité déjà construite pour l'entrant
   (poll/timer/callback).
6. **Frontend** — exposer le statut de compliance + les actions disponibles à partir des projections
   du runtime.
7. Reporting + largeur de couverture ; remplir progressivement les formats/canaux nationaux restants
   derrière les registres.

---

*État à jour sur la branche `feat/compliance-architecture`. Mettre à jour ce fichier au fur et à
mesure que les stubs sont remplacés.*
