# HANDOFF — audit de conformité Invoicerr

**Branche** `audit/compliance-truth`, **poussée**. Une branche de correction séparée,
`fix/channel-ui-gate-on-reachable-transport`, est poussée elle aussi.
**Phases 0, 1, 2 et 3 terminées.**
Aucune correction sur la branche d'audit : `git diff feat/compliance-architecture..HEAD` n'y contient
que des ajouts sous `docs/compliance/audit/` et `scripts/audit/`.

---

## 1. État — phases 0, 1, 2 et 3 terminées

| Pays | Rapport principal | Volet transfrontalier |
| --- | :-: | :-: |
| France | ✅ | ✅ |
| Pologne | ✅ | ✅ |
| Allemagne | ✅ | ✅ |
| Italie | ✅ | ✅ |
| Espagne | ✅ | ✅ |
| Mexique | ✅ | ✅ |

Les cinq agents interrompus par une limite de service ont été relancés et ont tous livré.

**Reste ouvert, par ordre d'intérêt :** l'art. 6(5) de ViDA (report éventuel à 2035, non lisible dans
le rendu obtenu — enjeu réel pour l'Espagne au titre du SII) ; les deux documents techniques AEAT
(hash et QR), sans lesquels le chaînage espagnol **ne doit pas être implémenté** ; la publication de
l'orden ministerial du mandat B2B espagnol, seul événement qui démarre ses horloges ; et
`01-CLAIM-AUDIT.md`, `05-FEASIBILITY.md`, `06-REMEDIATION.md`, non écrits.

## 2. Les six findings `critical`

### F-017 — Le plan est résolu sur le seul pays du fournisseur *(nouveau, et le plus structurant)*

L'unité de rattachement n'est pas un pays mais un **corridor**. Mesuré : sur sept couches du plan,
**deux seulement** varient avec le corridor (syntaxe de réception de l'acheteur, et indicateurs de
reporting dérivés de la TVA). Régime, canaux, cycle de vie, archivage et numérotation sont lus
**exclusivement** sur le profil fournisseur.

Cas décisif — société française disposant d'un **établissement stable** en Italie et vendant IT→IT
par son intermédiaire : le moteur produit le plan **français** (`DECENTRALIZED_CTC`, non bloquant,
PDP) là où la loi italienne exige SdI, clearance bloquante et FatturaPA. L'art. 1 c. 6 du
D.Lgs. 127/2015 répute une telle facture *« non emessa »*. *(Une simple immatriculation TVA ne
suffirait pas — l'AdE exclut les « meramente identificati » ; c'est l'établissement stable qui
déclenche, et seulement pour les opérations qu'il réalise.)*

Le modèle ne peut pas l'exprimer, et le manque est plus profond qu'un pays absent :
`PartyTaxProfile.establishmentCountry` **n'apparaît qu'une fois dans tout le dépôt — sa propre
déclaration** ; `countryCode` est alimenté par le pays de la société avec repli silencieux sur
`'FR'` ; et comme la qualité d'établi se juge **opération par opération**, il faudrait un champ porté
par la **transaction**, pas par la société.

**La règle de rattachement varie d'un pays à l'autre — cinq pivots pour six régimes.** France et
Allemagne : bilatéral, les deux établis. Italie : bilatéral pour le SdI, unilatéral pour le reporting
c. 3-bis. Pologne : **unilatéral, vendeur seul**, et le transfrontalier reste **dans** le mandat.
Espagne : unilatéral pour Veri\*Factu (statut fiscal du vendeur), **bilatéral dominé par l'acheteur**
pour le mandat B2B. Mexique : unilatéral à l'émission, **bilatéral au cycle de vie** (annulation avec
acceptation tacite à 3 jours).

Une stratégie unique est donc fausse quel que soit le choix retenu. L'Allemagne le montre par
l'absurde : le **§ 14 Abs. 7 UStG** (art. 219 bis transposé) rend la résolution « fournisseur seul »
**correcte** dans un cas précis — mais le moteur l'applique sans connaître la condition, donc
identiquement là où elle est fausse. Et « établi » n'a pas une définition unique : le seul UStG en
compte **trois**, selon qu'il s'agit d'émettre, de recevoir ou d'archiver.

Reproduction : `scripts/audit/repro/f017-corridor-resolution.ts`

### F-001 — Un document de zéro octet traverse tout le pipeline et est archivé
54 syntaxes sur 54 déclarent valide un document vide. Un cycle complet pour le Brésil produit
0 octet, passe la validation, est signé, et est archivé avec une rétention de 10 ans.

### F-002 — La séquence « sans trou » perd des numéros
Huit émissions concurrentes de la même facture consomment 8 valeurs et en perdent 7 : série finale
`[1..8, 16]`. Garde `number !== null` évaluée hors transaction. Déclencheur : un double-clic.

### F-003 — Une facture émise et acquittée est supprimable
Hard delete d'une facture `SENT`/`CLEARED` sans erreur. **0 trigger, 0 contrainte CHECK** en base.

### F-004 — 106 pages publiques pour 4 canaux réellement câblés
F-017 en aggrave la lecture : les pages ne décrivent pas seulement des capacités absentes, elles
décrivent la **mauvaise unité d'analyse**. Un fournisseur français vendant en Italie ne trouve sa
réponse ni sur la fiche FR ni sur la fiche IT.

### F-018 — Une obligation espagnole pèse sur l'éditeur, échéance expirée
Le RD 1007/2023 s'applique « **también a los productores y comercializadores** ». Neuf mois à compter
de l'entrée en vigueur de l'Orden HAC/1177/2024 (2024-10-29) pour offrir un produit adapté portant sa
**declaración responsable** — **échéance échue depuis mi-2025**, indépendamment du calendrier des
clients. Auto-certification, émissible par un producteur non espagnol avec son numéro de TVA
intracommunautaire. Exposition LGT art. 201 bis : 150 000 €/exercice/type de système.
**C'est le seul finding de l'audit dont l'exposition est présente et chiffrée.**

---

## 3. Les trois divergences transverses de la phase 2

**La numérotation est fausse dans cinq pays sur six.** Seule la France exige réellement une séquence
continue. L'Allemagne (`einmalig`), l'Italie (`univoco`) et l'Espagne (`correlativa dentro de cada
serie`, sans interdiction de trou sourcée) n'exigent que l'unicité ; la Pologne ne contrôle que
l'unicité ; le Mexique n'a **aucune plage d'autorité** — `Serie` et `Folio` sont `use="optional"` dans
le schéma vendorisé du dépôt. Rapproché de **F-002**, cela donne : le produit impose une contrainte
que cinq de ses six marchés n'exigent pas, tout en ne la tenant pas là où elle l'est.

**L'archivage est mal modélisé dans les six.** France 6 ans (pas 10), Allemagne **8 ans**, Italie
10 ans prolongés, Pologne 10 ans **à la charge de KSeF** avec dispense du contribuable, Espagne
plancher 6 ans montant à ~14 pour l'immobilier, Mexique 5 ans **depuis le dépôt de la déclaration**.
Et la localisation est fausse dans les deux sens : omise là où elle existe (FR, DE, IT), **inventée**
là où elle n'existe pas (MX).

**L'e-mail est un canal illicite dans trois pays** — FR, PL, IT — alors que les trois profils le
déclarent. En Italie, le canal SdI est **PEC**, pas un e-mail ordinaire. Or l'inventaire de la
phase 0 montre que `email` est l'un des quatre seuls canaux joignables : dans ces trois pays, le seul
canal qui fonctionne est celui qui n'a pas le droit d'être utilisé.

---

## 4. Décisions déjà prises, et ce qui reste à trancher

**Décision 2 — livrée.** Les canaux `IMPLEMENTED` ne sont plus proposés dans l'UI. Correction
apportée à ton instruction : `choruspro` a lui aussi un `STUB_HTTP` codé en dur qui `throw` — les
2 « sites d'appel réseau » que ma sonde lui attribuait étaient le mot `axios` dans des commentaires.
Résultat corrigé : **4 providers sur 62** ont un transport atteignable ; les **17** `IMPLEMENTED`,
choruspro compris, n'en ont aucun. J'ai donc appliqué ton critère plutôt que ta liste. La France ne
perd rien : elle garde PDP et Peppol.

**En attente de toi :**

1. **Périmètre de remédiation de F-004** — recommandation : retirer du navigateur public les pays non
   soutenus, puis ajouter un bandeau dérivé de `compliance-truth.json`.
2. **Structure de `compliance-truth.json` face à F-017** — laissée **intacte**, comme demandé. La
   question est réelle : un pays par ligne ne peut pas porter un corridor. Passer aux corridors
   multiplie le fichier par le carré du nombre de pays. Piste intermédiaire : garder un pays par
   ligne pour les capacités **techniques** (format, transmission, réception) et ajouter un bloc
   `territorial_scope` par pays — déclencheur (unilatéral/bilatéral), périmètre (domestique/
   transfrontalier), obligation de substitution. Cela capte ce que la phase 2 a établi sans exploser
   la structure. **À valider avant que je touche au fichier.**
3. **Socle de garanties en base** (F-002, F-003, F-005) — mon avis : continuer l'audit d'abord, sauf
   F-002, petit et isolé, que je corrigerais tout de suite.
4. **Preuve datée d'un run live KSeF/PDP hors dépôt ?** Si ces artefacts existent, les verser dans
   `evidence/` ferait passer ces deux canaux en L4.

---

## 5. Livrables

| Fichier | État |
| --- | --- |
| `00-INVENTORY.md` + `inventory.json` | phase 0, à jour après correction de la sonde |
| `02-FINDINGS.md` | **17 findings**, F-001…F-017 |
| `03-LEGAL-VERIFICATION.md` | FR, PL, DE, IT + volet transfrontalier FR + statut honnête des manques |
| `04-TESTABILITY.md` | phase 3, 9 cibles |
| `compliance-truth.json` | 106 pays, testabilité intégrée, **structure non modifiée** |
| `scripts/audit/repro/` | 4 reproductions exécutables |
| `evidence/` | sorties capturées |

Non écrit : `01-CLAIM-AUDIT.md` (F-004 en contient la substance ; la comparaison page par page
attend le seuil de la décision 1), `05-FEASIBILITY.md` et `06-REMEDIATION.md` (phase 4).

---

## 6. Rejouer

```bash
git checkout audit/compliance-truth && cd backend
npx tsx ../scripts/audit/inventory.ts
npx tsx ../scripts/audit/seed-truth.ts
npx tsx ../scripts/audit/repro/f017-corridor-resolution.ts
COMPLIANCE_ARCHIVE_DIR=/tmp/audit npx tsx ../scripts/audit/repro/f001-empty-archive.ts
npx dotenv -e .env.test -- npx tsx ../scripts/audit/repro/f004-delete-issued-invoice.ts
npx dotenv -e .env.test -- npx tsx ../scripts/audit/repro/f007-numbering-concurrency.ts
```

`f004` tourne dans des transactions annulées ; `f007` crée sa propre société marquée
`AUDIT-CONCURRENCY-<pid>` et la supprime en `finally`. Aucun ne touche une ligne préexistante.

---

## 7. Discipline tenue

Rien d'inventé. Ce qui n'a pas été établi est resté `null` + `open_question` — y compris **ViDA**,
pourtant corroborée par deux sources indépendantes : EUR-Lex n'a pas pu être lu avant la coupure,
donc elle n'est pas retenue comme établie. Aucune divergence espagnole ou mexicaine n'est consignée.

Trois faux signaux de ma propre instrumentation ont été détectés et corrigés plutôt que publiés :
la détection « mentionne `HttpPort` », la contamination du voisinage source par le fichier
agrégateur, et le comptage de marqueurs réseau **dans les commentaires** — ce dernier ayant
faussement crédité `choruspro` d'un transport.
