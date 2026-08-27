# 02 — Findings (Phase 1)

> Audit contradictoire, branche `audit/compliance-truth`. **Aucune correction n'a été apportée.**
> Chaque finding porte une reproduction exécutable ou une référence `fichier:ligne` vérifiable.
> Les reproductions vivent dans `scripts/audit/repro/`, leurs sorties dans `evidence/`.
>
> Sévérité `critical` réservée à : perte de preuve légale, promesse publique fausse, corruption de
> séquence, suppression d'un document légalement immuable.

## Classement — trois axes disjoints

La sévérité unique avait perdu sa résolution : six findings `critical` qui ne se comparaient pas.
F-001 archive du vide sur des chemins que personne ne peut emprunter ; F-018 est une obligation
légale échue qui pèse sur l'entreprise. Au même rang, la liste ne permettait plus de décider.

Les trois axes ci-dessous sont **disjoints** et classés **séparément**. Un finding figure dans un
seul. Le reste conserve sa sévérité, mais sous l'étiquette `qualité / dette` — ce qui ne veut pas
dire « sans gravité », seulement « ne relève d'aucun des trois axes de décision ».

### Axe 1 — Exposition juridique de l'éditeur

Ce que l'entreprise encourt elle-même, indépendamment de ses utilisateurs.

