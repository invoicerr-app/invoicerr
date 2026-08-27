# HANDOFF — audit de conformité Invoicerr

**Branche** `audit/compliance-truth`, **poussée**. Une branche de correction séparée,
`fix/channel-ui-gate-on-reachable-transport`, est poussée elle aussi.
**Phases 0, 1 et 3 terminées. Phase 2 aux quatre septièmes.**
Aucune correction sur la branche d'audit : `git diff feat/compliance-architecture..HEAD` n'y contient
que des ajouts sous `docs/compliance/audit/` et `scripts/audit/`.

---

## 1. Blocage en cours

**Cinq des six agents de la phase 2 ont été interrompus par une limite de service**
(réinitialisation annoncée à **18 h 20, Europe/Paris**). Les appels web sont tombés au même moment.

| Pays | Rapport principal | Volet transfrontalier |
| --- | --- | --- |
| France | ✅ | ✅ |
| Pologne | ✅ | ❌ interrompu |
| Allemagne | ✅ | ❌ interrompu |
| Italie | ✅ | ❌ interrompu |
| **Espagne** | ❌ **jamais transmis** (seul un addendum est arrivé) | ❌ |
| **Mexique** | ❌ **rien** | ❌ |

**À reprendre en premier, dans cet ordre :** (1) rapport principal Espagne — l'agent l'a produit mais
ne me l'a jamais transmis, il suffit de le lui redemander ; (2) rapport Mexique, à relancer depuis
zéro ; (3) ViDA sur EUR-Lex ; (4) les cinq volets transfrontaliers manquants.

---

## 2. Les cinq findings `critical`

### F-017 — Le plan est résolu sur le seul pays du fournisseur *(nouveau, et le plus structurant)*

L'unité de rattachement n'est pas un pays mais un **corridor**. Mesuré : sur sept couches du plan,
**deux seulement** varient avec le corridor (syntaxe de réception de l'acheteur, et indicateurs de
reporting dérivés de la TVA). Régime, canaux, cycle de vie, archivage et numérotation sont lus
**exclusivement** sur le profil fournisseur.

Cas décisif — société française immatriculée en Italie, vente IT→IT : le moteur produit le plan
**français** (`DECENTRALIZED_CTC`, non bloquant, PDP) là où la loi italienne exige SdI, clearance
bloquante et FatturaPA. L'art. 1 c. 6 du D.Lgs. 127/2015 répute une telle facture *« non emessa »*.

Le modèle ne peut pas l'exprimer : `PartyTaxProfile.establishmentCountry` **n'apparaît qu'une fois
dans tout le dépôt — sa propre déclaration**, et `countryCode` est alimenté par le pays de la
société, avec repli silencieux sur `'FR'`.

Confirmé par les trois juridictions vérifiées, qui posent toutes le **même** schéma : mandat
domestique à déclencheur **bilatéral**, transfrontalier renvoyé vers une obligation déclarative
distincte. France : art. 289 bis I — « l'émetteur **et** son destinataire […] établis […] en
France », sinon e-reporting art. 290 (flux F10, statuts 300/301, rythme périodique, rectification par
remplacement de période). Allemagne : § 14 Abs. 2 S. 3 UStG, les deux parties établies. Italie :
art. 1 c. 3-bis, bascule sur transmission de données.

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

---

## 3. La divergence transverse de la phase 2

**`GAPLESS_SELF` n'est juridiquement exact qu'en France.**

| Pays | Règle réelle | Verdict |
| --- | --- | --- |
| France | « séquence chronologique **et continue** » (242 nonies A, 7°) | exact |
| Allemagne | « **einmalig** vergeben » ; BMF : « eine lückenlose Abfolge … **ist nicht zwingend** » | **faux** |
| Pologne | « kolejny numer … w ramach jednej lub więcej serii » ; seule l'**unicité** est contrôlée | sur-contrainte |
| Italie | « numero progressivo che la identifichi in modo **univoco** » ; Ris. 1/E 2013 | **faux** |

Le produit impose donc une séquence sans trou que trois de ses quatre marchés vérifiés n'exigent
pas — pendant que F-002 démontre qu'il ne la tient pas là où elle compte.

Deux autres constantes : **l'e-mail n'est un canal licite ni en France, ni en Pologne, ni en
Italie** dans le champ du mandat domestique, alors que les trois profils le déclarent ; et **aucun
profil ne modélise de contrainte de localisation des données**, alors que la France (LPF L102 C),
l'Allemagne (§ 14b Abs. 2 UStG, autorisation préalable hors UE sous peine de 2 500 à 250 000 €) et
l'Italie en imposent une.

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
