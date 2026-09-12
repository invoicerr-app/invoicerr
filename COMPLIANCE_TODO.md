# Invoicerr — Compliance / E-Invoicing — ÉTAT COMPLET (fait + à faire)

> Tableau de bord exhaustif : ce qui est **fait** (coché) et ce qui **reste** (décoché).
>
> **Légende :** `[x]` fait · `[~]` implémenté, preuve live en attente (creds/accréditation) · `[ ]` à
> faire. Suffixes : ✅ prouvé live · 🟢 implémenté+testé (mocké/offline).
>
> **Mise à jour architecture — 2026-09-12.** Les versions antérieures de ce document décrivaient un
> moteur de conformité (`ComplianceExecutor`, `ComplianceModule`, un `CountryComplianceProfile` par
> pays sous `profiles/data/*.ts`, ~106 juridictions câblées). Ce moteur — `backend/src/compliance/`
> en entier — a été supprimé par le commit `fffbae77` ("refactor!: suppression des documents légaux
> et du moteur de conformité", 2026-08-29, ~298k lignes retirées, tag `avant-refonte-documents`).
> Un pivot produit ultérieur (commit `b68685e5`, 2026-09-10) a réduit le périmètre pays à cinq
> (FR/DE/IT/PL/PT) et pruné en conséquence les catalogues qui couvraient davantage de pays (voir
> §0.1). Ce document est réécrit pour ne citer que des chemins et un état réellement présents dans
> `backend/src/modules/documents/` aujourd'hui. L'inventaire détaillé de ce qui a été supprimé avec
> le moteur, et pourquoi, reste dans `documentation/internal/audit/12-SUPPRESSION.md` (établi la
> veille de la suppression) — utile pour l'archéologie, pas pour l'état courant.
>
> **Principe (inchangé) :** « a country is data ». Il n'y a cependant plus un profil unique par pays
> ni un moteur unique qui le résout : voir `CLAUDE.md`, section « The documents module », pour
> l'architecture à jour (une dizaine de catalogues indépendants, une machine à états de document
> générique, pas de graphe de cycle de vie par pays).

---

## 0. Socle

### 0.1 Architecture actuelle
- [x] Une dizaine de catalogues indépendants sous `backend/src/modules/documents/` —
  `country-policy/`, `country-identifiers/`, `correction-routes/`, `b2g-routing/`,
  `transports/channel-policy/`, `tax/tax-systems/`, `vat-rates/`, `country-fields/`,
  `content-requirements/`, `mentions/`, `archive/retention/`, `reporting/` — chacun avec son propre
  `data/<pays>.json`, son propre schéma et sa propre provenance (`legal`, sourcée à un texte cité, ou
  `unverified`, avec une note de résolution), vérifiée au chargement ET au moment du seed.
- [x] **La couverture pays diffère par mécanisme** (le pivot 5-pays n'a pas gardé le même périmètre
  partout) :

  | Mécanisme | Pays couverts (fichiers réels) |
  | --- | --- |
  | `country-policy/`, `correction-routes/`, `tax/tax-systems/` | DE, FR, IT, PL, PT (5) |
  | `b2g-routing/` | DE, FR, IT, PL (4) |
  | `country-identifiers/` | DE, FR, PT (3) |
  | `transports/channel-policy/` | FR, IT, PL (3) |
  | `country-fields/` | DE, FR (2) |
  | `vat-rates/` | FR, PT (2) |
  | `mentions/`, `content-requirements/`, `archive/retention/` | FR (1) |
  | `reporting/` (règles de déclenchement) | PT (1) — NAV/myDATA (§6) sont des fournisseurs
    enregistrés directement, pas pilotés par un fichier pays |

  Chaque catalogue **auto-découvre** ses fichiers (`readdirSync` sur son propre `data/`, motif
  `/^[a-z]{2}\.json$/`) — ajouter un pays à un mécanisme donné, c'est déposer un fichier, jamais
  toucher au code de chargement.
- [x] Une seule machine à états de document, générique et non spécifique à un pays
  (`descriptors/lifecycle.ts`) — pas de graphe de cycle de vie composé par pays. La nuance pays
  survit à trois endroits seulement : `correction-routes/` (quelle voie de correction), `conformity/
  pollers/` (polling de statut post-envoi, câblé par TRANSPORT, pas par pays), `archive/retention/`
  (durée de conservation, France uniquement).
- [x] `tax/tax-engine.ts` — détermination fiscale transfrontalière par composition des systèmes de
  taxe vendeur et acheteur (`tax/tax-systems/`), jamais une matrice N×N ; `tax/
  resolve-invoice-tax.ts` la câble dans "send" et bloque dur sur un pays vendeur OU acheteur non
  résolu plutôt que de deviner un traitement.
