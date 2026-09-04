# TODO_LIBRE — le champ libre du 2026-09-04 (mandant absent)

> Cadre donné : « t'as champ libre tant que tu touches pas à dev et main ». Donc : branche
> feat/compliance-engine-v2 uniquement, AUCUN push (la branche est à +100 d'origin — décision
> mandant au retour), aucune question bloquante — uniquement des chantiers autonomes,
> auto-vérifiables, sans décision produit en suspens. Discipline inchangée (voir TODO_PRODUIT.md
> en tête) : agents Sonnet, mutations rejouées par le mandataire, jest complet + batterie avant
> CHAQUE commit.

## L1 — R002 : le vendeur français passe enfin la validation Peppol BIS

> ✅ **FAIT** (2026-09-04) — fusion inconditionnelle en une cbc:Note (le OU de la règle rend
> une note toujours conforme, l'exception DE↔DE n'a jamais besoin d'être évaluée — documenté),
> au postProcessor du provider BIS uniquement (le patron facturx), XRechnung établi non concerné
> (grep KoSIT négatif) ; les 3 textes C. com. verbatim dans la note (taux S2-2026 12,40 % résolu),
> codes sujet #PMT#/#PMD#/#AAB# préservés ; MUTATION TARGET permanent (le Schematron re-échoue
> sans la fusion) ; régressions CII/UBL/FatturaPA (notes séparées inchangées). jest 2149,
> mutations mordantes (fusion tronquée → 2 tests ; postProcessor débranché → R002 re-échoue),
> batterie 259 verts. Limite documentée : un # littéral en tête de note libre (BR-CL-08).

Le trou consigné le plus visible (peppol-bis-provider.ts:28, « A KNOWN, DOCUMENTED
LIMITATION ») : les 3 mentions C. com. obligatoires du vendeur FR émettent 3 cbc:Note ; la
règle PEPPOL-EN16931-R002 n'en tolère qu'une (sauf DE↔DE). Le correctif documenté par le code
lui-même : fusionner les notes en UNE cbc:Note multi-lignes — au niveau du chemin Peppol BIS
(la contrainte est à CE profil, les autres syntaxes gardent leurs 3 notes), avec le contenu
des 3 mentions INTÉGRALEMENT préservé (fusion, jamais troncature — ce sont des mentions
légales). Preuve offline : le Schematron OpenPEPPOL vendoré (le juge réel), vendeur FR ×
acheteur non-DE passe R002 ET porte les 3 textes ; DE↔DE inchangé ; le spec du provider qui
DÉMONTRAIT l'échec est retourné (il prouve désormais le passage — sans affaiblir : l'ancien
test d'échec devient le test du correctif).
**Accepte si** : Schematron vert avec les 3 textes présents dans la note fusionnée ; aucune
régression 31/40/43 ; le commentaire-limitation du provider mis à jour (il ne ment plus).

## L2 — Les 6 fonctions Schematron italiennes (XPST0017 latent)

