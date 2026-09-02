# TODO_PRODUIT — les trous produit de l'appli (vague « point 2 », 2026-09-02)

> Périmètre décidé avec le mandant : les six chantiers listés comme « vrais trous produit dans
> l'appli elle-même » — SSE des statuts, webhook `INVOICE_SENT`, devises des paiements/avoirs,
> trous d'écran, réception enrichie, parcours frontend testés. Les canaux gatés par credentials
> (démarches externes) et la profondeur conformité (CIUS, triplets, refactor LEGAL-DOCUMENTS)
> sont HORS de ce bord — voir `TODO_ISSUES.md` et `B2G_COVERAGE.md`.
>
> **Discipline (identique aux vagues précédentes)** : une tâche à la fois, via sub-agent Sonnet
> briefé au maximum ; validation par le mandataire (moi) = tests unitaires ET e2e présents,
> mutations rejouées par moi avec le lieu de morsure vérifié, jest complet + batterie Cypress
> complète (Firefox, `--config trashAssetsBeforeRuns=false`) verts avant CHAQUE commit ; builds
> réels (`npm run build`/`tsc -b`, jamais `tsc --noEmit`) ; biome ; `npm run i18n:check` si le
> front est touché ; jamais `git add -A` ; jamais `git checkout` sur un fichier modifié ; aucune
> dépendance npm nouvelle sans la signaler AVANT ; jamais une assertion affaiblie ; tout reste
> honnêtement consigné dans `TODO_ISSUES.md`. Questions au mandant : uniquement AskUserQuestion.

## État des lieux déjà établi (à donner aux agents, ne pas redécouvrir)

- `frontend/src/hooks/use-fetch.ts:139` — un hook `useSse` existe déjà, AUCUN consommateur.
- `backend/src/modules/logger/logger.controller.ts:22` — un endpoint `@Sse()` existe déjà (le
  streaming du logger) : le patron NestJS à copier, y compris son auth.
- `frontend/src/hooks/queries/use-document-types.ts:111,183` — un polling `refetchInterval`
  couvre DÉJÀ le statut « sending » ; R8 (`docs/compliance/PLAN-V2.md:372`) parle du reste :
  les panneaux de conformité figés, et le coût/latence du polling. Lire l'existant AVANT de
  décider ce que le SSE remplace et ce qu'il garde en repli.
- `backend/src/modules/webhooks/` — le système de webhooks existe, `WebhookEvent.INVOICE_SENT`
  a ses formatters (`drivers/event-formatters.ts:28,326`) mais RIEN dans `modules/documents/`
  ne l'émet (R9, `PLAN-V2.md:387`).
- Les événements de statut naissent dans le WORKER BullMQ (`queue/processors/`), pas dans le
  process API — un pont worker→API est nécessaire pour le SSE (Redis pub/sub est le candidat
  naturel : Redis est déjà requis au boot, aucune dépendance nouvelle).
- Runner frontend Vitest : en place depuis P4-T01 (`c9273b0f`), 12 tests, en CI.

---

## T1 — SSE : le statut bouge à l'écran sans rechargement (R8)

> ✅ **FAIT** (2026-09-02) — six points de publication (sending/sent/send_failed + autorité
> via sweep/reporting/SdI), pont Redis pub/sub, endpoint `@Sse('events')`, hook front monté dans
> le layout, polling rétrogradé en repli 60s. Validé : jest 1876, vitest 46/46, pont Redis réel
> 3/3, 3 mutations mordantes, batterie 232 verts.

