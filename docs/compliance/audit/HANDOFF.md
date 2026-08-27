# HANDOFF — audit de conformité Invoicerr

**Branche** `audit/compliance-truth` — 4 commits locaux, **rien n'a été poussé**.
**Phases 0 et 1 terminées.** Arrêt volontaire ici, comme convenu.
**Aucune correction, aucun refactor, aucun test supprimé, aucun appel vers un portail.**
`git diff HEAD -- backend frontend documentation e2e` est vide : aucun fichier produit n'a été touché.

---

## 1. Les quatre findings `critical`, en tête

### F-001 — Un document de zéro octet traverse tout le pipeline et est archivé

Un cycle complet pour le Brésil produit **0 octet**, passe la validation, est signé, et est archivé
avec un reçu portant une rétention de 10 ans et un hash. Trois mécanismes s'additionnent : les 42
builders de `national-formats.ts` renvoient `new Uint8Array()` ; `providers.ts:145` court-circuite la
validation quand il n'y a pas d'octets ; la garde bloquante de l'exécuteur devient donc inatteignable.
Sonde mécanique : **54 syntaxes sur 54 déclarent `valid: true` pour un document vide. Aucune ne le
rejette.**

Reproduction : `npx tsx ../scripts/audit/repro/f001-empty-archive.ts`

### F-002 — La séquence « sans trou » perd des numéros sous concurrence

Le SQL d'allocation est correct (upsert atomique) et huit brouillons distincts en parallèle donnent
bien `[1..8]`. Mais `invoices.service.ts:447` évalue la garde `number !== null` **hors transaction**.
Huit émissions concurrentes de la même facture consomment 8 valeurs et en perdent 7 : série finale
`[1..8, 16]`, **numéros 9 à 15 manquants**. Déclencheur : un double-clic ou un rejeu HTTP.

Reproduction : `npx dotenv -e .env.test -- npx tsx ../scripts/audit/repro/f007-numbering-concurrency.ts`

### F-003 — Une facture émise et acquittée est supprimable, sans aucune garde en base

`prisma.invoice.deleteMany` supprime définitivement une facture `SENT` numérotée dont le document de
conformité est `CLEARED`, sans erreur. Le dossier de conformité survit mais **orphelin**
(`invoiceId = null`). Vérifié en base : **0 trigger, 0 contrainte CHECK**. La protection n'existe que
dans `deleteInvoice()`, et `danger.service.ts:64` la contourne déjà.

### F-004 — 106 pages publiques de conformité pour 5 canaux réellement câblés

| Publié | Réel |
| --- | --- |
| 106 pages `/compliance/<cc>` dans un navigateur à facettes | 5 providers sur 62 ont un transport atteignable |
| 54 syntaxes déclarées | 5 syntaxes rejettent un document invalide |
| 66 pays `status: mandatory` | 0 preuve de transmission acquittée dans le dépôt |

Nuance en faveur du dépôt : la prose des fiches est **prescriptive** (15 « Invoicerr must ») et non
assertive (7 tournures de capacité au présent, sur 6 pays). **C'est la structure qui promet, pas le
texte.**

---

## 2. Deux hypothèses de départ que l'audit a corrigées

Consigné parce qu'un audit qui ne dit que ce qu'on attendait ne sert à rien.

1. **Les archives à hash vide ne sont pas des archives de production.** Les répertoires
   `backend/.compliance-archive/{EU,MX,SA,BR}/e3b0c44…/` sont produits par
   `archive-registry.spec.ts:17-30`, qui appelle `store([], …)` sans définir
   `COMPLIANCE_ARCHIVE_DIR` ; Jest tombe alors sur `<cwd>/.compliance-archive`. Le répertoire est
   gitignoré et non suivi. C'est **F-014**, `medium`.
   Le vrai défaut derrière l'observation est ailleurs, et il est réel : F-010 (le reçu d'archivage
   ment) et F-001 (le pipeline archive du vide).