> ✅ **FAIT** (2026-09-04) — port byte-for-byte des 6 corps `xsl:function` (u:checkCodiceIPA:86-91,
> u:checkCF:92-123, u:checkCF16:124-140, u:checkPIVAseIT:141-167, u:checkPIVA:168-175 en xs:integer,
> u:addPIVA:176-188 en xs:integer, récursif) dans le bloc fontoxpath de validate-schematron.ts,
> commentaire citant les lignes source pour chacun. Règles du .sch qui les référencent, établies par
> grep : PEPPOL-COMMON-R044 (scheme 0201 → u:checkCodiceIPA), R045/R046 (schemes 0210/9907 →
> u:checkCF, qui délègue à u:checkCF16 en interne pour les 16 caractères) et R047 (scheme 0211 →
> u:checkPIVAseIT, qui délègue à u:checkPIVA puis u:addPIVA) — R048 (9906) est une règle
> COMMENTÉE dans le .sch, jamais évaluée. u:checkCF16/u:checkPIVA/u:addPIVA ne sont jamais appelées
> directement par une règle : enregistrées quand même (les 12 déclarées = les 12 enregistrées),
> exercées transitivement par les tests de u:checkCF/u:checkPIVAseIT — documenté dans le spec.
> Identifiants de démo, tous documentés/publics, jamais une personne réelle : Codice Fiscale
> `RSSMRA80A01H501U` (l'exemple canonique "Mario Rossi" de la doc fiscale italienne — équivalent
> italien de John Doe) ; Partita IVA `01234567897` (checksum Luhn-like vérifié = 0, fixture publique
> couramment citée par les validateurs open-source italiens, réutilisée aussi comme le CF-société à
> 11 chiffres de R046) ; Codice IPA `ABC123` (u:checkCodiceIPA n'a AUCUN vrai checksum dans le .sch —
> longueur 6 + charset alphanumérique seulement — fixture synthétique documentée comme telle, jamais
> présentée comme un code IPA réellement enregistré). jest complet 2153 verts (2149 + 4), biome
> propre, mutation rejouée (u:checkCodiceIPA dé-enregistrée → XPST0017 jeté, test correspondant
> tombe, les 9 autres restent verts). Deux en-têtes mis à jour : validate-schematron.ts (la
> dérogation italienne ne s'applique plus) et B2G_COVERAGE.md/TODO_ISSUES.md (gap barré/annoté réglé).
> Cypress : aucune spec (chantier backend pur).

Le reste nommé de l'audit B2G : u:checkCodiceIPA/u:checkCF/u:checkCF16/u:checkPIVAseIT/
u:checkPIVA/u:addPIVA déclarées par PEPPOL-EN16931-UBL.sch, non enregistrées dans
validate-schematron.ts — même classe de crash (throw au lieu d'un verdict) que les 6 corrigées.
Port byte-for-byte depuis le .sch (jamais réécrites), tests au patron de
validate-schematron.spec.ts (ne jette plus / le valide passe / l'invalide est attrapé, sur des
identifiants publics réels — un Codice Fiscale/Partita IVA de démo documenté).
**Accepte si** : les 12 fonctions du .sch sont toutes enregistrées ; l'en-tête de
validate-schematron.ts mis à jour (la dérogation italienne ne s'applique plus).

## L3 — Le tripwire automatisé migration-vs-schema (le bloqueur d'avant-merge)

> ✅ **FAIT** (2026-09-04) — spec gaté MIGRATION_FRESH_TESTS=1 (src/prisma/, contrainte
> jest.rootDir), base jetable préfixée avec garde-fou anti-drop, migrate deploy intégral,
> diff CROISÉ pg_enum ↔ client généré (24 enums découverts des deux côtés, jamais listés à la
> main) ; la mine P3 rejouée en labo (« only in the generated client: [DOCUMENT_SETTLED] »)
> ET l'autre direction prouvée par le mandataire (« only in the database: [ZOMBIE_VALUE] ») ;
> CI : 13 lignes dans queue-integration. jest 2153 (le spec skippe non-gaté), batterie 259 verts.

Consigné à la validation P3 : rien d'automatisé ne compare un `migrate deploy` intégral sur
Postgres VIERGE avec les enums du client généré. Un spec jest GATÉ (le patron liveDescribe/
env-flag des specs Redis : `MIGRATION_FRESH_TESTS=1`) qui crée une base jetable, déploie tout,
compare pg_enum à Object.values du client généré POUR CHAQUE enum du schéma (pas seulement
WebhookEvent), détruit la base. Câblé en CI dans le job queue-integration (il a déjà un
Postgres réel) — modification cypress.yml MINIMALE.
**Accepte si** : le spec attrape la mutation « valeur retirée de la liste _new » (la mine en
labo — rejouée) ; CI l'exécute ; non-gaté il skippe proprement.

## L4 — Les nettoyages consignés

(a) `simple-git` retiré de package.json (plus aucun import depuis P2 — précaution watcher :
npm install PEUT secouer node_modules pendant que le watcher tourne ; santé avant/après,
relance si mort). (b) Le commentaire obsolète documents-core.module.ts:417 (QUOTE_SENT/
INVOICE_SENT purgées). (c) La ligne « directory » fantôme d'architecture.md (module disparu).
(d) Les 3 erreurs biome préexistantes du frontend (totals-shape.ts / find-line-array-fields.ts
— formatage pur, `biome check --write`, aucune sémantique).
**Accepte si** : builds + boots verts après (a) ; biome ci exit 0 des deux côtés ; grep-zéro
simple-git.

## Clôture

Marquer ici, barrer les entrées TODO_ISSUES réglées, mémoire, rapport au retour du mandant
(dont : la question du push — +100 commits — et l'état de la pile).