Un flux SSE authentifié (cookie better-auth, scoping `@ActiveCompany` — un tenant ne voit JAMAIS
les événements d'un autre), alimenté depuis le journal/projection existants via un pont
worker→API (Redis pub/sub), consommé par le `useSse` existant ; à réception, invalider les
requêtes TanStack concernées (jamais de double source de vérité : l'événement déclenche un
refetch, il ne PORTE pas l'état).

**Accepte si** (les critères de R8, verbatim) : une transmission qui se stabilise en échec fait
passer l'écran de « en attente » à « échec » **sans rechargement**, et le bouton *Retry*
apparaît de lui-même. En plus : les panneaux de conformité (événements d'autorité) se
rafraîchissent de même ; le polling `refetchInterval` existant est soit retiré soit
explicitement conservé en repli (décision écrite dans le code, pas par accident) ; multi-tenant
prouvé par un test (deux sociétés, l'événement de l'une n'atteint jamais l'autre).
**Tests** : jest (publication côté worker, pont, endpoint), Vitest (le hook/l'écran réagit à un
événement injecté), e2e (le spec async-send étendu : badge qui change SANS `cy.reload()`).
**Piège** : `WORKER_INLINE=false` (workers dédiés, `docker-compose.scale.yml`) doit marcher —
c'est précisément pour ça que le pont passe par Redis, jamais par l'in-process.

## T2 — Webhook `INVOICE_SENT` émis quand la transmission ABOUTIT (R9)

Émis depuis l'écriture « sent » réelle (le même point d'accroche que l'archive et le reporting —
lire `actions/async-send.ts` et `reporting/report-on-send.ts`'s own header : « après le fait
acquis, jamais avant »), JAMAIS à l'enqueue, JAMAIS sur un échec. Exactement une émission par
document même à travers les retries BullMQ (idempotence à prouver). Symétrique : décider (et
consigner) si un `INVOICE_SEND_FAILED` existe déjà dans `WebhookEvent` et doit partir sur
l'échec terminal — s'il n'existe pas, le proposer au mandant via AskUserQuestion plutôt que
l'inventer.
**Accepte si** : un stub HTTP local (vrai serveur, pas un mock du client) reçoit exactement UN
webhook sur un envoi réussi ; zéro sur un échec ; zéro à l'enqueue ; le payload passe par les
formatters existants.
**Tests** : jest sur le point d'émission + idempotence ; e2e si un écran webhook existe (sinon
consigner que la preuve reste jest).

## T3 — Paiements et avoirs convertissent les devises

Les taux existent déjà (voir l'entrée consignée dans `TODO_ISSUES.md` : « Les taux existent,
mais paiements et avoirs ne convertissent toujours pas » — lire son POURQUOI consigné avant de
coder : le choix d'alors peut porter une contrainte). Un paiement dans une devise ≠ celle du
document se convertit au taux daté ; le règlement/la consolidation multi-devises (spec e2e 27)
restent justes ; un avoir suit la même règle que sa facture.
**Accepte si** : le reste-à-payer d'une facture EUR payée en USD est correct au taux daté,
épinglé par un test au montant exact ; la consolidation ne double-convertit jamais.
**Piège daté** : le bug UTC de frontière de mois déjà corrigé ailleurs (getters UTC, jamais
locaux) — les tests de conversion se PINNENT sur des dates limites.
**Tests** : jest (conversion, taux daté, arrondi), e2e (parcours paiement multi-devise par
l'écran, assertions par l'API — spec 24/25/27 étendues).

## T4 — Les trous d'écran consignés

(a) Le sélecteur de schéma Peppol (`client-upsert.tsx`, `peppolSchemeId`) offre les EAS des pays
couverts par l'audit B2G : 0191 EE, 0200 LT, 0218 LV, 0240 LU, 9928 CY, 9933 GR, 9943 MT —
libellés LUS dans la codeliste Peppol v9.7 (comme 0204/0208 avant eux), jamais inventés.
(b) L'étiquette préexistante fausse : `0106` n'est PAS « DK CVR » (c'est le KVK néerlandais dans
la codeliste) ; le vrai CVR danois est `0184`. Corriger l'étiquette 0106 ET ajouter 0184 — en
vérifiant qu'aucune spec e2e ne s'appuie sur l'étiquette actuelle.
(c) Le résidu `editInvoice` (voir la mémoire VAT unknown-country, f6888eb2) : l'édition d'une
facture peut changer le pays acheteur sans re-résolution — appliquer la même règle qu'à
l'émission (recompute + blocage dur si irrésolu).
**Accepte si** : chaque libellé EAS est cité de la codeliste dans le commit ; i18n:check vert ;
un test e2e prouve (c) par l'écran (éditer → pays inconnu → refus nommé).

## T5 — Réception enrichie (factures fournisseurs)

Trois sous-chantiers, DANS CET ORDRE, chacun sa tâche :
(a) **Lignes détaillées** : le document reçu porte ses lignes (désignation, quantité, HT, taux,
TTC), saisies à l'écran ET extraites automatiquement quand le dépôt est un format structuré
qu'on sait déjà lire (`reception/` lit du CII/UBL — les lignes y sont, elles sont juste
ignorées aujourd'hui). Le total contrôle la somme des lignes (écart = avertissement nommé,
jamais silencieux).
(b) **Rapprochement fournisseur** : relier une facture reçue à un fournisseur persistant
(réutiliser `Client` avec un rôle, ou une entité dédiée — DÉCISION à faire trancher par
AskUserQuestion avec les deux options argumentées AVANT d'implémenter) ; auto-rapprochement par
identifiant (TVA/SIREN) quand le document structuré le porte.
(c) **OCR des PDF non structurés** : NE PAS implémenter sans décision — toute solution passe par
une dépendance nouvelle (tesseract, service externe…) : présenter les options au mandant via
AskUserQuestion (coût, on-premise vs cloud, langues) et n'implémenter que ce qui est choisi.
Si la réponse est « plus tard », consigner dans TODO_ISSUES.md et clore.
**Accepte si** : (a) un XML CII/UBL déposé montre ses lignes sans ressaisie, épinglées par un
test sur un fichier réel ; (b) deux dépôts du même fournisseur se rapprochent tout seuls ;
chaque sous-chantier a son e2e piloté par l'écran.

## T6 — Parcours frontend testés (P4-T02)

La couverture des PARCOURS de conformité au runner Vitest (pas la couverture de lignes) :
émission, rejet (autorité), correction, avoir, annulation — un parcours par test NOMMÉ, chacun
échoue si l'écran cesse de montrer l'état. S'appuie sur T1 (les écrans réagissent aux
événements). Le critère de P4-T01 reste la règle : rouge-puis-vert vérifié en cassant le CODE
DE PRODUCTION, jamais une assertion.
**Accepte si** : cinq parcours nommés, chacun prouvé mordant par une mutation du code de
production ; en CI dans le job existant.

---

## Clôture du bord

Quand tout est fait (ou consigné) : marquer R8/R9 dans `docs/compliance/PLAN-V2.md` (le style
du journal existant), barrer l'entrée devises de `TODO_ISSUES.md` (le style ~~…~~ — RÉSOLU),
mettre à jour la mémoire projet, et livrer l'appli qui tourne avec les identifiants.