- [x] Wiring NestJS : `DocumentsCoreModule` (providers) + `DocumentsModule` (contrôleur HTTP, ré-
  exporte Core) + `DocumentsQueueWorkerModule` (processors BullMQ) — la même scission que l'ancien
  `ComplianceCoreModule`/`ComplianceModule`/`ComplianceWorkerModule`.
- [x] `documents.service.ts#runAction` — point d'orchestration générique unique, quel que soit le
  type de document (facture, devis, avoir, note de frais, facture reçue). Il n'y a plus de
  `InvoicesService` séparé : la facture est un `DocumentTypeDescriptor` comme les autres
  (`descriptors/invoice.descriptor.ts`).

### 0.2 Ce qui a été supprimé (ne pas chercher à le "finir")
Le moteur de conformité et l'essentiel des formats/canaux nationaux pour la longue traîne (Amérique
latine, MENA, Afrique, Asie, Mexique/CFDI, Arabie saoudite/ZATCA — environ 90 fichiers, ~2000 lignes
de stubs) ont été supprimés avec `backend/src/compliance/`. Ce qui en survit dans
`backend/src/modules/documents/` aujourd'hui est listé section par section ci-dessous ; tout ce qui
n'y figure pas n'existe plus dans ce dépôt.

---

## 1. FORMATS (`backend/src/modules/documents/formats/`)

### 1.1 Famille EN 16931 (`@fin.cx/einvoice`)
- [x] **EN16931_CII** — `formats/cii-provider.ts` ✅ (FR→PDP prouvé).
- [x] **FACTURX / PDF_A3** — PDF/A-3 hybride, `formats/facturx-provider.ts` ✅.
- [x] **EN16931_UBL** — `formats/ubl-provider.ts`.
- [x] **XRECHNUNG** (DE) — `formats/xrechnung-provider.ts`, délta Schematron vendorisé
  (`formats/vendored/de/`). Écart data connu, documenté dans le fichier lui-même : BR-DE-11/12/13
  (téléphone/email vendeur, EndpointID acheteur) — champs absents du modèle company/client.
- [x] **PEPPOL_BIS** — `formats/peppol-bis-provider.ts`, délta Schematron vendorisé
  (`formats/vendored/peppol/`).
- [x] **NLCIUS** (NL) — `formats/nlcius-provider.ts`, délta vendorisé (`formats/vendored/nl/
  si-ubl-2.0-nlcius-preprocessed.sch`, MIT, tag STABLE de peppolautoriteit-nl/validation). Le canal
  qui l'utiliserait pour de vrai (`b2g-routing/data/nl.json`) a été retiré par le pivot 5-pays (§0.1)
  — voir §3, note.
- [x] Validation EN16931 — Schematron vendorisé (`formats/vendored/en16931/`) câblé via
  `formats/vendored/validate-schematron.ts`.

### 1.2 Formats nationaux (marchés prioritaires)
- [x] **FA_VAT** (PL, FA(2)) — `formats/national/fa3-provider.ts` ✅ (prouvé via KSeF, §3).
- [x] **FATTURAPA** (IT, 1.2) — `formats/national/fatturapa-provider.ts`.
- [x] **ES_FACTURAE** — `formats/national/facturae-provider.ts`, XAdES câblé (`signing/`) — sert le
  canal B2G espagnol FACe (§3) ; il n'y a pas de fichier `country-policy/data/es.json` (l'Espagne
  n'est pas un pays vendeur couvert, seulement une destination B2G potentielle — voir §0.1/§9).

> **Longue traîne supprimée.** CFDI (Mexique), KSA_UBL (Arabie saoudite) et les ~40 formats nationaux
> LATAM/MENA/Afrique/Asie que ce document décrivait auparavant ont été supprimés avec le moteur de
> conformité (`fffbae77`). Aucun n'existe dans `formats/`.

---

## 2. SIGNATURE (`backend/src/modules/documents/signing/`)

- [x] **XAdES-BES** (XML) — `xadesjs` + WebCrypto ; pour Facturae, option FatturaPA.
- [x] **CAdES-BES** (.p7m) — `node-forge` PKCS#7 ; pour SdI (FatturaPA `.p7m`).
- [x] **PAdES-B** (PDF) — `@signpdf` + node-forge P12 ; Factur-X/PDF signés.
- [x] Sélection algo→provider par type de document — `signing/registry.ts`, `signing/providers.ts` ;
  `none` = pass-through documenté et testé.