2. **`resetApp()` ne peut pas supprimer de factures aujourd'hui** — mais pas parce qu'on l'en
   empêche. Sa première instruction, `company.deleteMany`, est bloquée par
   `Invoice_companyId_fkey ON DELETE RESTRICT` dès qu'une facture existe, donc la méthode lève avant
   d'atteindre son `invoice.deleteMany` sans filtre (ligne 64). C'est un **accident
   d'ordonnancement**, pas une garde : inverser deux lignes, ou passer cette FK en `CASCADE`,
   transforme silencieusement l'appel en suppression massive de documents émis.

---

## 3. Ce qui est fait

| Livrable | État |
| --- | --- |
| `scripts/audit/inventory.ts` | script d'inventaire, jetable, hors build |
| `00-INVENTORY.md` | matrice de divergence, 4 catégories + 1b |
| `inventory.json` | faits bruts machine-lisibles |
| `02-FINDINGS.md` | 16 findings, F-001…F-016, sévérité + repro + impact |
| `compliance-truth.json` | amorce, 106 pays |
| `scripts/audit/repro/` | 3 reproductions exécutables |
| `evidence/` | sorties capturées des 3 reproductions |

**Méthode.** L'inventaire **charge et exécute les registres réels** (`defaultTransmissionRegistry`,
`defaultFormatRegistry`, `ALL_PROFILES`) plutôt que de gratter le source : les identifiants,
maturités et résolutions de canaux viennent du code qui tourne en production, pas d'une doc. Deux
sondes portent l'essentiel du signal :

- **Transport réellement câblé.** Le registre de production ne passe que `credentials`, jamais de port
  HTTP (`registry.ts:70-88`). Un provider sans site d'appel réseau dans son voisinage source à deux
  sauts ne peut donc rien émettre. **57 sur 62 sont dans ce cas.**
- **Validation de format.** Chaque syntaxe demandée par un profil reçoit `<garbage/>` puis zéro
  octet. La première sonde porte une réserve Schematron explicite (une règle hors contexte ne lève
  rien) ; la seconde n'en porte aucune.

Trois faux signaux ont été détectés et corrigés en cours de route, plutôt que publiés : la détection
« mentionne `HttpPort` » (tous les portails en mentionnent, c'est la couture) ; la contamination du
voisinage source par le fichier agrégateur `national-portals.ts` (qui créditait `zatca` des appels de
ChorusPro) ; et la lecture des seuls `providerId` explicites, qui rapportait « aucun provider » pour
tous les pays Peppol.

---

## 4. Ce que j'attends de toi

### Décision 1 — Périmètre de la remédiation de F-004 (la promesse publique)

C'est le finding le plus lourd et le seul qui ne se corrige pas dans le code. Trois options, par
coût croissant :

- **a)** Un bandeau de statut honnête par page, dérivé de `compliance-truth.json`.
- **b)** Ne publier que les pays au-dessus d'un seuil, et déplacer les autres dans une section
  « spécifications étudiées » explicitement distincte du support produit.
- **c)** Refondre le navigateur pour qu'il affiche la capacité réelle par colonne (format /
  transmission / réception), toujours dérivée du même fichier.

**Ma recommandation : (b) puis (a).** (b) supprime la promesse structurelle, qui est le vrai
problème ; (a) est ensuite peu coûteux. (c) est le bon état final mais n'est pas urgent.
Dans les trois cas la proposition de dérivation Docusaurus reste **non implémentée** tant que tu ne
l'as pas validée, comme demandé.

### Décision 2 — `IMPLEMENTED` doit-il rester visible en production ? (F-009)

Aujourd'hui `channel-connect-prompt.tsx:73` traite `IMPLEMENTED` comme équivalent à `PROVEN` et
invite l'utilisateur à connecter un canal pour 16 pays où rien ne peut partir. Deux lectures
défendables :

- **Fermer** : traiter `IMPLEMENTED` comme `STUB` côté UI jusqu'à preuve live. Honnête, mais rend
  invisible du travail réel et bloque la collecte de credentials qui permettrait justement de prouver.
- **Avertir** : garder le prompt en le marquant explicitement « non éprouvé — aucune transmission
  réelle n'a jamais abouti ».

Je penche pour **avertir**, parce que fermer supprime le seul chemin par lequel un utilisateur
pourrait fournir les credentials qui débloqueraient une preuve L4. Mais c'est un arbitrage produit,
pas technique : c'est ton appel.

