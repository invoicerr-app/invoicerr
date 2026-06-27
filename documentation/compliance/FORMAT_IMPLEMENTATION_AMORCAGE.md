# AMORÇAGE AUTONOME — implémenter tous les formats de facture (run non supervisé)

> **Mode : run de nuit, non supervisé.** Tu enchaînes les phases ci-dessous **dans l'ordre**, en
> committant après **chaque format**. Tu ne t'arrêtes pas sur un blocage : tu **scaffoldes + TODO précis +
> tu passes au suivant** (protocole §0.3). Référence dépendances : `FORMAT_DEPENDENCIES.md`. Référence
> ordre/état : `COMPLIANCE_BUILD_ORDER.md`. Gotchas connus : la lib `@fin.cx/einvoice` n'émet pas
> `cac:Contact`/`EndpointID` et son `fromXml` CII est bugué (d'où la migration Phase A).

---

## 0. RÈGLES DURES (non négociables)

**0.1 Vérification — JAMAIS `tsc --noEmit` seul.**
Avant tout commit : `cd backend && npm run build` (= `nest build`, le vrai build) **doit passer**, puis
`npx jest src/compliance/providers/format` (le harness) **doit passer**. Pour le front si touché :
`cd frontend && npm run build`.

**0.2 JAMAIS de « valid » bidon.**
Le harness de validation est la source de vérité. Tu ne mets **jamais** `valid:true` sur un format qui
ne l'est pas, ni `valid:false` figé sur un format réellement valide. Si un format n'est que partiellement
conforme : **gate vivant** = asserter l'**ensemble exact des codes d'erreur** connus (comme XRechnung
`['BR-DE-11','BR-DE-12','BR-DE-13','BR-DE-14']` aujourd'hui), pas un booléen menteur. Documente *pourquoi*.

**0.3 Protocole anti-blocage (run autonome).**
Si une lib ne s'installe pas / un format exige un service externe (PAC, KSeF, ZATCA, OSE) / la conformité
totale est hors de portée cette nuit :
1. Produis quand même le **provider câblé** + le **XML le plus structurellement complet possible**.
2. Ajoute une **fixture harness** avec le **set d'erreurs connu** (gate vivant) — pas de faux vert.
3. Écris un **TODO précis** (codes de règles manquants, champ/section, service requis) dans le code +
   `COMPLIANCE_BUILD_ORDER.md`.
4. **Commit** et **passe au format suivant.** Ne bloque jamais le run entier sur un format.

**0.4 Commit discipline.**
Un commit par format (ou par sous-étape cohérente), message clair, **terminé par** :
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Après chaque commit : `git status` +
`git log --oneline -1` pour confirmer l'état. Tu es déjà sur la branche `feat/compliance-architecture`,
**reste dessus**, ne push pas (l'utilisateur relira / poussera). Si tu push, fais-le après chaque phase,
jamais en plein milieu.

**0.5 Architecture — déplacer, pas réécrire ; respecter le cycle.**
- La **génération** vit dans `InvoiceRenderingService` (module `invoice-rendering`, **cycle-safe**, n'importe
  JAMAIS la compliance). Tu y ajoutes une méthode par format.
- Les **providers compliance** (`src/compliance/providers/format/*`) **délèguent** via le port
  `InvoiceArtifactPort` (l'étendre, méthode par format). Pattern déjà en place pour PDF/XML (cf. #0.2,
  `providers.ts` En16931/PlainPdf).
- `FormatProviderRegistry` sélectionne par `DocumentSyntax`. Les classes provider existent déjà en stub
  (`CfdiFormatProvider`, `FatturaPaFormatProvider`, `KsaUblFormatProvider`, `FaVatFormatProvider`,
  `NationalXmlFormatProvider`, `NATIONAL_FORMAT_PROVIDERS`) → tu **remplis le corps**, tu ne recrées pas le câblage.

**0.6 Fixtures = données réalistes.**
Réutilise/étends `src/compliance/providers/format/__fixtures__/invoices.ts` (type `InvoiceRenderData`).
Quand un format exige des champs absents du modèle (IBAN structuré, endpoint Peppol…), **ajoute le champ à
`InvoiceRenderData`** (et map-le dans `buildEInvoice` si la source Prisma l'a déjà — ex `Company.phone/email`,
`PaymentMethod.details`) ; si la donnée n'existe nulle part, note-le comme gap modèle (TODO migration Prisma),
ne l'invente pas en dur dans le mapping de prod.

---

## PHASE A — Migration EN 16931 vers `@e-invoice-eu/core` (PRIORITÉ 1, débloque BR-DE)

**But :** remplacer `@fin.cx/einvoice` pour la famille EN16931 par une lib qui émet `cac:Contact`,
`cbc:EndpointID` et le code paiement → fermer BR-DE-11/12/13/14, et corriger le faux négatif CII.

**A.0 SPIKE de décision (fais-le AVANT de migrer).**
`npm i @e-invoice-eu/core`. Écris un spike jetable : à partir d'une de nos fixtures (mappée vers le JSON
d'entrée d'e-invoice-eu), générer une **XRechnung** et une **Factur-X**, puis valider.
- Si e-invoice-eu **émet** `cac:Contact` + `EndpointID` + payment means **et** ferme BR-DE-11..14 → **GO migration** (A.1+).
- Sinon → **n'abandonne pas la lib actuelle** : reste sur `@fin.cx/einvoice`, mais ferme BR-DE-14 via
  `inv.paymentOptions` (prouvé : ça marche) et documente BR-DE-11/12/13 comme **bloqués lib** (post-traitement
  XML = chantier séparé). Note la décision dans `COMPLIANCE_BUILD_ORDER.md` et **passe à la Phase B**.

**A.1 Migration (si GO).**
- Dans `InvoiceRenderingService` : nouvelle méthode `buildEn16931(data): <JSON e-invoice-eu>` (mappe
  `InvoiceRenderData` → schéma e-invoice-eu, incluant vendeur tél/email = `Company.phone/email`, endpoint
  acheteur, payment means depuis `PaymentMethod`). Réécris `renderXmlFormat` / `renderPdfFormat` pour passer
  par e-invoice-eu (UBL/CII/XRechnung en XML ; Factur-X/ZUGFeRD en PDF/A-3 hybride).
- Garde `@fin.cx/einvoice` seulement si une capacité manque (sinon retire-la des deps + des imports).
- Mets à jour `format/providers.ts` (`En16931FormatProvider`) si la forme du port change ; conserve les
  mappings `DocumentSyntax → format`.
- Ajoute la lib à `transformIgnorePatterns` (package.json) si ESM.

**A.2 Harness.**
Réécris les attentes EN16931 dans `__fixtures__/invoices.ts` : viser **`valid:true`** pour ubl/cii/facturx/
zugferd/xrechnung quand e-invoice-eu les rend conformes. Le **round-trip CII** peut redevenir possible si
e-invoice-eu n'a pas le bug `fromXml` — vérifie ; sinon garde la stratégie in-memory+bytes documentée.
Le gate XRechnung `BR-DE-*` doit **se vider** (sinon, gate vivant sur ce qui reste).

**A.3 Acceptance & commit.** `npm run build` + harness vert ; cocher #3/#4/#5 dans le build-order avec le
nouveau statut. Commit `feat(compliance): migrate EN16931 family to @e-invoice-eu/core (closes BR-DE gaps)`.

---

## PHASE B — FatturaPA (🇮🇹 IT, SM) via `@digitalia/fatturapa`

- `npm i @digitalia/fatturapa`. Dans `InvoiceRenderingService` : `buildFatturaPa(data): string` (XML), via la
  lib (JSON→XML). Map `InvoiceRenderData` → structure FatturaPA 1.2.x (`FatturaElettronicaHeader` :
  CedentePrestatore/CessionarioCommittente, `DatiGeneraliDocumento`, `DettaglioLinee`, `DatiRiepilogo`).
- Étends `InvoiceArtifactPort` (`renderFatturaPa(invoiceId)`), implémente, et **remplis** `FatturaPaFormatProvider.build()`
  pour déléguer (mime `application/xml`).
- Harness : fixture `it-b2b` + attente (valid via la validation de la lib / XSD si dispo ; sinon gate vivant
  sur les erreurs XSD connues).
- Note : la **signature XAdES** et l'envoi **SdI** sont des étapes ultérieures (BLOC C, canal) → hors scope ici.
- Commit `feat(compliance): FatturaPA generation via @digitalia/fatturapa`.

---

## PHASE C — CFDI 4.0 (🇲🇽 MX) via `@nodecfdi/*`

- `npm i @nodecfdi/cfdiutils` (+ helpers utiles). Dans `InvoiceRenderingService` : `buildCfdi(data): string`
  → Comprobante 4.0 (Emisor, Receptor, Conceptos, Impuestos, UsoCFDI, FormaPago, MetodoPago, Moneda).
- Étends le port (`renderCfdi`), remplis `CfdiFormatProvider.build()`.
- **Important (rappel) :** CFDI est `AUTHORITY_RANGE` — le **timbrado par un PAC** (UUID/folio) est un
  **service externe = canal**, PAS le format. Tu génères le **XML pré-timbre** (sans sello/UUID réels) +
  TODO PAC. Le harness valide la **structure** (XSD CFDI si embarquable ; sinon présence des nœuds requis +
  gate vivant). Ne prétends pas qu'il est timbré.
- Commit `feat(compliance): CFDI 4.0 pre-stamp XML via @nodecfdi`.

---

## PHASE D — Facturae 3.2.2 (🇪🇸 ES) — XML custom + `xadesjs`

- Pas de lib JS clé en main → construire le XML Facturae (`FileHeader`, `Parties`, `Invoices/Invoice` :
  `InvoiceHeader`, `InvoiceTotals`, `Items`). Sérialiseur dédié dans `InvoiceRenderingService.buildFacturae(data)`.
- Signature : `npm i xadesjs` → **XAdES-EPES** requis. xadesjs fait BES nativement ; compléter EPES
  (SignaturePolicyIdentifier) si faisable cette nuit, sinon produire BES + TODO EPES (gate vivant).
- Étends le port (`renderFacturae`), remplis le provider Facturae (`national-formats.ts`, id `es-facturae`).
- Harness : fixture `es-b2b` + attente (XSD Facturae si embarquable ; sinon présence des nœuds + gate vivant
  listant ce qui manque, ex EPES). Commit `feat(compliance): Facturae 3.2.2 XML (+XAdES-BES) for ES`.

---

## PHASE E — KSA UBL 2.1 + QR (🇸🇦 SA / ZATCA)

- UBL 2.1 custom (réutilise le générateur UBL d'e-invoice-eu si possible) + extension KSA + **payload QR**
  (TLV base64 : nom vendeur, TVA, timestamp, total, TVA). `buildKsaUbl(data)`.
- Remplis `KsaUblFormatProvider.build()`. La **soumission FATOORA** = canal externe → TODO.
- Harness : fixture `sa-b2b` + présence QR + nœuds requis (gate vivant). Commit `feat(compliance): KSA UBL 2.1 + QR (ZATCA) generation`.

---

## PHASE F — FA_VAT (🇵🇱 PL / KSeF) — XML custom depuis XSD

- Pas de lib JS → sérialiseur FA(2)/FA(3) custom depuis le XSD du Ministère des Finances. `buildFaVat(data)`.
- Remplis `FaVatFormatProvider.build()`. Le **scellé + soumission KSeF** = canal externe → TODO.
- Harness : fixture `pl-b2b` + nœuds requis (gate vivant). Si le XSD est trop lourd cette nuit → squelette
  structurel + TODO précis (sections manquantes), **commit quand même** (protocole §0.3).
- Commit `feat(compliance): FA_VAT (PL/KSeF) XML skeleton`.

---

## PHASE G — National XML LATAM & autres (CL, BR, AR, EC, PE, CR, DO, GT, PA, PY, SV, BO, VE, TR, CN, EG, IN, …)

> Volume élevé, peu de libs JS, chacun son schéma. **Objectif réaliste cette nuit : un squelette structuré
> par pays + TODO précis**, pas la conformité totale.

- Améliore `NationalXmlFormatProvider` : router par `ctx.supplier.countryCode` vers un sérialiseur par pays
  dans `InvoiceRenderingService` (ex `buildClDte`, `buildBrNfe`, `buildArFe`…), chacun produisant le
  squelette des nœuds racines + entête + lignes + totaux connus du schéma national.
- Pour PY, regarde `facturacionelectronicapy-xmlgen` (lib existante) comme accélérateur.
- Chaque pays : fixture minimale + gate vivant (présence des nœuds racine) + TODO listant les sections
  spécifiques manquantes + le service de transmission (OSE/PAC/portail = canal).
- **Commit par lot cohérent** (ex un commit LATAM-1 : CL+AR+EC ; LATAM-2 : etc.), pas un commit géant.

---

## PHASE H — myDATA (🇬🇷 GR) & Online Számla (🇭🇺 HU)

- Ce ne sont pas des « libs de format » : XML custom + **API REST gouv** (= canal). Produire le **squelette
  XML** (`buildGrMyData`, `buildHuOnlineSzamla`) + TODO API. Providers à créer (A7 du build-order, formats absents).
- Harness : présence des nœuds + gate vivant. Commit `feat(compliance): GR myDATA + HU Online Számla XML skeletons`.

---

## CROSS-CUTTING (à chaque phase)
1. Étendre `InvoiceArtifactPort` + l'implémenter dans `InvoiceRenderingService` (cycle-safe).
2. Remplir le provider compliance correspondant (délégation via port).
3. Étendre le harness `__fixtures__/invoices.ts` + `format-validation.spec.ts` (gate vivant, jamais de faux vert).
4. Cocher la ligne dans `COMPLIANCE_BUILD_ORDER.md` avec le **statut honnête** (✅ conforme / ⚠️ squelette+TODO).
5. `npm run build` + harness → commit.

## VALIDATION AUTORITAIRE (optionnelle, opt-in — ne bloque pas la CI)
Les couches L2/L3 existent (`format-validation.offline.ts` Mustang/KoSIT, `format-validation.online.ts` EC ITB),
gated par `FORMAT_VALIDATION_OFFLINE=1` / `FORMAT_VALIDATION_ONLINE=1`. Si Java est dispo dans l'env, lance
**une fois** Mustang/KoSIT sur les sorties EN16931 (Phase A) et Factur-X pour confirmer la conformité réelle ;
sinon laisse en opt-in. Ne **jamais** mettre de réseau/Java dans le gate par défaut.

## RAPPORT FINAL (en fin de run)
Écris `documentation/compliance/FORMAT_IMPLEMENTATION_REPORT.md` : par format → statut (conforme / squelette),
lib utilisée, ce qui reste (codes d'erreur, service externe, champ modèle), et la liste des commits. Ce
rapport est ce que l'utilisateur lira au réveil.

---

## ORDRE D'EXÉCUTION (résumé)
A (EN16931 migration — spike→go/no-go) → B (FatturaPA) → C (CFDI) → D (Facturae) → E (KSA) → F (FA_VAT) →
G (LATAM & autres, par lots) → H (GR/HU) → Rapport final. Commit après chaque. Jamais de faux vert. Jamais bloquer.
