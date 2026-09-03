# TODO_SUITE — les trois décisions du 2026-09-03, dans l'ordre décidé

> Décisions mandant (AskUserQuestion) : P1 policy pays (« Écrire les 5 fichiers sourcés »),
> P2 plugins externes (« Retirer le chargement externe »), P3 purge enum (« Purger maintenant »).
> Ordre : Policy → Plugins → Purge. Discipline identique aux bords précédents (voir
> TODO_PRODUIT.md en tête) ; ⚖ jamais une règle fiscale inventée.

## P1 — country-policy : les 5 fichiers sourcés (DE, IT, PL, ES, MX)

> ✅ **FAIT** (2026-09-03, commit 1d825186) — 110 règles, immutabilité légale restreinte à
> draft dans les 5, send sourcé sauf MX (unverified honnête, sources injoignables documentées),
> seed prouvé deux bases, spec 44 (une société PL ÉMET + 409 immutabilité), spec 17 ré-ancrée
> sur JP (sa prémisse « DE sans règle » rendue fausse par le chantier — attrapée par la
> batterie). jest 2125, 3 mutations mordantes, batterie 257 verts.

État vérifié : `country-policy/data/` n'a que fr/hu/us (fr.json ≈ 19k chars : une règle par
(typeId, actionId) × 5 types, `allowed` + provenance légale citée OU unverified honnête — les
actes internes au produit, comme enregistrer un brouillon de devis, sont unverified
allowed:true chez FR). Un pays sans fichier est BLOQUÉ sur toute action (découverte C3) — PL
et IT sont les marchés primaires. Les règles sont SEMÉES en base (seed.ts ; piège consigné :
resetAndSeed ne re-sème PAS la policy). Le lourd légal par pays : l'immutabilité du document
émis (save-draft sur facture émise — PL : KSeF, IT : SdI, DE : GoBD, ES/MX : à lire), le send
(force probante/exigences d'émission), l'avoir. Les citations DÉJÀ lues par correction-routes/
et channel-policy/ (Podręcznik KSeF, scarto SdI, BOI…) sont RÉUTILISABLES là où elles tranchent
exactement le même fait — en les citant, jamais en les étirant.
**Accepte si** : les 5 chargent avec le gate existant ; chaque `allowed:false` porte une
citation ; les faits non tranchés restent unverified (avec ce qui les tranchérait) ; seed sur
les DEUX bases ; jest de contenu épinglé (l'immutabilité PL/IT au moins) ; e2e : une société
PL peut ÉMETTRE (le déblocage), et la restriction lue la bloque là où la loi le dit.

## P2 — Retrait du chargement externe des plugins

> ✅ **FAIT** (2026-09-03) — le git-clone (POST /api/plugins), le chargement dynamique, les
> stubs canGenerateXml/generateXml, l'écran d'ajout par URL et les clés i18n mortes retirés
> (grep-zéro vérifié) ; les plugins in-app, l'écran de config, le registre OCR T5c préservés et
> prouvés (boots API+worker réels, routes fantômes 404) ; rien en base (les externes n'étaient
> jamais persistés — aucune migration) ; doc plugin-system réécrite avec l'historique honnête.
> Validation : la mutation « @Get retiré » ne mordait pas (routes non épinglées au niveau HTTP)
> → tripwire par métadonnées de routage Nest, re-prouvé. jest 2135, batterie 259 verts. Reste
> consigné : simple-git à retirer de package.json (hors périmètre, watcher vivant).

> ✅ **FAIT** (2026-09-03) — retirés : `POST/GET/DELETE /api/plugins`, `GET /api/plugins/formats`,
> `PluginsService.cloneRepo`/`loadPluginFromPath`/`loadExistingPlugins`/`loadAllPlugins`/
> `getPlugins`/`deletePlugin`/`canGenerateXml`/`generateXml`/`getFormats`/`getActivePlugin` (mort,
> zéro appelant), `IPlugin`/`InvoicePlugin`/`PdfFormatInfo` (le triplet propre au mécanisme
> externe — DISTINCT de `IPlugin={id,name}` dans `plugins/types.ts`, qui RESTE), l'écran « Add
> Plugin » (URL Git) + la liste des plugins installés côté front, `ENV PLUGIN_DIR` (Dockerfile).
> AUCUNE table Prisma dédiée aux plugins externes (jamais persistés qu'en mémoire + disque) —
> aucune migration nécessaire, confirmé par lecture du schéma (une seule table `Plugin`, entièrement
> in-app). Préservé et testé : `PluginRegistry`/`PluginType`/l'écran de config in-app (toggle,
> configure, validate, webhooks), le flux OCR T5c (82 tests, 9 suites, inchangés). jest 2131 (+6),
> boot API et worker (ROLE=worker, health :3001) réussis avec grep live des 4 routes survivantes +
> 4 routes fantômes confirmées 404, build backend et frontend réels verts, biome + i18n:check
> verts, Cypress (09-settings.cy.ts, Firefox, trashAssetsBeforeRuns=false) 13/13 verts. Mutation
> rejouée : ré-ajout d'un `getFormats` fantôme sur le contrôleur → le test « no ghost route » le
> détecte et échoue comme attendu ; reverti, re-vert confirmé.

Le endpoint git-clone (POST /api/plugins), son écran, IPlugin={id,name} et les consommateurs
stubs (canGenerateXml/generateXml) partent — la voie d'extensibilité est l'interface au cœur
(T5c). Établir par grep tout ce qui référence le mécanisme (backend, front, doc
developer-guide/plugin-system.md — la doc DOIT suivre), migration si des lignes Plugin
externes existent en base (établir le schéma), consigner dans TODO_ISSUES ce que le retrait
ferme. Les plugins IN-APP (PluginRegistry/PluginType, l'écran de config) RESTENT.
**Accepte si** : plus aucun chemin de chargement de code tiers ; la doc à jour ; jest/e2e
verts sans affaiblissement ; un test prouve que l'écran plugins in-app survit.

## P3 — Purge élargie de l'enum WebhookEvent (~60 valeurs mortes)

> ✅ **FAIT** (2026-09-03) — 96 → 17 valeurs (79 purgées, chacune sans émetteur prouvé par
> grep ; 17 gardées avec leur site de dispatch cité), migration 20260903200000 au motif T2bis
> avec SETTLED/CANCELLED inclus (la leçon de la mine en sens inverse), base fraîche prouvée
> depuis zéro (92 migrations, 17 exactement) + les deux vivantes avec abonnements piégés, spec
> d'épinglage de la liste finale. Validation mandataire : re-preuve fraîche indépendante + la
> mutation _new amputé attrapée à 16 ; trou structurel consigné (pas de tripwire automatisé
> migration-vs-schema — à fermer avant le merge main). jest 2138, batterie 259 verts.

La mécanique T2bis exactement : grep par valeur (émetteur réel = garde), migration qui
NETTOIE les abonnements avant le rebuild du type (horodatage POSTÉRIEUR à 20260903180000 —
la leçon de la mine), les DEUX bases + generate + preuve sur base fraîche jetable (le
déploiement intégral depuis zéro reste vert), formatters/styles morts supprimés, l'écran
suit tout seul (Object.values).
**Accepte si** : chaque valeur gardée a sa preuve grep ; base fraîche re-prouvée ; batterie.

## Clôture

> ✅ **BORD CLOS** (2026-09-03) — les trois décisions exécutées dans l'ordre décidé :
> P1 d2fab703 (les 5 pays policy — les marchés primaires émettent), P2 755cd068 (le chargement
> externe de plugins retiré), P3 (dernier commit — l'enum à 17 valeurs vraies). Restes
> consignés TODO_ISSUES : simple-git dans package.json, tripwire migration-vs-schema,
> traductions non-EN de la doc plugins (Weblate).