| # | Objet | Exposition |
| --- | --- | --- |
| [F-018](#f-018) | Déclaration responsable espagnole, échéance échue depuis mi-2025 | 150 000 €/exercice/type de système pour une déclaration inexacte ; 1 000 €/système sans déclaration |

**Seul finding de cet axe à ce jour** — et le seul de tout l'audit dont l'exposition soit présente
et chiffrée. Son rattachement n'est pas établi : voir la question à poser à un juriste espagnol,
en fin de section F-018.

### Axe 2 — Dégât utilisateur réel

Ce qui bloque une émission, l'invalide, ou trompe l'utilisateur sur l'état de sa facture.

| # | Objet | Effet | Reproduit |
| --- | --- | --- | :-: |
| [F-017](#f-017) | Plan résolu sur le seul pays du fournisseur | Document juridiquement inexistant dans un corridor, sans avertissement | ✓ |
| [MX-D1](03-LEGAL-VERIFICATION.md) | `AUTHORITY_RANGE` au Mexique | **Bloque toute émission mexicaine** avec la configuration par défaut | ✓ |
| [F-002](#f-002) | Garde de numérotation hors transaction | Trous définitifs dans une séquence censée être continue | ✓ |
| [F-008](#f-008) | Rejet d'autorité invisible | La facture s'affiche `SENT` alors que l'autorité l'a rejetée | — |
| [FR-D1](03-LEGAL-VERIFICATION.md) | `EMAIL` déclaré canal français | Canal illicite dans le champ ; 50 €/facture puis 500 € et 1 000 €/trimestre | — |
| [FR-D7](03-LEGAL-VERIFICATION.md) | BT-23 absent, cardinalité 1..1 | Échec des contrôles fonctionnels du PPF | — |
| [FR-D8](03-LEGAL-VERIFICATION.md) | Format du numéro non contraint | **Rejet du flux F1** si le numéro dépasse 35 caractères ou porte un spécial interdit | — |
| [PL-D1](03-LEGAL-VERIFICATION.md) | Annulation autorisée en Pologne | Produit un état juridiquement inexistant côté KSeF | — |
| [IT-D1](03-LEGAL-VERIFICATION.md) | Annulation autorisée en Italie | Idem, incohérent avec le registre TVA | — |
| [IT-D10](03-LEGAL-VERIFICATION.md) | `immutableAfter` déclenché trop tôt | **Bloque le renvoi après scarto**, chemin nominal de reprise | — |

`MX-D1` a été promu dans cet axe après reproduction : `AUTHORITY_RANGE` ne produisait pas
seulement du code mort. Voir `scripts/audit/repro/f019-mx-authority-range-block.ts`.

### Axe 3 — Promesse publique

| # | Objet |
| --- | --- |
| [F-004](#f-004) | 106 pages publiques de conformité pour 4 canaux réellement câblés |
| [F-017](#f-017) | *(second effet)* — les pages ne décrivent pas seulement des capacités absentes, elles décrivent la **mauvaise unité d'analyse** : l'unité réelle est le corridor, pas le pays |

### Qualité / dette

Sévérité conservée telle quelle. Aucun de ces findings ne relève des trois axes ci-dessus.

| # | Sévérité | Titre | Point |
| --- | --- | --- | :-: |
| [F-001](#f-001) | critical | Un document de zéro octet traverse tout le pipeline et est archivé | 1 |
| [F-003](#f-003) | critical | Une facture émise et acquittée est supprimable, sans aucune garde en base | 2 |
| [F-005](#f-005) | high | Le journal d'événements n'est pas append-only ; un document CLEARED est réécrivable | 4 |
| [F-006](#f-006) | high | Le document transmis n'est jamais stocké — il est reconstruit à l'affichage | 4 |
| [F-007](#f-007) | high | `REJECTED` est un cul-de-sac : ni re-soumission, ni correction, ni annulation | 5 |
| [F-009](#f-009) | high | L'UI invite à connecter 17 canaux qui ne peuvent rien émettre | 6 |
| [F-010](#f-010) | high | Le reçu d'archivage n'est ni vérifié ni persisté nulle part | 1 |
| [F-016](#f-016) | high | Les 10 handlers de reporting sont mockés mais renvoient `EMITTED` | 1 |
| [F-011](#f-011) | medium | `resetAll()` ne supprime rien et répond « All data reset successfully » | 2 |
| [F-012](#f-012) | medium | OTP des opérations destructives : en mémoire, `Math.random()`, mauvais destinataire | 2 |
| [F-013](#f-013) | medium | Aucune trace machine-lisible d'une exécution live réussie | 6 |
| [F-014](#f-014) | medium | Un spec écrit dans l'arbre de travail du développeur | 1 |
| [F-015](#f-015) | low | Un document CLEARED ne peut pas être corrigé sans passer par DELIVERED | 5 |

> **F-001 et F-003 restent `critical` et ne sont pourtant dans aucun axe de décision.** C'est
> délibéré : F-001 archive du vide sur des chemins qu'aucun transport ne permet d'emprunter, et F-003
> décrit une porte ouverte qu'aucun appel n'emprunte aujourd'hui. Leur gravité est intacte ; leur
> **urgence** ne l'est pas. C'est exactement ce que la sévérité unique ne savait plus dire.
---

<a id="f-001"></a>
## F-001 — `critical` — Un document de zéro octet traverse tout le pipeline et est archivé

**Point 1.** Reproduction : `scripts/audit/repro/f001-empty-archive.ts` — sortie complète dans
`evidence/f001-empty-archive.txt`.

### Constat

Un cycle complet `ComplianceExecutor.execute()` pour le Brésil produit **0 octet** et n'est bloqué
nulle part :

```
plan.artifacts : ["AUTHORITATIVE/NFE","HUMAN/PLAIN_PDF"]
  AUTHORITATIVE/NFE: 0 octets — validation.valid=true errors=0
  HUMAN/PLAIN_PDF:   0 octets — validation.valid=true errors=0
octets réellement produits par tout le pipeline : 0
archive : {"providerId":"s3-worm","region":"BR","retentionUntil":"2037-08-27T…","contentHash":"d31edef…"}
fichiers archivés : authoritative-nfe.xml (0 octets), human-plain_pdf.pdf (0 octets)
```

Trois mécanismes s'additionnent, chacun raisonnable isolément :

1. **Les builders émettent du vide.** `national-formats.ts:44-50` — les 42 providers de format
   nationaux renvoient `bytes: new Uint8Array()`. C'est assumé (« stub »), mais rien en aval ne le
   sait.
2. **La validation déclare le vide valide.** `providers/format/providers.ts:145` :
   `if (!rendered.bytes.length) return okValidation('… validation skipped (no bytes — stub path)')`.
   Les stubs nationaux, eux, renvoient inconditionnellement `{ valid: true, warnings: ['… (stub)'] }`.
   Sonde de la phase 0 : **54 syntaxes sur 54 déclarent `valid: true` pour un document vide.**
   Aucune ne le rejette.
3. **La garde de l'exécuteur ne peut donc jamais se déclencher.** `execution/executor.ts:250-262`
   bloque sur `a.validation && !a.validation.valid`. La condition est structurellement inatteignable
   pour un artefact vide.

Le seul signal émis est un `warning` non bloquant, noyé dans `result.warnings`.

### Reproduction

```bash
cd backend
COMPLIANCE_ARCHIVE_DIR=/tmp/audit npx tsx ../scripts/audit/repro/f001-empty-archive.ts
```

### Impact

Pour les **35 pays déclarés `CLEARANCE`** et l'ensemble du palier stub, « archivé » signifie
aujourd'hui « un fichier vide porte le nom d'une facture ». En cas de contrôle, l'archive ne prouve
rien — et pire, elle a l'apparence d'une archive valide (chemin, hash, rétention à 10 ans).

Note : cela n'affecte pas les syntaxes réellement implémentées (EN 16931, CFDI, FatturaPA, FA_VAT,
Facturae) tant qu'elles produisent des octets — la garde reste inopérante mais n'a rien à bloquer.

---

<a id="f-002"></a>
## F-002 — `critical` — La séquence « sans trou » perd des numéros sous concurrence

**Point 3.** Reproduction : `scripts/audit/repro/f007-numbering-concurrency.ts` — sortie dans
`evidence/f007-numbering-concurrency.txt`.

### Constat

L'allocation SQL elle-même est correcte. `utils/numbering.ts:61-72` utilise un
`INSERT … ON CONFLICT DO UPDATE SET counter = counter + 1 RETURNING counter` atomique, et huit
brouillons **distincts** émis en parallèle donnent bien `[1..8]`, sans doublon ni trou.

Le défaut est ailleurs : `invoices.service.ts:436-447` lit la facture et évalue ses gardes
(`status !== 'DRAFT'`, `number !== null`) **hors transaction**, puis ouvre la transaction qui alloue.
C'est un TOCTOU classique. Huit émissions concurrentes de **la même** facture :

```
appels ayant franchi la garde et alloué un numéro : 8/8
numéros alloués : [10,13,9,12,15,11,16,14]
compteur consommé : 8 → 16
numéro finalement porté par la facture : 16
NUMÉROS MANQUANTS DANS LA SÉRIE : [9,10,11,12,13,14,15]
```

Sept valeurs de séquence sont consommées puis perdues définitivement. Aucun document ne les porte,
et rien ne les enregistre comme annulées.

### Déclencheur réaliste

Deux requêtes `POST /api/invoices/:id/issue` concurrentes : double-clic sur le bouton d'émission,
rejeu automatique d'un client HTTP après timeout, ou deux onglets. Aucun accès privilégié requis.

### Reproduction

```bash
cd backend
npx dotenv -e .env.test -- npx tsx ../scripts/audit/repro/f007-numbering-concurrency.ts
```

Le script crée sa propre société marquée `AUDIT-CONCURRENCY-<pid>` et la supprime en `finally` ;
il ne touche aucune ligne préexistante.

### Impact

Une numérotation chronologique et continue est exigée par la plupart des régimes de facturation
(les profils du dépôt déclarent eux-mêmes `GAPLESS_SELF` pour la quasi-totalité des pays). Des trous
inexpliqués dans la série sont exactement ce qu'un contrôle cherche. La règle précise par pays
relève de la phase 2 — mais l'écart avec la propre déclaration `GAPLESS_SELF` du dépôt, lui, est
établi ici.

---

<a id="f-003"></a>
## F-003 — `critical` — Une facture émise et acquittée est supprimable, sans aucune garde en base

**Point 2.** Reproduction : `scripts/audit/repro/f004-delete-issued-invoice.ts` (transactions
annulées) — sortie dans `evidence/f004-delete-issued-invoice.txt`.

### Constat

Sur une facture `SENT`, numérotée `FA-2026-0042`, dont le `ComplianceDocument` est `CLEARED` avec un
identifiant d'autorité :

```
== 1. prisma.invoice.deleteMany({ where: { companyId } }) sur une facture SENT/CLEARED ==
   RÉSULTAT : 1 facture(s) supprimée(s) définitivement — aucune erreur
   ComplianceDocument : conservé, invoiceId = null
   événements conservés : 1 — identifiants autorité conservés : 1

== 5. existe-t-il une garde en base ? ==
   triggers applicatifs sur le schéma public : 0
   contraintes CHECK sur Invoice/ComplianceDocument/ComplianceEvent/NumberSeries : 0
```

La protection existe, mais **uniquement dans le code applicatif** : `invoices.service.ts:1114-1123`
refuse `deleteInvoice` sur tout ce qui n'est pas `DRAFT`, et fait un soft-delete (`isActive: false`).
C'est correct. Le problème est que ce n'est pas la seule porte :

- `danger.service.ts:64` appelle `prisma.invoice.deleteMany({ where: { companyId } })` **sans aucun
  filtre de statut** — hard delete de toutes les factures d'une société, émises et acquittées
  comprises.
- Aucun trigger, aucune contrainte CHECK, aucun `deletedAt` obligatoire : la base accepte la
  suppression de n'importe quelle facture, quel que soit son état.
- La contrainte `ComplianceDocument_invoiceId_fkey` est `ON DELETE SET NULL`
  (`prisma/migrations/20260624131458_compliance_lifecycle/migration.sql:44`). Le dossier de
  conformité survit donc à la facture — mais **orphelin** : `invoiceId = null`, plus aucun moyen de
  savoir à quelle facture il se rapportait.

### Ce qui empêche aujourd'hui le pire, et pourquoi ça ne compte pas

`resetApp()` exécute d'abord `prisma.company.deleteMany`, et `Invoice_companyId_fkey` est
`ON DELETE RESTRICT` :

```
== 2. prisma.company.deleteMany({ where: { id } }) ==
   BLOQUÉ par la base : Foreign key constraint violated on the constraint: `Invoice_companyId_fkey`
```

`resetApp()` lève donc dès sa première instruction dès qu'une facture existe, et la ligne 64 n'est
jamais atteinte. Mais c'est un **accident d'ordonnancement**, pas une garde : inverser deux lignes,
ou passer cette FK en `CASCADE` dans une migration future, transforme silencieusement l'appel en
suppression massive de documents émis. Les instructions ne sont d'ailleurs pas dans une transaction.

### Impact

Pour tout régime à journal inaltérable, une contrainte purement applicative ne vaut rien : elle ne
protège que les chemins qu'on a pensé à protéger. Ici, un chemin non protégé existe déjà dans le
code.

---

<a id="f-004"></a>
## F-004 — `critical` — 106 pages publiques de conformité pour 5 canaux réellement câblés

**Point 7.** Source : `00-INVENTORY.md` §1 à §3, entièrement mécanique.

### Constat

Le site publie **106 pages `/compliance/<cc>`**, présentées dans un navigateur à facettes
(`documentation/src/pages/compliance/index.tsx`) avec un badge « {count} countries », des filtres
par région, statut et format. En face :

| Ce qui est publié | Ce qui existe |
| --- | --- |
| 106 pays avec une page de conformité | 5 providers sur 62 disposent d'un transport atteignable (`peppol`, `pdp`, `ksef`, `choruspro`, `email`) |
| 54 syntaxes déclarées par les profils | 5 syntaxes rejettent un document invalide (`CFDI`, `ES_FACTURAE`, `FA_VAT`, `FATTURAPA`, `PEPPOL_BIS`) |
| 66 pays marqués `status: mandatory` | 0 trace d'une transmission réelle acquittée dans le dépôt |

**48 pays** ont une page publique alors qu'aucun `ChannelSpec` de leur profil ne résout vers un
provider capable d'émettre quoi que ce soit (catégorie 1a de l'inventaire). **8 pays de plus** — AL,
EG, HR, **IT**, MY, NG, RO, SA — déclarent dans leur *propre* profil un régime `CLEARANCE` bloquant,
et le seul transport joignable pour eux est `email` (catégorie 1b).

### Nuance importante, en faveur du dépôt

Le corps des fiches est très majoritairement écrit à la voix **prescriptive**, pas assertive : sur
les 106 fiches, on compte 15 tournures « Invoicerr must / should / needs to » contre seulement
**7 tournures de capacité au présent**, réparties sur 6 pays (CH, GB, GR, IN, IT, SG). Aucune fiche
ne contient de « ✅ ». Le texte, pris ligne à ligne, promet donc peu.

**C'est la structure qui promet, pas la prose.** Un répertoire nommé « Compliance », filtrable par
pays, affichant un compteur de pays et une page dédiée par juridiction, se lit comme une matrice de
couverture — quelle que soit la prudence du texte à l'intérieur. Un lecteur qui filtre sur « Brazil »
et atterrit sur une page détaillée n'a aucun moyen d'apprendre que `sefaz` ne peut pas émettre un
octet.

### Impact

C'est le finding le plus lourd de l'audit : il ne s'agit pas d'un défaut technique mais d'une
promesse publique qu'aucune preuve ne soutient. Il est aussi le plus facile à corriger sans toucher
au code — voir la proposition de dérivation depuis `compliance-truth.json` (phase 4).

---

<a id="f-005"></a>
## F-005 — `high` — Le journal d'événements n'est pas append-only ; un document CLEARED est réécrivable

**Point 4.** Reproduction : `f004-delete-issued-invoice.ts`, étapes 3 et 4.

```
== 3. le journal ComplianceEvent est-il append-only en base ? ==
   UPDATE d'un événement : ACCEPTÉ (type "CLEAR" → "FALSIFIE")
   DELETE d'un événement : ACCEPTÉ — reste 0 événement(s)

== 4. un ComplianceDocument CLEARED peut-il être réécrit ? ==
   UPDATE ACCEPTÉ : number "FA-2026-0042" → "FA-2026-9999",
                    immutableHash "deadbeef" → "cafebabe",
                    status "CLEARED" → "DRAFT"
```

L'architecture décrit le statut comme « une projection d'un journal append-only ». Le journal est
append-only **par convention de code** : `apply-signal.ts` n'écrit qu'en ajout et protège la
transition par un CAS (`transitionIfStatus`, `apply-signal.ts:151`), ce qui est un bon design pour
la concurrence. Mais rien au niveau de la base ne l'impose : ni révocation de `UPDATE`/`DELETE`, ni
trigger, ni chaînage vérifié.

La chaîne de hash, elle, existe bel et bien : `compliance-service.ts:243-253` chaîne chaque document
au précédent de sa série, et `audit-export.controller.ts:28-29` exporte `immutableHash` et
`previousHash` — un auditeur externe pourrait donc la vérifier. Deux réserves néanmoins :

1. **Rien dans le code ne la vérifie.** Aucune routine ne recalcule ni ne compare la chaîne ;
   `immutableHash` n'est jamais relu autrement que pour être chaîné au suivant. Une réécriture comme
   celle de l'étape 4 ci-dessus casse silencieusement la chaîne, et rien ne le détecte.
2. **Elle ne couvre pas le document.** `compliance-service.ts:169-171` calcule
   `sha256(JSON.stringify(ctx) + previousHash)` : le hash porte sur le *contexte de transaction*, pas
   sur les octets réellement émis et transmis. Même vérifiée, la chaîne n'attesterait pas de ce qui a
   été envoyé à l'autorité — voir F-006.

**Impact.** Un journal réécrivable ne fait pas foi. Pour les régimes qui exigent un journal
inaltérable, la propriété revendiquée par l'architecture n'est pas tenue au niveau où elle compte.

---

<a id="f-006"></a>
## F-006 — `high` — Le document transmis n'est jamais stocké — il est reconstruit à l'affichage

**Point 4.**

`invoice-rendering.service.ts:178-182` : `renderPdf(id)` relit la ligne `Invoice` et **re-génère** le
PDF à chaque appel. Le schéma Prisma ne contient aucune colonne d'octets de document (recherche
`Bytes` dans `schema.prisma` : seul `encryptedPfx`, sans rapport). Le `ArchiveReceipt`
(`uri`, `contentHash`, `retentionUntil`) est retourné en mémoire par
`compliance-service.ts:725-726` et **n'est persisté dans aucune table**.

Conséquence directe : il n'existe, à aucun endroit du système, une copie de ce qui a été réellement
émis et transmis. Le document affiché aujourd'hui est une reconstruction à partir de lignes
mutables — et F-005 montre que ces lignes sont mutables jusque dans le dossier de conformité.

**Impact.** Rien ne permet de prouver ce qui a été transmis à une autorité ni envoyé à un acheteur.
Pour un régime de clearance, où le document acquitté fait foi, c'est disqualifiant. La règle exacte
par pays relève de la phase 2 ; l'absence de stockage, elle, est établie.

---

<a id="f-007"></a>
## F-007 — `high` — `REJECTED` est un cul-de-sac : ni re-soumission, ni correction, ni annulation

**Point 5.** Source : `lifecycle/state-machine.ts:38-69`.

```ts
PENDING_CLEARANCE: { CLEAR: 'CLEARED', REJECT: 'REJECTED', ENTER_CONTINGENCY: 'CONTINGENCY' },
REJECTED: {},          // ← aucune transition sortante
```

Après un rejet d'autorité, le document est figé : aucun chemin vers une re-soumission après
correction, aucun vers `CORRECTED`, aucun vers `CANCELLED`. Le numéro alloué reste consommé (voir
F-002 pour ce que cela implique sur la série).

À comparer avec `TRANSMISSION_FAILED`, qui est correctement conçu comme rejouable
(`SUBMIT_CLEARANCE` et `DELIVER` en sortie, commentaire F-4 explicite). Le rejet applicatif est
donc traité comme rejouable, mais le rejet **de l'autorité** ne l'est pas.

**Ce que cet audit ne dit pas :** quelle est la règle correcte par pays. Selon les régimes, un
document rejeté n'a jamais existé juridiquement et doit être renvoyé — parfois sous le même numéro,
parfois sous un nouveau. Vérifier cela contre les sources primaires est le travail de la phase 2 ;
c'est enregistré comme `open_question` dans `compliance-truth.json`.

---

<a id="f-008"></a>
## F-008 — `high` — Un rejet d'autorité est invisible sur la facture que voit l'utilisateur

**Point 5.**

- L'énumération `InvoiceStatus` (`prisma/schema.prisma`) comporte `DRAFT, ISSUED, PAID, UNPAID,
  OVERDUE, SENT, ARCHIVED, PENDING_CLEARANCE, CLEARED, CANCELLED, CORRECTED` — **pas de `REJECTED`**.
- `apply-signal.ts`, qui traite les signaux d'autorité, n'écrit que `ComplianceDocument.status`
  (ligne 151). Recherche `prisma.invoice.update` dans tout `src/compliance` : **aucun résultat**.
- Les 10 écritures de `Invoice.status` du dépôt correspondent toutes à des actions utilisateur
  (`SENT`, `CANCELLED`, `CORRECTED`, `ARCHIVED`, paiement).

Une facture rejetée par KSeF, SdI ou un PDP reste donc affichée `SENT` ou `ISSUED` dans la liste des
factures. Le rejet n'existe que dans une table que l'écran principal ne lit pas.

**Impact.** L'utilisateur croit avoir facturé. Dans un régime de clearance où le rejet signifie que
la facture n'existe pas juridiquement, l'écart entre l'écran et la réalité est total, et silencieux.

---

<a id="f-009"></a>
## F-009 — `high` — L'UI invite à connecter 17 canaux qui ne peuvent rien émettre

**Point 6.**

Le garde-fou existe et fonctionne pour un palier : `channels.settings.tsx:218` calcule
`isStub = (maturity ?? "STUB") === "STUB"` et supprime le contrôle « Connect » pour les 41 providers
STUB. C'est correct et volontaire (commentaire F-8/M-16).

Mais `channel-connect-prompt.tsx:73` traite `IMPLEMENTED` comme équivalent à `PROVEN` :

```ts
const isLiveProvider = maturity === "PROVEN" || maturity === "IMPLEMENTED"
```

et affiche alors : *« Your country requires connecting {channels} to send compliant invoices. »*

Or l'inventaire mécanique montre que **les 17 providers `IMPLEMENTED`, sans exception, ne peuvent
mettre aucun octet sur le réseau** tel que le registre de production les construit — celui-ci ne
passe que `credentials`, jamais de port HTTP (`registry.ts:70-88`) :

| Provider | Pays | Transport tel que câblé |
| --- | --- | --- |
| `anaf` | RO | port stub `STUB_HTTP` **codé en dur** (`anaf-transmission.ts:79-89`, passé au client ligne 137 — aucun point d'injection) |
| `sdi` | IT | port par défaut dont chaque méthode `throw` (`sdi-transmission.ts:119`) |
| `sii`, `dian`, `sri`, `uy-dgi` | CL, CO, EC, UY | port par défaut = stub explicite |
| `es-face` | ES | court-circuit `SKIPPED` si aucun port |
| `choruspro` | FR | port stub `STUB_HTTP` **codé en dur** (`choruspro-transmission.ts:103-107`, passé lignes 193 et 249) |
| `afip`, `sefaz`, `gib`, `eg-eta`, `firs`, `ke-kra`, `id-coretax`, `in-irp`, `myinvois` | AR, BR, TR, EG, NG, KE, ID, IN, MY | aucun site d'appel réseau |

**Correction d'une première version de ce finding.** `choruspro` y figurait comme la seule exception,
créditée de 2 sites d'appel réseau. C'était faux, et l'erreur venait de la sonde : elle comptait les
marqueurs réseau sans retirer les commentaires, et `choruspro-transmission.ts:19` et `:101` contiennent
le mot « axios » dans deux commentaires décrivant ce qu'une vraie implémentation *devrait* faire. La
sonde laissait par ailleurs la présence d'un appel quelque part dans le voisinage primer sur la forme
du port réellement passé au client. Les deux défauts sont corrigés dans `inventory.ts`
(`stripComments()`, et la forme stub l'emporte désormais sur le comptage). Résultat après correction :

> **4 providers sur 62 disposent d'un transport atteignable : `ksef`, `pdp`, `peppol` (HTTP) et
> `email` (SMTP). Les 58 autres, dont les 17 `IMPLEMENTED`, ne le peuvent pas.**

**Impact.** L'utilisateur français (canal Chorus Pro), roumain, brésilien, chilien, colombien,
égyptien, indien, indonésien, kényan, malaisien, nigérian, turc, uruguayen, argentin ou espagnol est
invité par le produit à
saisir des identifiants pour un canal qui ne peut structurellement rien transmettre — et le fera
sans avertissement bloquant. `provider-maturity.spec.ts` verrouille cette classification
`IMPLEMENTED` en la faisant reposer sur `COMPLIANCE_AUDIT.md`, c'est-à-dire sur de la prose.

---

<a id="f-010"></a>
## F-010 — `high` — Le reçu d'archivage n'est ni vérifié ni persisté nulle part

**Point 1.** Reproduction : `f001-empty-archive.ts`, étape A.

```
receipt : {"providerId":"s3-worm","region":"EU","uri":"file://…/EU/e3b0c44…","retentionUntil":"2036-08-27T…","contentHash":"e3b0c44…"}
contentHash == SHA-256 de la chaîne vide ? true
répertoire créé, contenu : []
le receipt signale-t-il l'absence de contenu ? NON
```

`ArchiveProvider.store()` accepte une liste d'artefacts **vide**, crée le répertoire, n'écrit aucun
fichier, et renvoie un reçu indiscernable d'un succès : `providerId`, `uri`, `retentionUntil` à
10 ans, et un `contentHash`. Ce hash est la SHA-256 de la chaîne vide — une constante universelle,
donc trivialement reproductible par quiconque et sans valeur probante.

`ArchiveReceipt` ne porte ni `artifactCount` ni total d'octets, et n'est écrit dans aucune table
(voir F-006). Aucun code ne relit l'archive pour vérifier que le contenu correspond au hash.

**Impact.** « Archivé » n'est pas une information vérifiable dans ce système : c'est une valeur de
retour jetée.

---

<a id="f-011"></a>
## F-011 — `medium` — `resetAll()` ne supprime rien et répond « All data reset successfully »

**Point 2.** Source : `danger.service.ts:75-92`.

Le corps de la méthode ne contient aucun appel Prisma — seulement un commentaire
`// Reset all data logic here`, la remise à zéro de l'OTP, puis :

```ts
return { message: 'All data reset successfully' };
```

La documentation OpenAPI de l'endpoint (`danger.controller.ts`) annonce pourtant : *« Deletes all
data including documents, clients, and configuration for the active company. The company returns to
its initial state. »*

**Impact.** L'utilisateur qui exécute une opération destructive explicite, confirmée par OTP, reçoit
une confirmation de succès pour une opération qui n'a pas eu lieu. Il croira ses données effacées.
Sévérité `medium` et non `critical` parce que le sens de l'erreur est conservateur : rien n'est
détruit. Le manquement est la fausse confirmation.

---

<a id="f-012"></a>
## F-012 — `medium` — OTP des opérations destructives : en mémoire, `Math.random()`, mauvais destinataire

**Point 2.** Source : `danger.service.ts:11-45`.

Quatre observations sur le seul garde-fou des opérations destructives :

1. `private OTP: string | null` — champ d'instance en mémoire du processus. En déploiement scalé
   (`docker-compose.scale.yml`), l'OTP émis par une instance est invalide sur les autres, et un
   redémarrage l'invalide.
2. `Math.floor(10000000 + Math.random() * 90000000)` — `Math.random()` n'est pas
   cryptographiquement sûr ; 8 chiffres, sans limite de tentatives ni verrouillage observés.
3. L'OTP est envoyé à `process.env.SMTP_FROM || process.env.SMTP_USER` — **l'adresse technique de
   l'instance**, pas celle de l'utilisateur qui le demande. Le corps du message mentionne bien
   l'utilisateur (« An OTP code was sent to {user.email} ») alors qu'il ne lui a pas été envoyé.
4. `resetApp()` **n'invalide pas** l'OTP après usage (seul `resetAll()` le fait) : il reste rejouable
   pendant toute sa fenêtre de 10 minutes.

`@Roles(CompanyRole.OWNER)` protège correctement le contrôleur — c'est le second facteur qui est
faible, pas le premier.

**Impact.** Le facteur censé protéger la destruction de données ne protège pas ce qu'il prétend.
Sévérité `medium` parce que le rôle OWNER reste requis et que F-003 montre que `resetApp` échoue de
toute façon dès qu'une facture existe.

---

<a id="f-013"></a>
## F-013 — `medium` — Aucune trace machine-lisible d'une exécution live réussie

**Point 6.**

`live-gate.ts` et `portal-live.spec.ts` sont bien conçus : double barrière (drapeau `<PREFIX>_LIVE=1`
**et** présence de credentials), échec dur sur `REJECTED`/`SKIPPED`, et un harnais paramétré qui
couvre les 54 portails nationaux. Le dispositif est honnête.

Ce qui manque est la preuve d'exécution. Le dépôt ne contient :

- aucun fichier de résultat de run live,
- aucun horodatage de dernier succès,
- aucun artefact de réponse d'autorité versionné (pas d'UPO KSeF, pas de ricevuta SdI, pas d'accusé
  PDP).

Les dates de « dernier run réussi » n'existent que dans de la prose (`COMPLIANCE_TODO.md`,
`LIVE_TESTING.md`, notes de handoff). Cet audit ne les infirme pas — il constate qu'il ne peut ni
les confirmer ni les dater.

Il n'existe par ailleurs que **10 specs live dédiées**, couvrant 6 providers (`ksef`, `pdp`,
`peppol`, `email`, `sdi`, `choruspro`) : **56 providers sur 62 n'ont jamais eu de spec live dédiée**.

**Impact.** La maturité `PROVEN` n'est pas falsifiable en l'état. Un niveau L4/L5 ne peut pas être
attribué sans un artefact daté et versionné.

---

<a id="f-014"></a>
## F-014 — `medium` — Un spec écrit dans l'arbre de travail du développeur

**Point 1.** Ceci corrige l'hypothèse de départ de l'audit.

Les répertoires `backend/.compliance-archive/{EU,MX,SA,BR,GLOBAL}/e3b0c44298fc1c149afbf4c8996fb924…/`
signalés comme suspects sont **des résidus de test, pas des archives de production**. Ils sont
produits par `archive-registry.spec.ts:17-30`, qui appelle
`defaultArchiveRegistry.store([], policy(region), log)` — liste d'artefacts vide — sans définir
`COMPLIANCE_ARCHIVE_DIR`. `storage.ts:39` retombe alors sur `<cwd>/.compliance-archive`, et le `cwd`
de Jest est `backend/`. Le répertoire est gitignoré (`backend/.gitignore:65`) et non suivi par git.

Le spec voisin `providers.spec.ts` définit correctement `COMPLIANCE_ARCHIVE_DIR` ; seul
`archive-registry.spec.ts` ne le fait pas.

Le hash `e3b0c44…855` est bien SHA-256(""), mais parce que la liste est vide, **pas** parce qu'un
document vide aurait été archivé. Le vrai défaut derrière cette observation est F-010 (le reçu ment)
et F-001 (le pipeline archive du vide) — tous deux reproduits indépendamment.

**Impact.** Faible en soi : pollution de l'arbre de travail. Consigné parce que l'observation initiale
aurait pu être surinterprétée comme une preuve de production.

---

<a id="f-015"></a>
## F-015 — `low` — Un document CLEARED ne peut pas être corrigé sans passer par DELIVERED

**Point 5.** Source : `lifecycle/state-machine.ts:56-63`.

```ts
CLEARED:   { DELIVER: 'DELIVERED', CANCEL: 'CANCELLED' },   // pas de CORRECT
DELIVERED: { OPEN_RESPONSE, REPORT, CORRECT: 'CORRECTED', CANCEL },
```

Un document acquitté par l'autorité mais pas encore marqué livré à l'acheteur ne peut donc pas être
corrigé : il faut d'abord le faire transiter par `DELIVERED`. Si la livraison acheteur échoue ou
n'est pas modélisée pour ce pays, la correction est inatteignable.

Classé `low` : c'est une rigidité de graphe, contournable, et il se peut que ce soit délibéré. À
confronter aux règles réelles de correction en phase 2.

---

<a id="f-016"></a>
## F-016 — `high` — Les 10 handlers de reporting sont mockés mais renvoient `EMITTED`

**Point 1 (honnêteté des statuts).** Source : `reporting/handlers.ts:44-90`.

Les dix obligations déclaratives (`E_REPORTING`, `SAFT`, `OSS`, `IOSS`, `EC_SALES_LIST`, `INTRASTAT`,
`SALES_PURCHASE_LEDGER`, `CUSTOMS_EXPORT`, `SII`, `VERIFACTU`) passent toutes par la même fabrique
`makeReportingHandler`. Le corps partagé génère un payload structuré, le persiste en `PENDING`, puis :

```ts
// Mocked submission seam — real I/O plugged in per-kind when authority creds available
log.info(`reporting/${kind}`, `[MOCK] ${submitLabel} — period=… record=…`);
return { kind, status: 'EMITTED', ref: record.id };
```

Aucune soumission n'a lieu, et le résultat renvoyé est `EMITTED` — un statut de succès. Le caractère
mocké n'apparaît que dans une ligne `log.info`, jamais dans la valeur de retour ni dans le statut
persisté.

Le seam est correctement isolé et la génération de payload est réelle ; c'est le **statut retourné**
qui est faux. `SKIPPED` ou un `EMITTED` assorti d'un indicateur `mocked: true` diraient la vérité
sans rien changer d'autre.

**Impact.** Toute la couche déclarative rapporte un succès. Un appelant — ou un futur tableau de bord
de conformité — ne dispose d'aucun moyen programmatique de distinguer une déclaration réellement
transmise d'une déclaration jamais envoyée.

---

<a id="f-017"></a>
## F-017 — `critical` — Le plan est résolu sur le seul pays du fournisseur

Reproduction : `scripts/audit/repro/f017-corridor-resolution.ts` — sortie dans
`evidence/f017-corridor-resolution.txt`.

### Le constat

L'unité de rattachement d'une facture n'est pas un pays mais un **corridor** : (pays du
fournisseur, pays de l'acheteur, nature de l'opération). Trois couches s'empilent avec des règles de
rattachement différentes — règles de facturation TVA (art. 219 bis de la directive 2006/112/CE :
État membre où l'opération est réputée effectuée, avec dérogations), obligation de clearance
nationale (droit national, sur l'établissement ou l'immatriculation), et obligations du **récepteur**
(réception et archivage dans le pays de l'acheteur). Les deux pays ont des obligations simultanées
et non symétriques ; aucun ne « prévaut ».

`engine/compliance-engine.ts:70` résout bien **deux** profils (`s` fournisseur ligne 75, `b`
acheteur ligne 76). Mais le commentaire ligne 91 dit déjà la vérité : « Tax — the only step that
reads both profiles deeply. » La réalité mesurée, pour un même fournisseur français vers trois
destinations :

| Couche | FR→FR | FR→IT | FR→US | varie ? |
| --- | --- | --- | --- | :-: |
| régime | DECENTRALIZED_CTC | DECENTRALIZED_CTC | DECENTRALIZED_CTC | non |
| canaux | PDP, choruspro, PEPPOL, EMAIL | *idem* | *idem* | non |
| artefacts | …BUYER/FACTURX | …**BUYER/FATTURAPA** | *(pas d'artefact acheteur)* | **oui** |
| cycle de vie | ISSUE / CREDIT_NOTE | *idem* | *idem* | non |
| archivage | 10y BOTH HASH_CHAIN | *idem* | *idem* | non |
| numérotation | GAPLESS_SELF | *idem* | *idem* | non |
| reporting | — | **EC_SALES_LIST** | — | **oui** |

**Deux couches sur sept dépendent du corridor**, et uniquement par le canal de la fiscalité :
la syntaxe de réception de l'acheteur (`buildArtifacts(fmt, bp, …)`, quand `buyerNegotiable`) et les
`reportingFlags` dérivés du traitement TVA. **Cinq couches — régime, canaux, cycle de vie,
archivage, numérotation — sont lues exclusivement sur `sp`, le profil du fournisseur.**

### Le cas décisif

> **Correction d'une première version de ce finding.** Le cas était formulé « société française
> **immatriculée à la TVA** en Italie ». La prémisse juridique était fausse : l'AdE exclut
> expressément les « soggetti non residenti **meramente identificati** » du périmètre SdI
> (Circ. 13/E §1.2 ; Circ. 14/E §1.2 — « i quali **non sono tenuti** alla fatturazione
> elettronica »). Une identificazione diretta ou un représentant fiscal ne déclenchent rien.
> Le déclencheur est la **stabile organizzazione**, et seulement « **limitatamente alle operazioni
> da essa rese o ricevute** » (art. 7 c. 1 lett. d du DPR 633/1972) — donc une propriété de
> l'**opération**, pas de l'entité. Le cas corrigé est ci-dessous ; il rend la lacune du modèle
> **plus** aiguë, pas moins.

Une société **française disposant d'un établissement stable en Italie**, réalisant par cet
établissement une livraison **IT → IT** :

```
Ce que l'application construit :  régime DECENTRALIZED_CTC (non bloquant)
                                  canaux PDP, choruspro, PEPPOL, EMAIL
                                  artefact EN16931_CII
Ce que la règle italienne exige : régime CLEARANCE (BLOQUANT)
                                  canal  SDI
                                  artefact FATTURAPA
```

Le plan produit est **le plan français**. Or l'art. 1 c. 6 du D.Lgs. 127/2015 dispose qu'une facture
émise entre parties établies en Italie par une autre modalité que le SdI « **si intende non
emessa** », avec les sanctions de l'art. 6 du D.Lgs. 471/1997. Le produit émettrait donc un document
juridiquement inexistant, sans le moindre avertissement.

Et la lacune est plus profonde que « il manque un pays ». Puisque la qualité d'établi se juge
**opération par opération**, il ne suffirait pas d'ajouter un `establishmentCountry` à la société :
il faudrait un champ porté par la **transaction**, disant si l'établissement stable intervient dans
*cette* opération. Le format italien l'impose déjà — le bloc `StabileOrganizzazione` des spécifications
techniques n'est à renseigner que « nei soli casi in cui il cedente/prestatore è un soggetto non
residente ed effettua **la transazione oggetto del documento** tramite stabile organizzazione ».
Le modèle canonique n'a aucun emplacement pour cette information.

### Pourquoi le modèle ne peut pas l'exprimer

`PartyTaxProfile` porte pourtant le bon champ :

```ts
/** Jurisdiction governing the supply for this party (registration relevant to the supply). */
countryCode: ISO3166Alpha2;
establishmentCountry?: ISO3166Alpha2;
```

Mais **`establishmentCountry` n'apparaît qu'une seule fois dans tout le dépôt : sa propre
déclaration** (`canonical-document.ts:42`). Jamais peuplé, jamais lu. Et `countryCode`, qui devrait
porter la juridiction de l'opération, est alimenté par
`invoices.helpers.ts:130` :

```ts
countryCode: company.countryCode ?? guessCountryCode(company.country) ?? 'FR'
```

— c'est-à-dire **le pays de la société**, jamais un pays d'immatriculation lié à l'opération. Avec,
au passage, un repli silencieux sur la France quand le pays n'est pas résolu.

### Les obligations du récepteur sont absentes

Pour FR→IT, le plan ne porte du profil acheteur que `{ country: 'IT', confidence: 'OFFICIAL' }`.
Il n'existe ni champ `buyerArchival`, ni champ `buyerObligations`. L'archivage du plan est celui du
**fournisseur**. La troisième couche — ce que l'acheteur doit recevoir, conserver, et pendant
combien de temps — n'est pas modélisée du tout.

### Sévérité, et son lien avec F-004

`critical`, au titre de la « promesse publique fausse ». Ce n'est pas une incomplétude : dans le
corridor, le plan produit est **faux**, et il l'est en silence — aucun avertissement n'est levé.

Cela **aggrave la lecture de F-004**. Une page par pays laisse croire qu'on « gère le pays X », alors
que l'unité réelle est un corridor : un fournisseur français qui vend en Italie ne trouve sa réponse
ni sur la fiche FR, ni sur la fiche IT. Les 106 pages ne décrivent pas seulement des capacités
absentes — elles décrivent la **mauvaise unité d'analyse**.

Trois vérifications de la phase 2 confirment que ce n'est pas théorique — et la première est
décisive, puisqu'elle porte sur le marché principal, à cinq jours de son mandat :

- **France** — [CGI art. 289 bis, I](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044051178/2026-08-27)
  (en vigueur au 2026-02-21) : l'obligation s'applique lorsque « **l'émetteur de la facture et son
  destinataire sont des assujettis qui sont établis** ou ont leur domicile ou leur résidence
  habituelle **en France** ». Le critère est donc **bilatéral et cumulatif**, fondé sur
  l'**établissement** — et non sur l'immatriculation à la TVA. Hors de ce cas, on bascule sur
  l'**e-reporting** des art. 290 et 290 A : flux **F10** au lieu du F1, statuts 300/301 au lieu de
  200/210/212/213, rythme **périodique** au lieu de 24 h, et rectification par **remplacement de la
  période entière** au lieu d'un avoir. Deux régimes disjoints, deux formats, deux horloges — que le
  moteur ne peut pas distinguer puisqu'il ignore le statut d'établissement du destinataire.

- **Italie** — art. 1 c. 3-bis du D.Lgs. 127/2015 : les opérations avec des non-établis sortent du
  mandat SdI et basculent sur une **transmission de données** via le SdI, sortantes « entro i termini
  di emissione delle fatture », entrantes « entro il quindicesimo giorno del mese successivo ».
  Le profil IT déclare pourtant `reporting: aucun`.
- **Allemagne** — § 14 Abs. 2 S. 2 Nr. 1 et S. 3 UStG : le mandat ne se déclenche que si **les deux
  parties** sont établies en Allemagne. C'est un déclencheur explicitement **bilatéral**, que le
  moteur ne peut pas représenter puisqu'il ne consulte que le fournisseur.

- **Pologne** — art. 106ga ust. 2 pkt 1 et 2 de l'ustawa o VAT : le rattachement est posé « **przez
  podatnika** », l'assujetti **émetteur** seul. Le ministère précise qu'un acheteur polonais « **nie
  są zobowiązani do dokonywania weryfikacji** » de l'établissement de son fournisseur étranger. Le
  déclencheur polonais est donc **unilatéral**, et la Pologne **garde le transfrontalier dans le
  champ de l'émission** (« Faktury dokumentujące np. WDT, eksport […] są obowiązkowo wystawiane w
  KSeF »), traitant l'extranéité au stade distinct de la **mise à disposition** (art. 106gb ust. 4,
  six branches alternatives, plus code QR obligatoire).

**La règle de rattachement varie d'un pays à l'autre**, et c'est le cœur du problème. Une première
version de ce finding généralisait un déclencheur bilatéral à partir de la France, de l'Allemagne et
de l'Italie ; la Pologne l'a infirmé. Le constat correct est plus lourd :

| Pays | Déclencheur | Pivot | Transfrontalier |
| --- | --- | --- | --- |
| France | bilatéral | les deux établis | hors mandat → e-reporting art. 290 |
| Allemagne | bilatéral | les deux établis | hors mandat → ZM § 18a |
| Italie | bilatéral (SdI) / unilatéral (c. 3-bis) | les deux / le transmetteur | hors mandat → données c. 3-bis |
| Pologne | **unilatéral** | **vendeur** | **dans le mandat** |
| Espagne — Veri\*Factu | **unilatéral** | **statut fiscal du vendeur** | **dans le régime** |
| Espagne — mandat B2B | **bilatéral** | **acheteur** | hors mandat |

Cinq pivots différents pour six régimes. L'Espagne fournit le contre-exemple le plus net : son mandat
B2B pivote sur l'**établissement de l'acheteur**, de sorte qu'une résolution fondée sur le vendeur s'y
trompe **dans les deux sens** — faux positif sur ES → FR, faux négatif sur un vendeur étranger soumis
aux règles espagnoles vendant à un acheteur établi en Espagne.

Une stratégie de résolution unique est donc fausse **quel que soit le choix retenu**. La résolution
« fournisseur seul » du moteur se trouve juste pour la Pologne et fausse pour la France et
l'Allemagne — par accident, pas par conception.

L'Allemagne fournit d'ailleurs l'illustration la plus nette de ce que « juste par accident »
signifie. Le **§ 14 Abs. 7 UStG** transpose l'art. 219 bis : quand le fournisseur n'est pas établi en
Allemagne et que le preneur est redevable au titre du § 13b, « **so gelten abweichend von den
Absätzen 1 bis 6** für die Rechnungserteilung die **Vorschriften des Mitgliedstaats** » du
fournisseur — sauf convention d'autofacturation. Dans ce cas précis, résoudre sur le pays du
fournisseur donne le **bon** résultat. Mais le moteur l'applique sans connaître la condition qui l'y
autorise, donc il l'appliquerait identiquement aux cas où elle est fausse.

Le même rapport montre en outre que **le mot « établi » n'a pas une seule définition, même à
l'intérieur d'une seule loi** : le UStG en compte trois — `§ 14 Abs. 2 S. 3` pour le déclencheur
d'émission (Betriebsstätte **participante**), un prédicat **unilatéral** pour l'obligation de
réception, et `§ 14b Abs. 3` pour la localisation d'archivage (**Zweigniederlassung**, Wohnsitz sans
condition). Un unique booléen `isEstablished` ne peut servir les trois. Il ne suffit pas d'ajouter le pays de l'acheteur :
**le déclencheur lui-même doit devenir une donnée du profil**, au même titre que le régime ou
l'archivage. Et le canal de remise doit être un prédicat **séparé** de l'obligation d'émission —
la Pologne le démontre, en les distinguant explicitement.

### Ce qui n'est pas en cause

La fiscalité, elle, est correctement composée : `determineTax(ctx, sp, vat, bp)` lit les deux
profils, produit bien l'autoliquidation (catégorie `AE`, 0 %) sur FR→IT et l'exonération export
(catégorie `O`) sur FR→US, et déclenche `EC_SALES_LIST`. L'architecture « composer deux profils
plutôt qu'une matrice N×N » est la bonne ; elle n'a simplement jamais été étendue au-delà de la
couche fiscale.

---

<a id="f-018"></a>
## F-018 — `critical` — Une obligation espagnole pèse sur l'éditeur, et son échéance est expirée

Ce finding ne porte pas sur la couverture d'un pays. Il porte sur **Invoicerr en tant que producteur
de logiciel**, et c'est le seul de l'audit dont l'exposition est **présente et chiffrée**.

### La règle

Le RD 1007/2023 s'applique aux contribuables **et** aux éditeurs. Art. 3.2, texte vérifié
directement sur le [BOE consolidé](https://www.boe.es/buscar/act.php?id=BOE-A-2023-24840) le
2026-08-27 :

> « El presente Reglamento **también se aplicará a los productores y comercializadores de los
> sistemas informáticos** »

L'art. 13 impose une **declaración responsable** par laquelle le producteur certifie lui-même la
conformité de son système. Elle doit figurer « **por escrito y de modo visible en el propio sistema
informático** », être remise au client et au commercialisateur au moment de l'acquisition, et exister
**pour chaque version**. L'Orden HAC/1177/2024 art. 15 en fixe le contenu littéral, dont deux
indicateurs qui décrivent exactement l'architecture d'Invoicerr : `1.e` — le système fonctionne-t-il
uniquement en mode VERI\*FACTU — et `1.f` — **le système supporte-t-il plusieurs obligés tributaires**,
c'est-à-dire le multi-tenant.

### L'échéance ✓✓

Disposición final cuarta, vérifiée directement sur le BOE consolidé : les producteurs et
commercialisateurs disposent de **neuf mois à compter de l'entrée en vigueur de l'orden ministerial**
pour offrir des produits pleinement adaptés. L'Orden HAC/1177/2024 est entrée en vigueur le
**2024-10-29**.

> **L'échéance est donc échue depuis l'été 2025.** Elle ne dépend pas du calendrier des clients —
> ceux-ci ont jusqu'au 2027-01-01 ou au 2027-07-01, l'éditeur non.

### Ce qui rend le point actionnable plutôt que théorique

**Un producteur établi hors d'Espagne peut parfaitement émettre cette déclaration**, sans NIF
espagnol ni représentant fiscal. L'Orden art. 15.1.i) prévoit expressément : « **Si no dispone de NIF
español, deberá hacer constar otro número de identificación de que disponga**, indicando de qué tipo
de identificación se trata y el país que lo ha emitido ». Le document d'exemples publié par l'AEAT
illustre le cas avec un numéro de TVA intracommunautaire portugais.

Il s'agit par ailleurs d'une **auto-certification** : aucun organisme tiers, aucun enregistrement
préalable. C'est donc une obligation à coût faible et à exposition élevée.

### Exposition

Les sanctions relèvent de la LGT art. 201 bis, qualifiées d'infractions **graves** : **150 000 €
par exercice et par type de système** pour un système ne respectant pas les spécifications
techniques de l'art. 29.2.j) LGT ; **1 000 € par système commercialisé** en l'absence de déclaration
responsable. *(Montants rapportés par la vérification pays ; la disposition elle-même n'a pas été
relue verbatim par mes soins — l'échéance, elle, l'a été.)*

À rapprocher de **ES-D1** : le profil déclare `hashChain: false` alors que le chaînage est obligatoire
dans les deux modalités. Une déclaration responsable attestant la conformité d'un système qui ne
chaîne pas ses registres serait une déclaration inexacte — c'est-à-dire le cas visé par le premier
montant, pas le second.

### Décision attendue

C'est un arbitrage d'entreprise, pas technique : émettre la déclaration responsable suppose d'être en
état de la tenir. Deux ordres possibles — corriger d'abord le chaînage puis déclarer, ou déclarer sur
un périmètre restreint. Cela n'entre pas dans le mandat de cet audit.

---

## Ce que la phase 1 n'a pas tranché

- **La correction des règles légales.** Aucune source primaire n'a été consultée (phase 2). F-007 et
  F-015 en dépendent directement.
- **L'existence de sandboxes.** F-009 et F-013 supposent qu'un provider `IMPLEMENTED` *pourrait* être
  testé. Si aucun sandbox n'existe, le plafond est L2 quoi qu'il arrive (phase 3).
- **`Log`** — le modèle applicatif de journalisation n'a pas été audité ; seul `ComplianceEvent` l'a
  été. À reprendre.
- **Le chaînage de hash** (`previousHash`/`immutableHash`) : constaté non vérifié, mais l'analyse de
  ce que le chaînage devrait couvrir reste à faire.
