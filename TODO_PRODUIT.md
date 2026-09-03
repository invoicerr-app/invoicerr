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

> ✅ **FAIT** (2026-09-03) — émission à l'écriture « sent » acquise (INVOICE_SENT + QUOTE_SENT
> jamais câblé avant), idempotence structurelle prouvée (409 sur rejeu), WebhooksModule résoluble
> dans le worker (boot réel ROLE=worker), correctif défensif formatters (client optionnel), spec
> e2e 42 par l'écran avec receveur HTTP réel. Validé : jest 1887, 3 mutations mordantes, batterie
> 233 verts. SUPPLANTÉ PARTIELLEMENT par T2bis (générique seul) — l'émission par-type vit jusqu'au
> commit T2bis.

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

## T2bis — Webhooks génériques `DOCUMENT_*` (décision mandant, 2026-09-03)

> ✅ **FAIT** (2026-09-03) — 5 événements génériques (CREATED/SENT/SEND_FAILED/AUTHORITY_EVENT/
> DELETED — CREATED/DELETED faits, le point CRUD était trivial), 51 valeurs mortes purgées avec
> nettoyage des abonnements prouvé sur les DEUX bases, contrat de payload à clé `document` fixe,
> l'avoir gagne le webhook. Bonus : bug T1 corrigé (eventsPublisher du ReportingRunner jamais câblé
> en prod — factory manuelle). Validé : jest 1906, 3 mutations mordantes, batterie 233 verts.

> ✅ **FAIT** (2026-09-03) — 51 valeurs purgées de `WebhookEvent` (QUOTE_* 12, INVOICE_* 12,
> PAYMENT_* document 7, RECEIPT_* 7, PAYMENT_METHOD_*+PAYMENT_RECEIVED 6, SIGNATURE_* 7 —
> AUCUNE n'avait d'émetteur réel, prouvé par grep valeur par valeur ; INVOICE_SENT/QUOTE_SENT
> étaient les deux seules exceptions, purgées avec elles puisque leur unique émetteur devient
> générique), 5 ajoutées (`DOCUMENT_CREATED`, `DOCUMENT_SENT`, `DOCUMENT_SEND_FAILED`,
> `DOCUMENT_AUTHORITY_EVENT`, `DOCUMENT_DELETED`). Migration `20260903000000_generic_document_
> webhook_events` testée avec un abonnement PRÉEXISTANT réel sur les DEUX bases (`invoicerr_dev`
> via `migrate dev`, `invoicerr_db` via `migrate deploy`) : les valeurs purgées disparaissent du
> tableau `events`, les valeurs gardées restent. Émissions câblées : `async-send.ts`
> (`DOCUMENT_SENT`), `mark-send-failed.ts` (`DOCUMENT_SEND_FAILED`), `conformity-sweep-runner.ts`/
> `reporting-runner.ts`/`sdi-notifiche.service.ts` (`DOCUMENT_AUTHORITY_EVENT`, providerId +
> statusCode), `generic-actions.ts` (`DOCUMENT_CREATED`/`DOCUMENT_DELETED`, gratuits pour
> quote/invoice/credit-note/expense/received-invoice via `registerSaveDraftAction`/
> `registerDeleteAction`) — l'avoir (crédit note) gagne `DOCUMENT_SENT`/`DOCUMENT_CREATED` au
> passage, le seul type T2 avait délibérément laissé sans webhook. Bug trouvé en cours de route
> (pas introduit ici) : `ReportingRunner`'s `eventsPublisher` n'était JAMAIS réellement câblé en
> production — la factory manuelle de `documents-core.module.ts` construisait la classe avec
> `new ReportingRunner(registry, typeRegistry)`, deux arguments seulement, ce que T1 n'avait
> jamais remarqué faute d'un test qui boote le vrai graphe Nest ; corrigé au passage avec l'ajout
> du webhook. Un token Nest dédié (`DOCUMENT_WEBHOOK_EMITTER`, `queue/document-webhooks.ts`)
> évite que `WebhookDispatcherService` (import concret) ne traîne `@teever/ez-hook` (pure ESM,
> inimportable sous ts-jest) dans les specs des trois nouveaux consommateurs. Preuves : jest 1906
> verts (0 échec, 22 suites gated skip inchangé) ; biome 0 erreur ; builds réels des deux côtés ;
> boot worker réel (`ROLE=worker`, health :3001) après le câblage final par token ; spec e2e 42
> adaptée (DOCUMENT_SENT, clé `document` fixe) + 28 en régression, 3/3 verts en Firefox ; UNE
> mutation rejouée par le mandataire et mordante (dispatch supprimé dans `async-send.ts` → la
> spec 42 tombe avec `expected [] to have a length of 1 but got 0` ; watchers backend zombies de
> sessions précédentes tués par PID explicite en cours de route — un seul `nest start --watch`
> reste après nettoyage).
>
> Décision (AskUserQuestion) : « Générique seul, purger le par-type » — puis validation du
> vocabulaire complet. Principe : un événement = un FAIT acquis en Postgres, jamais une
> intention ; chaque événement pointe un point d'écriture qui EXISTE déjà.