- [x] Certificats de signature stockés en DB, chiffrés — `SigningCertificatesService`
  (`modules/company/signing-certificates/`), résolution par (société, algo, environnement),
  vérification d'expiration.
- [x] Horodatage TSA (RFC 3161) — `signing/tsa-client.ts`, gated `signing/tsa-live.spec.ts`.
- [x] WS-Security SOAP (signature d'enveloppe) — `transports/face/wsse-sign.ts`, réutilisé pour FACe
  transmission ET polling de statut (même certificat, résolu deux fois).

---

## 3. TRANSMISSION (`backend/src/modules/documents/transports/`)

### 3.1 Prouvés live
- [x] **KSeF** (PL) ✅ — round-trip réel (CLEARED + `ksefNumber`), 2026-06-28. Gated :
  `transports/ksef/ksef-live.spec.ts`, `conformity/pollers/ksef-status-poller.live.spec.ts`.
- [x] **PDP** (FR) ✅ — round-trip réel (fr:200→201→202, dépôt 375037), 2026-08-29. Gated :
  `transports/pdp/pdp.live.spec.ts`, `transports/pdp/pdp-conformity.live.spec.ts`.
- [x] **Peppol** ✅ — round-trip réel via peppol.sh (self-signup sandbox, zéro secret), 2026-07-11.
  Gated : `transports/peppol/peppol-sh-live.spec.ts`,
  `transports/peppol/peppol-sh-xrechnung-live.spec.ts`.

### 3.2 Implémentés, harnais live prêt (preuve en attente de creds/accréditation)
- [~] **SdI** (IT) — `transports/sdi/sdicoop-client.ts` + notifiche entrant
  (`transports/sdi/sdi-notifiche.*`, push-only, pas de poller par conception). Gated :
  `transports/sdi/sdicoop.live.spec.ts`.
- [~] **Chorus Pro** (FR, B2G) — `transports/chorus-pro/choruspro-client.ts`. Gated :
  `transports/chorus-pro/choruspro-live.spec.ts`.
- [~] **FACe** (ES, B2G) — `transports/face/face-client.ts`, WS-Security (§2). Gated :
  `transports/face/face.live.spec.ts`.
- [ ] **ANAF e-Factura** (RO, B2B) — `transports/anaf/anaf-client.ts`, implémenté ; pas de spec live
  dédiée dans cet arbre.
- [x] **Email** — envoi SMTP réel par société (`transports/email-transport.ts`, `MailService`) ; pas
  de canal "print" ni de spec live dédiée dans cette arborescence.

> **Note — capacité câblée mais non routée.** FACe (ES) et ANAF (RO) ci-dessus, et le format NLCIUS
> (NL, §1.1), restent enregistrés dans le code (`documents-core.module.ts`) mais le pivot 5-pays
> (§0.1) a retiré les fichiers `b2g-routing/data/{es,nl,ro}.json` qui les auraient effectivement
> routés — aujourd'hui `b2g-routing/` ne couvre que DE/FR/IT/PL. Réactiver ES/NL/RO en B2G, c'est
> déposer le fichier `data/xx.json` correspondant (§0.1) ; le code récepteur existe déjà.
>
> **Longue traîne supprimée.** PAC/timbrado (MX), OSE (Pérou), PRINT, et la taxonomie des ~50
> portails nationaux génériques (afip, sefaz, sii, dian, sri, uy-dgi, firs, ke-kra, in-irp, myinvois,
> id-coretax…) ont été supprimés avec le moteur. `gr-aade` (Grèce) et `hu-nav` (Hongrie) survivent
> mais reclassés : ce ne sont plus des canaux de TRANSMISSION, ce sont des fournisseurs de
> DÉCLARATION (§6) — un changement d'architecture réel, pas un renommage.

### 3.3 Post-envoi (statuts entrants)
- [x] `conformity/pollers/` — polling de statut post-envoi câblé par TRANSPORT : `pdp`, `ksef`,
  `peppol` (poll générique AP), `chorus-pro` (`consulterCr`), `anaf` (`stareMesaj`), `face`
  (`consultarFactura`). `sdi` reste push-only (notifiche SOAP), sans poller, par conception —
  `conformity/authority-status-poller.ts` documente pourquoi c'est permanent.
- [x] `conformity/conformity-sweep-runner.ts` — le runtime qui appelle ces pollers, câblé sur la
  queue BullMQ (`queue/processors/document-action.processor.ts`).

---

## 4. LIFECYCLE — statuts de document

- [x] Une seule machine à états, générique, aucune spécificité pays (`descriptors/lifecycle.ts`,
  voir §0.1). Il n'y a plus de runtime événementiel séparé (pas de `ComplianceEvent`, pas de drivers
  poll/timer/inbound dédiés) : le polling post-envoi (§3.3) et la queue BullMQ (`queue/`) jouent ce
  rôle aujourd'hui, pour chaque type de document.
