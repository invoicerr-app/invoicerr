# B2G_COVERAGE — audit de couverture du routage B2G (`backend/src/modules/documents/b2g-routing/`)

> Audit réalisé le 2026-09-02, sur `feat/compliance-engine-v2`. Question posée : « manque-t-il du
> B2G pour des pays ? ». Méthode : les 27 États membres de l'UE, un par un — 4 déjà couverts avant
> cette tâche (FR/DE/IT/ES, inchangés ici) ; les 23 restants lus via WebFetch, JAMAIS via WebSearch
> (budget épuisé, consigne explicite de la tâche), contre les **eInvoicing Country Factsheets** de la
> Commission européenne (`ec.europa.eu/digital-building-blocks`, un jeu de 27 pages Confluence à ID
> séquentiel — 467108876 = Autriche … 467108902 = Suède, toutes lues avec succès) et, pour la
> Pologne, en plus, le portail officiel du ministère polonais des Finances (`ksef.podatki.gov.pl`).
> Chaque affirmation ci-dessous porte sa citation verbatim dans le fichier de règle correspondant
> (`b2g-routing/data/<cc>.json`'s own `provenance`/`notes`) — rien n'est affirmé sans lecture, aucun
> EAS Peppol n'est deviné (tous lus dans la codeliste officielle **Peppol Participant Identifier
> Schemes v9.7**, `docs.peppol.eu/edelivery/codelists/`).
>
> **Résultat en une phrase** : 10 des 23 pays lus sont réellement livrables avec les briques déjà
> présentes dans ce dépôt (peppol/peppol-bis pour 9, ksef/fa3 — le canal polonais lui-même — pour 1) ;
> les 13 autres sont lus mais **délibérément non livrés**, chacun pour une raison sourcée précise
> (un CIUS national non vendoré, ou un canal fermé dont la joignabilité Peppol n'est confirmée nulle
> part) ; **aucun pays de cette vague n'a été illisible** — les 23 fiches de la Commission se sont
> toutes chargées.
>
> **Preuves exécutées pendant cette tâche** : jest ciblé `b2g-routing/` + `actions/invoice-b2g-*` +
> `transports/peppol-transport.spec.ts` **75/75 passed** ; jest complet du module `documents`
> (spécs live exclues) **1839/1839 passed** (16 skipped = gated, attendu) ; `npm run build` (nest
> build) ✅ ; `npx biome check` sur tous les fichiers touchés ✅ (0 erreur, 0 avertissement) ; boot
> upsert réel (via `defaultB2gRoutingCatalog`) : **14 upserted, 0 deleted** (4 pays d'origine + 10
> nouveaux). Deux mutations rejouées et re-vérifiées mordantes (§4). Aucun commit.

---

## 1. Les 23 États membres restants — verdict, canal, source

Légende : ✅ couvert (règle ajoutée) · 🟡 lu, pas livrable (raison sourcée) · — illisible (aucun cas
cette fois).