**Le trio livré par cette tâche** (points d'écriture déjà construits par T1/T2) :
- `DOCUMENT_SENT` — la transmission a abouti (`async-send.ts` phase 2, remplace l'émission
  INVOICE_SENT/QUOTE_SENT câblée par T2) ;
- `DOCUMENT_SEND_FAILED` — échec terminal après retries (`mark-send-failed.ts`, le point T1) ;
- `DOCUMENT_AUTHORITY_EVENT` — l'autorité a parlé (les points `journaled > 0` de T1 :
  conformity-sweep-runner, reporting-runner, sdi-notifiche ; payload : providerId, statusCode).
Plus `DOCUMENT_CREATED`/`DOCUMENT_DELETED` SI le point d'écriture CRUD est unique et trivial
dans `DocumentsService` — sinon consigner, jamais forcer.

**Contrat de payload uniforme** : `{ event, typeId, documentId, companyId, occurredAt,
document: {…la ligne…}, …faits propres }` — clé `document` FIXE (plus la clé calculée
`[typeId]` de T2), `typeId` en donnée de filtrage. Un futur type obtient tous les événements
sans migration.

**La purge** : les familles document jamais émises (QUOTE_*, INVOICE_*, PAYMENT_*-document,
RECEIPT_*) sortent de l'enum `WebhookEvent` (migration Prisma) avec nettoyage des lignes
d'abonnement existantes qui les référencent — l'écran cesse d'offrir des options mortes.
CLIENT_*/COMPANY_* restent (émetteurs réels : clients.service, company.service).
SIGNATURE_*/PAYMENT_METHOD_*/INVOICE_PAID etc. : tranché PAR GREP — on ne purge que ce qui
n'a prouvablement AUCUN émetteur ; ce qui en a un reste, consigné.