- [x] Voies de correction par pays — `correction-routes/` (§0.1), source
  `documentation/internal/CORRECTION-ROUTES.yaml` (recherche, pas elle-même une source de droit —
  chaque route porte sa propre provenance `legal`/`unverified`).

---

## 5. ENTRANT (réception)

- [x] `received-invoices/` — factures fournisseurs reçues : extraction
  (`received-invoices/extraction.ts`, `received-invoices/ocr/`), page `/received-invoices`.
- [x] `transports/sdi/sdi-notifiche.*` — notifiche SdI entrantes (RC/NS/MC/NE/DT/AT).

---

## 6. REPORTING (`backend/src/modules/documents/reporting/`)

- [x] `reporting/reporting-runner.ts` — résout un fournisseur de déclaration, reconstruit la facture
  déclarée (jamais depuis un cache), et journalise le résultat dans `DocumentAuthorityEvent` (la
  même table que les événements de conformité, §3.3) — une déclaration EST un événement d'autorité,
  pas un transport.
- [x] **NAV** (Hongrie, Online Számla 3.0) — `reporting/providers/nav-declaration-provider.ts`,
  gated `nav.live.spec.ts`.
- [x] **myDATA** (Grèce) — `reporting/providers/mydata-declaration-provider.ts`, gated
  `mydata.live.spec.ts`.
- [~] **AT** (Portugal, « comunicação de faturas ») — `reporting/providers/pt-at-client.ts`,
  implémenté, **en attente d'accréditation**. Gated `pt-declaration-provider.live.spec.ts`. Seul
  fournisseur dont le déclenchement est piloté par un fichier pays (`reporting/data/pt.json`) ; NAV
  et myDATA sont enregistrés directement, sans fichier pays.

---

## 7. IDENTIFIANTS & DONNÉES DE RÉFÉRENCE

- [x] `country-identifiers/` — schémas d'identifiants requis par pays et type de tiers (DE/FR/PT,
  §0.1).
- [x] Validation d'identifiants — checksums + existence VIES/SIRENE dans `tax/vat-validation.ts`
  (gated `tax/vat-validation.live.spec.ts`) ; écrite à la SAISIE du numéro de TVA
  (`modules/clients/clients.service.ts`), jamais recalculée au moment de l'envoi.

---

## 8. CREDENTIALS & CERTIFICATS

- [x] Config de canal par société, chiffrée AES-256-GCM — `ChannelCredentialsService`
  (`modules/company/channels/`) ; `CREDENTIALS_ENCRYPTION_KEY` requise au boot (503 sinon).
- [x] Certificats de signature en DB, chiffrés — `SigningCertificatesService`
  (`modules/company/signing-certificates/`).
- [ ] Certificats canal restants : PFX qualifié SdI, certificat AP Peppol dédié (KSeF/PDP déjà
  opérationnels sans cette dépendance).

---

## 9. MATRICE PAR PAYS

- **🇫🇷 FR** — [x] Factur-X/EN16931_CII (→PDP) ✅ · [~] Chorus Pro (B2G) · [x] Peppol ✅ · [x] Email ·
  couvert par tous les mécanismes du §0.1.
- **🇵🇱 PL** — [x] FA(2) · [x] KSeF ✅ · couvert par country-policy/correction-routes/tax-systems/
  b2g-routing/channel-policy ; pas de fichier `country-identifiers`/`vat-rates`/`country-fields`
  dédié (retombe sur le comportement par défaut de ces catalogues).
- **🇮🇹 IT** — [x] FatturaPA · [~] SdI (harnais live prêt, accréditation AdE en attente) · même
  couverture que PL pour les catalogues annexes.
