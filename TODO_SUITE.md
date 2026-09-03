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

Le endpoint git-clone (POST /api/plugins), son écran, IPlugin={id,name} et les consommateurs
stubs (canGenerateXml/generateXml) partent — la voie d'extensibilité est l'interface au cœur
(T5c). Établir par grep tout ce qui référence le mécanisme (backend, front, doc
developer-guide/plugin-system.md — la doc DOIT suivre), migration si des lignes Plugin
externes existent en base (établir le schéma), consigner dans TODO_ISSUES ce que le retrait
ferme. Les plugins IN-APP (PluginRegistry/PluginType, l'écran de config) RESTENT.
**Accepte si** : plus aucun chemin de chargement de code tiers ; la doc à jour ; jest/e2e
verts sans affaiblissement ; un test prouve que l'écran plugins in-app survit.

## P3 — Purge élargie de l'enum WebhookEvent (~60 valeurs mortes)

La mécanique T2bis exactement : grep par valeur (émetteur réel = garde), migration qui
NETTOIE les abonnements avant le rebuild du type (horodatage POSTÉRIEUR à 20260903180000 —
la leçon de la mine), les DEUX bases + generate + preuve sur base fraîche jetable (le
déploiement intégral depuis zéro reste vert), formatters/styles morts supprimés, l'écran
suit tout seul (Object.values).
**Accepte si** : chaque valeur gardée a sa preuve grep ; base fraîche re-prouvée ; batterie.

## Clôture

Marquer ici, barrer les entrées TODO_ISSUES correspondantes, mémoire, appli + identifiants.