### Décision 3 — Faut-il un socle de garanties en base avant la phase 2 ?

F-002, F-003 et F-005 partagent une racine : **toutes les garanties sont applicatives**. Zéro
trigger, zéro contrainte CHECK, journal `UPDATE`/`DELETE`-able, hash chaîné mais jamais vérifié —
et qui porte sur le `ctx`, pas sur les octets émis. La phase 2 va documenter des règles qui, toutes,
supposent ce socle. Le construire d'abord ou continuer l'audit d'abord ?

Mon avis : **continuer l'audit**. Un socle conçu avant de connaître les règles se refera. Mais
F-002 (perte de numéros) est indépendant du reste et se corrige en déplaçant une garde dans la
transaction — c'est petit, isolé, et je le traiterais séparément sans attendre.

### Décision 4 — Une info que je ne peux pas obtenir

Existe-t-il, hors dépôt, une preuve datée d'un run live réussi (UPO KSeF, accusé PDP superpdp) ? La
mémoire projet en affirme (KSeF 2026-06-28, PDP 2026-06-28), **le dépôt n'en contient aucune trace
machine-lisible** (F-013). Si ces artefacts existent quelque part, les verser dans
`evidence/` ferait passer `ksef` et `pdp` en L4 immédiatement. Sinon je les laisse à L2.

---

## 5. Ce que je ferais ensuite

1. **Phase 2 sur 6 pays seulement, pas 106.** FR, PL, IT, DE, ES, MX — ceux où le code prétend le
   plus (profils bespoke, `confidence: OFFICIAL`, schémas d'autorité vendorisés). Un sous-agent par
   pays avec le même questionnaire, `compliance-truth.json` en écriture exclusive par moi.
   Les 100 autres n'ont pas d'implémentation à confronter à une règle : les sourcer serait un
   travail de documentation, pas d'audit.
2. **Phase 3 en parallèle**, parce qu'elle conditionne le plafond de tout le reste : un portail sans
   sandbox accessible ne dépassera jamais L2, quelle que soit la qualité du code. C'est aussi ce qui
   tranche la décision 2.
3. **`01-CLAIM-AUDIT.md`**, non écrit à ce stade : F-004 en contient la substance, mais la
   comparaison page par page reste à faire une fois le seuil de la décision 1 fixé.
4. **Reprendre trois angles laissés ouverts** : le modèle `Log` applicatif (non audité — seul
   `ComplianceEvent` l'a été) ; ce que le chaînage de hash *devrait* couvrir ; et l'audit des
   régimes `POST_AUDIT` que la phase 1 n'a pas visités.

---

## 6. Comment tout rejouer

```bash
git checkout audit/compliance-truth
cd backend

npx tsx ../scripts/audit/inventory.ts     # → 00-INVENTORY.md + inventory.json
npx tsx ../scripts/audit/seed-truth.ts    # → compliance-truth.json

COMPLIANCE_ARCHIVE_DIR=/tmp/audit npx tsx ../scripts/audit/repro/f001-empty-archive.ts
npx dotenv -e .env.test -- npx tsx ../scripts/audit/repro/f004-delete-issued-invoice.ts
npx dotenv -e .env.test -- npx tsx ../scripts/audit/repro/f007-numbering-concurrency.ts
```

`f004` tourne dans des transactions systématiquement annulées. `f007` doit committer pour pouvoir se
concurrencer : il crée sa propre société marquée `AUDIT-CONCURRENCY-<pid>` et la supprime en
`finally`. Aucun des deux ne touche une ligne préexistante. Base cible : `.env.test`, Postgres :5433.

---

## 7. Rien n'a bloqué

Aucun point des sept n'a été abandonné, aucune devinette n'a été nécessaire. La base de test était
disponible, ce qui a permis de prouver F-002, F-003 et F-005 en base plutôt que par lecture de code.
Les seules zones laissées vides le sont **par construction** — sources primaires (phase 2), sandboxes
(phase 3), faisabilité (phase 4) — et sont marquées `null` + `open_question` dans
`compliance-truth.json`, jamais remplies par une valeur plausible.