**Écarté, avec le pourquoi (ne pas rouvrir sans décision)** : DOCUMENT_SENDING (bruit — le SSE
couvre l'UI) ; DOCUMENT_STATUS_CHANGED fourre-tout (pousse à parser des statuts au lieu de
faits) ; *_SEARCHED/*_PDF_GENERATED (télémétrie, jamais émis).

**Différé, porté par les tâches où vit leur point d'écriture** : `DOCUMENT_SETTLED` → T3
(compute-settlement au moment où un paiement s'applique) ; `DOCUMENT_RECEIVED` → T5
(reception/) ; `DOCUMENT_SIGNED` → consigné TODO_ISSUES (module signature, plus tard).

**Accepte si** : le stub HTTP réel (le harnais de T2, `async-send-webhook.spec.ts` + spec e2e
42 adaptés) reçoit DOCUMENT_SENT une seule fois sur succès, DOCUMENT_SEND_FAILED une seule
fois sur échec terminal, DOCUMENT_AUTHORITY_EVENT sur un événement d'autorité journalisé ;
zéro à l'enqueue ; l'écran n'offre plus une seule option morte ; la migration passe sur les
DEUX bases (dev + test) avec des abonnements préexistants référençant un événement purgé.

## T3 — Paiements et avoirs convertissent les devises

> ✅ **FAIT** (2026-09-03) — taux PAR OPÉRATION daté à paidAt, épinglé sur la ligne (la voie
> que le POURQUOI consigné prescrivait) ; refus nommé sans taux ; avoirs : pas de conversion —
> structurellement en devise facture (constat consigné) ; DOCUMENT_SETTLED sur les 2 chemins de
> franchissement. Validé : jest 1937, 3 mutations mordantes (2 trous de couverture colmatés en
> validation : tripwire mapping + pin d'arrondi half-up), batterie au verdict.

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
**T2bis différé** : émettre `DOCUMENT_SETTLED` (contrat de payload de T2bis) au moment où le
règlement atteint « soldé » — le point d'écriture est exactement le code que cette tâche touche.

## T4 — Les trous d'écran consignés

> ✅ **FAIT** (2026-09-03) — (a) 7 EAS ajoutés + (b) 0106 corrigé NL KVK / 0184 DK CVR ajouté
> (re-vérifiés en direct sur la codeliste v9.7, doublon du sélecteur dans company.settings corrigé
> aussi) ; (c) le residual était réel : save-draft rétrogradait une facture sent sans re-résolution
> (FR protégée par sa policy, US non) — le save-draft de l'invoice réutilise désormais le préflight
> fiscal du send quand currentStatus ≠ draft ; (d) devise d'avoir verrouillée sur sa facture, aux
> DEUX points (save-draft + preflight send — contournement scripté découvert et fermé), écran
> pré-rempli/verrouillé via lockedFromReference. Validé : jest 1946, 3 mutations mordantes,
> batterie au verdict.

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

> (a) ✅ **FAIT** (2026-09-03) — lignes BG-25 extraites du CII (IncludedSupplyChainTradeLineItem)
> et de l'UBL (InvoiceLine) par le lecteur existant étendu, chemins vérifiés contre du XML généré
> par nos propres providers ; machinerie de champ `array` des types sortants réutilisée (stockage
> JSON, zéro migration) ; taux fournisseur hors catalogue société (déviation documentée) ;
> total-vs-somme : avertissement nommé persisté (data.lineTotalWarnings), tolérance max(1, n)
> centimes, jamais bloquant. jest 1960, mutations mordantes (ancre CII, persistance, tolérance).
> (b) ✅ **FAIT** (2026-09-03) — Client + rôle supplier (décision mandant) réalisé comme un booléen
> SÉPARÉ `isSupplier` (jamais une extension de `kind` : B2G routing et "est fournisseur" sont deux
> faits orthogonaux — un gouvernement peut être fournisseur, un fournisseur peut aussi être facturé).
> Extraction étendue : `supplierVatId` lu au même niveau que `supplier` (CII
> `SpecifiedTaxRegistration/ID` schemeID="VA" · UBL `PartyTaxScheme/CompanyID`, scopé pour ne jamais
> lire le SIRET voisin). Auto-rapprochement AU DÉPÔT (`supplier-reconciliation.ts`) : TVA d'abord
> (normalisée espaces/casse), nom EXACT en repli si zéro match VAT, ambiguïté nommée et JAMAIS
> résolue en silence (ni par repli sur le nom), aucune création de Client. Champ dédié
> `supplierClient` (reference, entité "supplier" — distincte de "client", qui exclut désormais les
> fournisseurs purs de son propre picker facturable). Rôle posé au lien (auto ou manuel) dans
> l'action "receive", jamais défait. Migration `20260903120000_add_client_is_supplier` (additive,
> défaut `false`) sur les DEUX bases. jest 1989 (+29 sur ce sous-chantier, dont 18 réels contre
> Postgres pour le rapprochement), 1 mutation mordante rejouée (scoping companyId retiré →
> `supplier-reconciliation.spec.ts` vire au rouge, un client d'une autre société se rapproche à
> tort). Cypress 36 (11/11, dont 3 nouveaux) + 05 (29/29, dont 3 nouveaux), Firefox. (c) OCR :
> DÉCISION PRISE — service cloud VIA LE SYSTÈME DE PLUGINS (le point d'extension au cœur, le
> provider en plugin) ; choix du provider cloud à poser au lancement de (c).

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
**T2bis différé** : émettre `DOCUMENT_RECEIVED` (contrat de payload de T2bis) au dépôt d'une
facture entrante — le point d'écriture est exactement le code que cette tâche touche.

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
