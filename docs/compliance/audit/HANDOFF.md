# HANDOFF — audit de conformité Invoicerr

**Branche d'audit** `audit/compliance-truth`, poussée, à jour de l'amont.
**Branche produit** `feat/compliance-architecture`, poussée : les sept branches `fix/` ont été
fusionnées, puis l'amont a été intégré. **Phases 0 à 3, plus le plan de travail P0–P8, terminés.**

L'audit lui-même n'a rien corrigé : `git diff feat/compliance-architecture..HEAD` sur la branche
d'audit ne contient que `docs/compliance/audit/` et `scripts/audit/`. Les corrections ont vécu sur
des branches `fix/` distinctes, une par sujet, chacune avec son test de non-régression.

---

## 0. Par quoi commencer — F-008

**F-008 (`high`) est le premier sujet de la prochaine session**, avant tout autre travail.

Un rejet d'autorité — KSeF, SdI, PDP — n'atteint jamais l'écran de l'utilisateur. `apply-signal.ts`
écrit `ComplianceDocument.status` ; il n'existe aucun `prisma.invoice.update` dans tout
`src/compliance`, et l'énumération `InvoiceStatus` n'a même pas de valeur `REJECTED`. La facture
reste affichée `SENT`. L'utilisateur croit avoir facturé.

C'est le seul finding retenu qui soit à la fois de forte gravité, non corrigé, et sans dépendance
externe : il ne demande ni credential, ni décision juridique, ni publication d'un texte. Détail et
preuves : [F-008](02-FINDINGS.md#f-008).

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

**Depuis, trois des quatre questions ouvertes ont été refermées** — voir `03-LEGAL-VERIFICATION.md` :

- **ViDA art. 6(5)** — lu en source primaire (JO, extraction locale du PDF après deux rendus HTML
  tronqués). Le report est opérant : la mise en conformité des régimes nationaux préexistants est
  due au 2035-01-01. Ce n'est pas une dispense de fond, c'est un délai.
- **Les deux documents techniques AEAT** — obtenus. L'algorithme de huella du dépôt est conforme au
  spec publié, vérifié contre le condensat de référence de l'autorité, octet pour octet. ES-D1 était
  **faux** et a été rétracté ; le défaut réel est que `previousHuella` n'est jamais alimenté, donc
  chaque enregistrement se déclare `PrimerRegistro='S'`.
- **`06-REMEDIATION.md`** — écrit. `01-CLAIM-AUDIT.md` a été abandonné sur décision ; 
  `05-FEASIBILITY.md` reste différé.

**Reste ouvert :** la publication de l'orden ministerial du mandat B2B espagnol, seul événement qui
démarre ses horloges. Aucune date ne peut être avancée avant.

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

**L'e-mail est un canal illicite — en France, et en France seulement.** J'avais annoncé trois pays ;
c'était un faux positif de mon inventaire, qui aplatit toutes les périodes temporelles. La Pologne
abandonne l'e-mail au 2026-02-01 et l'Italie au 2019-01-01 : leurs profils sont corrects. Corrigé sur
`fix/profile-illicit-email-channel`, France uniquement — ce qui lui retire le seul canal qui
fonctionnait sans configuration, et rend le vide visible au lieu de le masquer.

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
| `00-INVENTORY.md` + `inventory.json` | phase 0, **temporel**, date de référence `AUDIT_AS_OF` (défaut 2026-08-27) |
| `02-FINDINGS.md` | **21 findings**, F-001…F-021 |
| `03-LEGAL-VERIFICATION.md` | FR, PL, DE, IT, ES, MX + volet transfrontalier + ViDA + portée territoriale |
| `04-TESTABILITY.md` | phase 3, 9 cibles |
| `06-REMEDIATION.md` | plan de remédiation |
| `07-FR-2026-09-01.md` | la page France |
| `08-CORRIDOR-MODEL.md` | note de conception du corridor (F-017) — **sans code** |
| `09-F018-ES-DECLARATION.md` | la séquence espagnole |
| `10-ACQUIS.md` | **ce qui tient** — cinq catégories, chacune avec ce qui l'établit |
| `compliance-truth.json` | 106 pays, testabilité intégrée, **structure non modifiée** |
| `scripts/audit/repro/` | 5 reproductions exécutables |
| `evidence/` | sorties capturées |

Non écrit : `01-CLAIM-AUDIT.md`, abandonné sur décision (F-004 en porte la substance) ;
`05-FEASIBILITY.md`, différé.

### Le piège de l'inventaire, à ne pas retendre

Les profils sont **temporels**. La première version de `inventory.ts` aplatissait toutes les périodes
d'une règle, ce qui a produit deux divergences fausses — PL-D4 et IT-D8, toutes deux rétractées : le
canal EMAIL qu'elles reprochaient est bien retiré, en 2026-02-01 pour la Pologne et en 2019-01-01
pour l'Italie. Depuis, tout champ dérivé d'un profil est calculé **en vigueur à la date de
référence**. Les champs `everDeclared*` conservent la vue aplatie à titre documentaire seulement :
**aucun finding ne doit s'y adosser**, ils n'établissent rien sur l'état en vigueur.

Même nature de piège côté sondes : la détection des paliers de stub reconnaît le fichier qui déclare
l'identifiant du fournisseur. Elle a survécu à un refactor amont qui a supprimé les bundles
`*smaller-portals.ts` uniquement parce qu'elle a été repointée sur `portals/<cc>.ts`. **Elle échoue
en silence, pas en erreur** : un motif qui ne correspond plus à rien promeut tous les stubs
génériques en « dédié ». À revérifier à chaque déplacement de l'arborescence de transmission.

---

## 6. Rejouer

```bash
git checkout audit/compliance-truth && cd backend
npx tsx ../scripts/audit/inventory.ts
npx tsx ../scripts/audit/seed-truth.ts
npx tsx ../scripts/audit/repro/f017-corridor-resolution.ts
npx tsx ../scripts/audit/repro/f019-mx-authority-range-block.ts
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