| Pays | Verdict | Canal lu | Format lu | Règle ajoutée | EAS Peppol (codeliste v9.7) | Source, date de lecture |
|---|---|---|---|---|---|---|
| 🇦🇹 Autriche (AT) | 🟡 pas livrable | USP / e-Rechnung.gv.at (Peppol seulement pour le cross-border) | **CIUS AT** — « two Core Invoice Usage Specifications (CIUS): one aligned with national VAT law and another tailored to... the government sector », formats ebInterface 4.3/5/6 + UBL | non | — | EC factsheet AT, page 467108876, lu 2026-09-02 |
| 🇧🇪 Belgique (BE) | ✅ **couvert** | Mercurius (mailroom) → réseau Peppol | Peppol BIS Billing 3.0, « no ad hoc or national CIUS version » | **oui** — `peppol` / `peppol-bis` | `0208` (numéro d'entreprise BCE/KBO) | EC factsheet BE, page 467108877, lu 2026-09-02 |
| 🇧🇬 Bulgarie (BG) | 🟡 pas livrable | CAIS EPP (plateforme fermée, systèmes propres par entité) | UBL 2.1 / CII, « no national CIUS » — mais **aucune mention de Peppol** sur toute la page (recherche ciblée du mot, deux fois) | non | — | EC factsheet BG, page 467108878, lu 2026-09-02 (x2) |
| 🇨🇾 Chypre (CY) | ✅ **couvert** | « All public sector entities ... are connected to Peppol Access Points » | Peppol BIS Billing 3.0, « no national CIUS or additional extensions » | **oui** — `peppol` / `peppol-bis` | `9928` (TVA, seul schéma existant pour CY) | EC factsheet CY, page 467108880, lu 2026-09-02 |
| 🇨🇿 Tchéquie (CZ) | 🟡 pas livrable | NEN (Národní elektronický nástroj, plateforme fermée) | UBL 2.1 / ISDOC / EDIFACT, « no national CIUS » — mais **aucune mention de Peppol** (recherche ciblée, deux fois) | non | — | EC factsheet CZ, page 467108881, lu 2026-09-02 (x2) |
| 🇩🇰 Danemark (DK) | 🟡 pas livrable | NemHandel (+ Peppol BIS en support) | **CIUS DK — OIOUBL** (« OIOUBL 3.0, mandatory expected from 15 November 2025 ») | non | — | EC factsheet DK, page 467108882, lu 2026-09-02 |
| 🇪🇪 Estonie (EE) | ✅ **couvert** | Prestataires privés (Billberry, E-arveldaja, Finbite, Telema, Unifiedpost), « roaming agreements and Peppol connectivity » | « does not apply national CIUS or extensions beyond the European standard » | **oui** — `peppol` / `peppol-bis` | `0191` (code de registre du commerce) | EC factsheet EE, page 467108883, lu 2026-09-02 (x2, citation légale ciblée) |
| 🇫🇮 Finlande (FI) | 🟡 pas livrable | Opérateurs eInvoice + Handi / Basware Supplier Portal | **CIUS FI** — « a national Core Invoice Usage Specification (CIUS) tailored to government VAT requirements », Peppol BIS cité comme UN syntaxe possible mais dans le cadre du CIUS obligatoire | non | — | EC factsheet FI, page 467108884, lu 2026-09-02 |
| 🇬🇷 Grèce (GR) | ✅ **couvert** | KE.D (National Interoperability Centre) via prestataires certifiés sur le réseau Peppol | Peppol BIS Billing 3.0 — RELU deux fois pour lever l'ambiguïté « CIUS 3.0 » : c'est le CIUS standard OpenPeppol, PAS une extension grecque | **oui** — `peppol` / `peppol-bis` | `9933` (TVA, seul schéma existant pour GR) | EC factsheet GR, page 467108887, lu 2026-09-02 (x2) |
| 🇭🇷 Croatie (HR) | 🟡 pas livrable | Servis eRačun za državu (FINA), intégré à Peppol | **CIUS HR** — « Croatia has developed a national CIUS... to ensure that eInvoices meet the country's VAT and public procurement requirements » | non | — | EC factsheet HR, page 467108879, lu 2026-09-02 |
| 🇭🇺 Hongrie (HU) | 🟡 pas livrable | NAV Online Invoicing System (plateforme fermée du fisc) | « fully compliant... no CIUS or extensions are used », format XML — mais **aucune mention de Peppol** (recherche ciblée) | non | — | EC factsheet HU, page 467108888, lu 2026-09-02 (x2) |
| 🇮🇪 Irlande (IE) | 🟡 pas livrable | Réseau Peppol eDelivery | **CIUS IE multiples** — NSSO (gouvernement central) + Dept. of Education/ETB + Local Government, chacun sa propre CIUS « on top of PEPPOL BIS Billing 3.0 » | non | — | EC factsheet IE, page 467108889, lu 2026-09-02 |
| 🇱🇹 Lituanie (LT) | ✅ **couvert** | SABIS (a remplacé eSąskaita en sept. 2024), « connected to the Peppol network » | Peppol BIS Billing 3.0 / CII, « no national CIUS or additional extensions » | **oui** — `peppol` / `peppol-bis` | `0200` (code d'entité légale) | EC factsheet LT, page 467108892, lu 2026-09-02 |
| 🇱🇺 Luxembourg (LU) | ✅ **couvert** | « All public sector bodies are required to receive e-Invoices via the Peppol network » | UBL/CII via Peppol BIS Billing 3.0, « has not developed a specific national CIUS » | **oui** — `peppol` / `peppol-bis` | `0240` (registre des personnes morales) | EC factsheet LU, page 467108893, lu 2026-09-02 |
| 🇱🇻 Lettonie (LV) | ✅ **couvert** (nuance notée) | eAddress (VDAA) EN PREMIER, e-mail, et « PEPPOL service providers » cité comme méthode de transmission disponible | « no national CIUS or additional extensions » | **oui** — `peppol` / `peppol-bis` | `0218` (numéro d'immatriculation unifié) | EC factsheet LV, page 467108891, lu 2026-09-02 |
| 🇲🇹 Malte (MT) | ✅ **couvert** | « Malta chose to rely its eInvoicing system on the Peppol delivery network » | Peppol BIS Billing 3.0, « does not foresee any separate national CIUS » | **oui** — `peppol` / `peppol-bis` | `9943` (TVA, seul schéma existant pour MT) | EC factsheet MT, page 467108894, lu 2026-09-02 |
| 🇳🇱 Pays-Bas (NL) | 🟡 pas livrable | Digipoort (+ Peppol en amont, + portail central bas volume) | **CIUS NL — NLCIUS**, « a customised version of... EN 16931... for the Netherlands », Peppol BIS cité « with specific rules for the Netherlands » | non | — | EC factsheet NL, page 467108895, lu 2026-09-02 |
| 🇵🇱 Pologne (PL) | ✅ **couvert** (canal national, pas Peppol) | KSeF **ou** PEF — « B2G transactions can be processed through either KSeF or PEF » ; PEF porte des extensions Peppol polonaises propres, PAS vendorées ici | **fa3** (FA(3), schéma national KSeF 2.0, déjà vendoré et déjà prouvé live) | **oui** — `ksef` / `fa3` | n/a (canal national, pas Peppol) | EC factsheet PL, page 467108896 + `ksef.podatki.gov.pl` (portail JST), lus 2026-09-02 |
| 🇵🇹 Portugal (PT) | 🟡 pas livrable | FE-AP (eSPap), usage non obligatoire, portails tiers variés | **CIUS PT**, « Portugal applies... EN 16931... through its national version known as CIUS-PT », formats « UBL 2.1 or XML-GS1 » — **aucune mention de Peppol** sur la page | non | — | EC factsheet PT, page 467108897, lu 2026-09-02 |
| 🇷🇴 Roumanie (RO) | 🟡 pas livrable (malgré le transport `anaf` déjà câblé) | RO e-Factura (ANAF) | **RO_CIUS** — « Electronic invoices must conform to the RO_CIUS specifications » (Ordre MF 1366/2021) — **non vendoré** (`transports/anaf-transport.ts`'s own header le documente déjà : payload UBL générique, jamais RO_CIUS) | non | — | EC factsheet RO, page 467108898, lu 2026-09-02 |
| 🇸🇪 Suède (SE) | ✅ **couvert** | Prestataires de solution pour le compte des entités publiques | « The Peppol specification is used as-is without any national blends », Peppol BIS Billing 3.0, « No national-specific adaptations » | **oui** — `peppol` / `peppol-bis` | `0007` (Organisationsnummer, seul schéma ACTIF pour SE — `9955` retiré) | EC factsheet SE, page 467108902, lu 2026-09-02 |
| 🇸🇮 Slovénie (SI) | 🟡 pas livrable | PPA eInvoicing system (+ accès Peppol depuis 2018), Exchange Hub (ZZI) | **CIUS SI en construction — e-SLOG 2.0**, « includes some national extensions of the EN standard » | non | — | EC factsheet SI, page 467108900, lu 2026-09-02 |
| 🇸🇰 Slovaquie (SK) | 🟡 pas livrable (aujourd'hui) | IS EFA (canal actuel, fermé) ; **Peppol prévu, mais pas encore en service** — « will be replaced by [a] new national solution built on Peppol-based infrastructure... expected in 2027 » | Peppol BIS 3 sans CIUS **à partir de 2027 seulement** ; « Currently, Slovakia does not employ any... CIUS » (mais pas encore sur Peppol non plus) | non | — | EC factsheet SK, page 467108899, lu 2026-09-02 |

**Illisibles** : aucun. Les 23 fiches de la Commission européenne se sont chargées et ont livré du
texte exploitable — contrairement à l'hypothèse de départ de la tâche (WAF, langue non atteignable,
fiche vide), qui ne s'est matérialisée pour aucun des 23 pays cette fois.

**Limite honnête sur la profondeur de lecture** : pour 21 des 23 pays (tous sauf BE-recoupé-via-
channel-policy et PL), **seule** la fiche de la Commission a été lue — jamais le texte de loi
national primaire lui-même (Moniteur belge, BOE, Gazzetta, etc.), pour la même raison que fr.json/
de.json/it.json/es.json documentent déjà pour leurs propres tentatives (portails nationaux non-EN,
non atteints dans le budget de cette tâche). La fiche de la Commission est elle-même une source
officielle (DG CNECT), citée nommément par la tâche comme « la source de référence » — ce n'est donc
jamais une source de moindre rang que celle déjà utilisée ailleurs dans ce catalogue, mais ce n'est
pas non plus le texte de loi lui-même : consigné une fois ici plutôt que répété dans chaque fichier.

---

## 2. Les règles livrées — détail

| Pays | Transport | Format | EAS documenté | Identifiants requis | Notes clés |
|---|---|---|---|---|---|
| BE | `peppol` | `peppol-bis` | `0208` | aucun (le `PEPPOL_ENDPOINT` du client suffit) | pas de CIUS belge |
| CY | `peppol` | `peppol-bis` | `9928` | aucun | émission volontaire côté fournisseur, réception obligatoire côté administration |
| EE | `peppol` | `peppol-bis` | `0191` | aucun | modèle décentralisé (prestataires privés), Peppol = mécanisme d'interopérabilité entre eux |
| GR | `peppol` | `peppol-bis` | `9933` | aucun | ambiguïté « CIUS 3.0 » levée par une seconde lecture ciblée |
| LT | `peppol` | `peppol-bis` | `0200` | aucun | SABIS explicitement « connected to the Peppol network » |
| LU | `peppol` | `peppol-bis` | `0240` | aucun | la lecture la plus catégorique de la vague avec SE |
| LV | `peppol` | `peppol-bis` | `0218` | aucun | nuance assumée : eAddress est le canal principal nommé, Peppol une méthode parmi d'autres |
| MT | `peppol` | `peppol-bis` | `9943` | aucun | émission volontaire côté fournisseur (comme CY) |
| SE | `peppol` | `peppol-bis` | `0007` | aucun | « used as-is without any national blends » |
| PL | `ksef` | `fa3` | n/a | `VAT` (NIP) | canal national déjà prouvé live, PEF/Peppol PL délibérément écarté (extension non vendorée) |

Aucune de ces 10 règles n'ajoute de `requiredClientIdentifiers` pour l'adressage Peppol lui-même
(sauf le NIP polonais, structurel à FA(3), pas à l'adressage) : ce fait reste porté par la section
dédiée « Peppol / Electronic routing » du client (`PEPPOL_ENDPOINT`), jamais dupliqué dans la liste
générique — le même raisonnement que `b2g-routing/data/de.json` documente déjà pour le Leitweg-ID.

**Correctif fonctionnel nécessaire, découvert en câblant cette vague** : `resolveB2gInvoiceTransport`
(`actions/invoice-actions.ts`) pose `ctx.formatOverride` INCONDITIONNELLEMENT pour toute règle B2G ;
`peppol-transport.ts#resolveFormatForSend` traitait tout `formatOverride` non vide comme une demande
de substitution, donc une règle nommant `"peppol-bis"` — le format que ce canal envoie déjà PAR
DÉFAUT — aurait été refusée nommément (« no Peppol format override wired for it »), pour une raison
fausse. Corrigé en ajoutant `formatOverrides['peppol-bis']` (le même provider/documentTypeId que la
branche sans override) dans `documents-core.module.ts#buildTransportRegistry` — voir ce fichier's own
header pour le détail, et `peppol-transport.spec.ts`'s own nouveau test (« peppol-bis NAMES ITSELF »)
pour la preuve que le comportement est désormais BYTE-FOR-BYTE identique à un envoi sans override.
Sans ce correctif, LES DIX règles ci-dessus (BE/CY/EE/GR/LT/LU/LV/MT/SE) auraient été des règles
mortes — chargées, valides, mais refusant systématiquement tout envoi réel.

**Second correctif fonctionnel, plus sérieux, découvert en PROUVANT le cas BE par l'écran (Cypress)** :
la première tentative du test BE (§ Cypress ci-dessous) a réellement crashé — pas un refus propre,
une exception XPath brute (`XPST0017: Function Q{utils}gln with arity of 1 not registered`). Cause
trouvée en lisant `formats/vendored/peppol/PEPPOL-EN16931-UBL.sch` (le delta Peppol BIS vendoré) :
ce fichier déclare **13** fonctions XPath personnalisées (`u:gln`, `u:slack`, `u:mod11`,
`u:mod97-0208`, `u:abn`, `u:TinVerification`, `u:checkSEOrgnr`, plus 6 fonctions italiennes
CF/PIVA/IPA) comme de simples `<xsl:function>` internes au `.sch` — mais `node-schematron` (via
`fontoxpath`) n'en lit AUCUNE automatiquement ; **seule `u:slack`** avait jamais été enregistrée
explicitement (`validate-schematron.ts`). Un identifiant Peppol sous un schéma dont la règle
Schematron appelle une fonction NON enregistrée (0088 GLN, 0192 NO, **0208 BE**, 0151 AU,
**9933 GR**, **0007 SE**) ne provoque donc pas un rejet propre mais un CRASH — surfaçant, au bout de
la chaîne, comme une erreur brute et non nommée au lieu de « Cannot send via Peppol: the generated
document failed validation ». Cela touchait TROIS des dix EAS que cette même vague documente : BE
(0208), SE (0007) et GR (9933, `GR-R-009`/`GR-R-010`) — les rendant, avec leur EAS nationalement
correct, silencieusement cassés à l'envoi. **Corrigé** : `validate-schematron.ts` enregistre
désormais SIX fonctions (`u:gln`/`u:mod11`/`u:mod97-0208`/`u:abn`/`u:TinVerification`/
`u:checkSEOrgnr`) — un portage BYTE-FOR-BYTE de chaque corps `xsl:function` du `.sch` vendoré, jamais
un algorithme réinventé — prouvé par un nouveau spec dédié
(`formats/vendored/validate-schematron.spec.ts`, 6/6 verts) contre de VRAIS identifiants publics
(un numéro d'entreprise belge réel, le numéro d'organisation suédois public de Volvo AB, un AFM grec
démo bien connu, un ABN australien réel) — jamais de simples chaînes auto-cohérentes. Les SIX
fonctions italiennes restantes (`u:checkCodiceIPA`/`u:checkCF`/`u:checkCF16`/`u:checkPIVAseIT`/
`u:checkPIVA`/`u:addPIVA`) restent délibérément NON corrigées — hors périmètre de cette vague
(l'Italie a déjà son propre canal B2G réel, SdI/FatturaPA, jamais Peppol BIS pour son B2G) —
consigné ici comme un gap connu, séparé, pour une tâche future.

> **Mise à jour 2026-09-04 (`TODO_LIBRE.md` L2)** : ce gap est refermé. Les SIX fonctions italiennes
> ci-dessus sont désormais enregistrées dans `validate-schematron.ts`, même discipline (portage
> BYTE-FOR-BYTE des corps `xsl:function` du `.sch`, lignes sources citées en commentaire). Des **13**
> fonctions XPath personnalisées que le `.sch` déclare, les 13 sont maintenant enregistrées : `u:slack`
> (déjà au repère avant cette vague B2G) + les SIX identifiants ci-dessus + les SIX italiennes.
> `formats/vendored/validate-schematron.spec.ts` porte désormais 10 tests verts (6 + 4 nouveaux ;
> `u:checkCF16` et `u:checkPIVA`/`u:addPIVA` sont exercés transitivement via `u:checkCF`/
> `u:checkPIVAseIT`, jamais référencés directement par une règle — établi en grepant le `.sch`). Un
> identifiant italien (Codice Univoco Ufficio/Codice Fiscale/Partita IVA) dans un envoi Peppol BIS
> ordinaire ne crashe plus.

---

## 3. Pays lus mais délibérément non livrés — pourquoi

**Un CIUS national requis, non vendoré dans ce dépôt** (livrer du Peppol BIS générique contredirait
la règle lue) : **AT** (deux CIUS, dont un « tailored to... the government sector »), **HR** (CIUS
national pour VAT/marchés publics), **DK** (OIOUBL, v3.0 attendue au 15/11/2025), **FI** (CIUS
« tailored to government VAT requirements »), **IE** (trois CIUS sectoriels — NSSO/ETB/Local
Government), **NL** (NLCIUS), **PT** (CIUS-PT), **RO** (RO_CIUS — Ordre MF 1366/2021 ; le transport
`anaf` existe déjà mais construit de l'UBL générique, jamais du RO_CIUS, comme
`anaf-transport.ts`'s own header le documente déjà honnêtement), **SI** (e-SLOG 2.0, extensions
nationales). **10 pays.**

**Aucune joignabilité Peppol confirmée pour le canal fermé national lu** (le format serait acceptable
— pas de CIUS — mais rien ne prouve que ce canal est sur le réseau Peppol, et ce dépôt n'implémente
ni CAIS EPP ni NEN ni NAV Online Invoicing) : **BG** (CAIS EPP), **CZ** (NEN), **HU** (NAV Online
Invoicing) — chacun relu DEUX FOIS avec une recherche ciblée du mot « Peppol », zéro occurrence. **3
pays.**

**Peppol prévu mais pas encore en service** : **SK** — IS EFA aujourd'hui (canal fermé), bascule vers
« a new national solution built on Peppol-based infrastructure » explicitement datée « expected in
2027 » : ni le canal actuel ni le canal futur ne sont livrables aujourd'hui avec ce dépôt. **1 pays.**

Total : 10 + 3 + 1 = **13 pays lus, consignés, aucune règle ajoutée** — un client GOVERNMENT de l'un
de ces pays garde le refus honnête existant du mécanisme (« No B2G routing rule is declared for
"XX" ») lorsqu'il n'a pas déjà de règle — jamais un envoi B2B silencieux, jamais un format qui a l'air
conforme sans l'être.

---

## 4. Les deux mutations rejouées

1. **La provenance légale, sur MES fichiers** : `sourceText` vidé sur `be.json` (kind resté `"legal"`)
   → `assertValidB2gRoutingFact` (via `data/all.ts#loadCountryFile`) lève
   `InvalidB2gRoutingProvenanceError` immédiatement au chargement, EXACTEMENT comme pour les 4
   fichiers d'origine — le gate existant protège les nouveaux fichiers sans modification. Fichier
   restauré, re-vérifié identique (diff vide), suite `all.spec.ts` reverte à 18/18 verts.
2. **Le pays sans règle part en B2B silencieux** : dans `resolveB2gInvoiceTransport`
   (`actions/invoice-actions.ts`), la branche `if (!decision.rule) { throw ... }` remplacée par un
   retour silencieux vers le transport `email` — les deux tests dédiés de
   `actions/invoice-b2g-routing.spec.ts` (« a GOVERNMENT client of a country with NO B2G rule
   declared BLOCKS... » et le cas pays non résolu) échouent aussitôt (`TypeError` au lieu du
   `NotImplementedException` attendu). Code restauré, diff vide re-vérifié, suite revenue à 11/11
   verts.

---

## 5. Chiffres

- **Jest** : `b2g-routing/` + `actions/invoice-b2g-*` + `peppol-transport.spec.ts` +
  `formats/vendored/validate-schematron.spec.ts` (nouveau) → **87/87**. Suite complète du backend
  (specs live exclues) → **1845/1861 passed** (16 skipped = gated, attendu ; 0 failed).
- **Build** : `npx prisma generate` + `npm run build` (nest build) → ✅, aucune erreur, à trois
  reprises (avant/après le correctif `formatOverrides`, avant/après le correctif Schematron).
- **Biome** : `npx biome check` sur tous les fichiers touchés/créés → 0 erreur, 0 avertissement
  (quelques fichiers reformattés automatiquement par `--write`, contenu jamais changé).
- **Boot upsert réel** (`defaultB2gRoutingCatalog`, jamais une fixture) : **14 upserted, 0 deleted**
  (4 pays d'origine + 10 nouveaux) — pinné par un test dédié dans `boot-upsert.spec.ts`, ET observé
  EN DIRECT au boot réel du backend (`start:test`) : `[B2gRoutingBootUpsertService] B2G routing rules
  upserted at boot: 14 upserted, 0 deleted (stale).`
- **i18n / frontend** : non touché par cette tâche (aucune donnée B2G nouvelle n'a besoin d'un écran
  nouveau — le mécanisme générique existant, `client-b2g-hint`/`requiredClientIdentifiers`/
  `requiredDocumentFields`, l'affiche déjà pour n'importe quel pays) — `npm run i18n:check` non
  ré-exécuté, aucun changement de `src/locales/*` livré.
- **Cypress, RÉELLEMENT EXÉCUTÉ** (backend `start:test` + frontend `start:test` déjà en route,
  Postgres/Redis/Mailpit e2e déjà en conteneurs), Firefox headless,
  `--config trashAssetsBeforeRuns=false` :
  - `40-b2g-routing.cy.ts` → **9/9 passed** (2m03s), dont le nouveau cas BE (canal peppol connecté par
    l'écran, identifiants fictifs vers un port fermé, échec réseau réel, jamais par email) et le cas
    régression « pays sans règle déclarée » (US) déjà présent, inchangé.
  - `31-national-channels.cy.ts` → **32/32 passed** (2m03s), régression complète PDP/KSeF/SdI/
    Peppol/Chorus Pro/ANAF/FACe, y compris le test Peppol pré-existant lui-même — aucune régression du
    correctif `formatOverrides['peppol-bis']` ni du correctif Schematron sur les canaux déjà prouvés.
  - Le PREMIER passage du test BE avait RÉELLEMENT ÉCHOUÉ (avant tout correctif) sur le crash
    Schematron du §2 — la preuve que ce test exerce un vrai chemin réseau/validation, jamais un
    scénario qui passait par construction.

---

## 6. Ce qui n'a pas été fait, sans l'enjoliver

- **Le portail national n'a été recoupé que pour PL** (en plus de la fiche de la Commission) — les 8
  autres pays couverts (BE/CY/EE/GR/LT/LU/LV/MT/SE) reposent SEULEMENT sur la fiche de la Commission,
  jamais sur un texte de loi national ou un portail gouvernemental relu indépendamment. C'est le
  niveau de preuve que le budget de cette tâche a permis, honnêtement nommé plutôt que présenté comme
  plus solide qu'il ne l'est.
- ~~**Les six fonctions Schematron italiennes** (`u:checkCodiceIPA`/`u:checkCF`/`u:checkCF16`/
  `u:checkPIVAseIT`/`u:checkPIVA`/`u:addPIVA`, toutes non enregistrées elles aussi) restent NON
  corrigées — voir §2, hors périmètre de cette vague (l'Italie a son propre canal B2G réel, jamais
  Peppol BIS). Un identifiant italien (codice fiscale/partita IVA/IPA) présent dans un envoi Peppol
  BIS ordinaire crasherait encore de la même façon.~~ **Corrigé le 2026-09-04** (`TODO_LIBRE.md` L2) —
  voir la mise à jour au §2 ci-dessus.
- **Le sélecteur Peppol de l'écran client** (`client-upsert.tsx`'s own `peppolSchemeId` : seulement
  0088/0192/0009/9925/0007/0208/0106/0151/0060) ne propose PAS nommément les EAS lus pour EE (`0191`),
  GR (`9933`), LT (`0200`), LU (`0240`), LV (`0218`), MT (`9943`), CY (`9928`) — un utilisateur de ces
  pays doit se rabattre sur `9925` (EU VAT, générique) ou saisir manuellement via le champ texte
  libre ; ce trou d'écran est nommé dans chaque fichier concerné mais N'A PAS été corrigé (hors
  périmètre déclaré de cette tâche : la règle de routage B2G, pas le sélecteur front-end).
- **Une incohérence PRÉ-EXISTANTE, trouvée en lisant `client-upsert.tsx` pour préparer le test BE,
  jamais introduite par cette tâche** : son option `"0106" — DK CVR` est mal étiquetée — `0106` est en
  réalité le schéma néerlandais (KVK, « Vereniging van Kamers van Koophandel », codeliste v9.7),
  jamais le CVR danois (qui est `0184`). Signalé ici pour mémoire, PAS corrigé (hors périmètre de
  cette tâche, et une correction non demandée aurait été un changement de code au-delà de l'audit
  B2G demandé).
- **AT/HR/DK/FI/IE/NL/PT/RO/SI/SK/BG/CZ/HU** : aucune règle, par construction (voir §3) — rien à faire
  de plus sans vendorer un CIUS nouveau ou implémenter un canal national nouveau, un travail hors
  périmètre d'un audit.