- **🇩🇪 DE** — [x] XRechnung (écart data BR-DE-11/12/13 documenté) · Peppol/Email · pas de fichier
  `transports/channel-policy/data/de.json` (pas de mandat de canal recensé pour l'Allemagne
  aujourd'hui).
- **🇵🇹 PT** — [x] Email/Peppol · [~] déclaration AT (§6, accréditation en attente) · le seul des
  cinq à avoir `vat-rates/`/`country-identifiers/` renseignés en dehors de FR.
- **Capacité existante, non routée aujourd'hui** — 🇪🇸 ES (FACe/Facturae), 🇳🇱 NL (Peppol/NLCIUS),
  🇷🇴 RO (ANAF/UBL) : le code transport/format existe et fonctionne (§1, §3) mais aucun fichier
  `b2g-routing/data/{es,nl,ro}.json` ne les active depuis le pivot 5-pays — voir la note du §3.2.

> Le Mexique (CFDI/PAC), les États-Unis, Monaco et un profil "pays inconnu" générique que ce
> document couvrait auparavant n'ont plus d'équivalent : il n'y a plus de repli générique par pays,
> et aucun catalogue ne les couvre. Un pays vendeur hors des cinq ci-dessus n'est aujourd'hui pas
> supporté par ce module.

---

## 10. VALIDATION & QUALITÉ

- [x] Schematron EN16931 + deltas nationaux vendorisés (`formats/vendored/{en16931,de,peppol,nl}/`),
  câblés via `formats/vendored/validate-schematron.ts`.
- [x] XSD FA(2) (PL) / FatturaPA (IT) / Facturae (ES), vendorisés et câblés dans leurs providers
  respectifs (`formats/vendored/validate-xsd.ts`).

---

## 11. PREUVE LIVE & TESTS

- [x] Round-trips live prouvés : **KSeF**, **PDP**, **Peppol** (§3.1, dates ci-dessus).
- [~] Harnais live prêts, preuve en attente de creds/accréditation : **SdI**, **Chorus Pro**,
  **FACe**, **NAV**, **myDATA**, **AT (Portugal)**, **TSA**, **validation VAT**. Chaque spec
  `*-live.spec.ts` / `*.live.spec.ts` sous `backend/src/modules/documents/` est self-gated via
  `liveDescribe(FLAG, [ENV_VARS])` (`transports/live-gate.ts`) — voir `LIVE_TESTING.md` pour la
  liste des variables requises par canal.
- [x] Discipline « boot test » — l'app démarre, DI/routes OK (`cd backend && npm run build` =
  `nest build`, jamais `tsc --noEmit` seul).
- [x] CI : jest backend + queue-integration (Redis/Postgres réels) + Cypress e2e (workflow
  « Tests ») — voir `CLAUDE.md`.

---

## 12. FRONTEND

- [x] Réglages canaux par pays (cartes Connect/Edit, secrets masqués, erreurs surfacées).
- [x] Certificats de signature dans les réglages société (upload PFX+mot de passe, sujet/expiration/
  statut).
- [x] Statuts de document et actions disponibles pilotés par `descriptors/lifecycle.ts` (§0.1/§4).
- [x] Page `/received-invoices` (§5).

---

## 13. INFRA / DÉPLOIEMENT

- [x] `CREDENTIALS_ENCRYPTION_KEY` requise au boot (503 sinon).
- [x] Clés publiques KSeF vendorisées sous `transports/ksef/certs/` (environnement de test).
- [ ] Clés KSeF **production** — celles vendorisées aujourd'hui sont celles de l'environnement de
  test du Ministère des Finances polonais.

---

## Ordre conseillé

1. **SdI live** (IT) — accréditation AdE + PFX qualifié (§3.2, §8).
2. **Chorus Pro / FACe live** — creds par autorité (§3.2).
3. **AT Portugal** — accréditation (§6).
4. **KSeF production** — clés MF de production (§13).
5. Réactiver ES/NL/RO en B2G si le marché le justifie — déposer le fichier `b2g-routing/data/xx.json`
   correspondant (§3.2, note) ; aucun code nouveau n'est nécessaire.
6. Étendre `country-policy/` à un sixième pays vendeur au besoin (§0.1, §9) — même principe : un
   fichier, pas un moteur.

---

## 14. Historique — l'ancien moteur (pour archéologie)

Les sections ci-dessus décrivent l'état du dépôt après le commit `fffbae77` (suppression du moteur
de conformité, 2026-08-29) et le pivot 5-pays (commit `b68685e5`, 2026-09-10). Les versions
antérieures de ce document décrivaient un moteur complet (`ComplianceExecutor`, `ComplianceModule`,
un `CountryComplianceProfile` par pays, ~106 juridictions câblées, ~90 formats/portails nationaux
pour la longue traîne, un runtime de cycle de vie événementiel avec pollers/timers/inbox) qui
n'existe plus dans ce dépôt.

Pour consulter ce code : `git show avant-refonte-documents:backend/src/compliance/...`. L'inventaire
détaillé de ce qui a été supprimé et pourquoi est dans
`documentation/internal/audit/12-SUPPRESSION.md` (établi le 2026-08-28, la veille de la
suppression) ; il ne décrit pas l'état courant, seulement la décision de suppression elle-même.
