# PLAN-V2 — Facturation électronique française B2B

> **Document de travail, relu au début de chaque session et mis à jour à chaque tâche terminée.**
> Branche unique : `feat/compliance-engine-v2`, créée depuis `feat/compliance-architecture`
> (`f71cfb9b`). Commits atomiques, poussés au fil de l'eau.
>
> Source des tâches : `docs/compliance/audit/11-FRANCE-RESTE-A-FAIRE.md` (branche
> `audit/compliance-truth`). Conception du déclencheur : `08-CORRIDOR-MODEL.md`. État de l'existant :
> `10-ACQUIS.md`.
>
> **Règles de découpe.** Aucune tâche ne dépasse une journée. Toute tâche qui modifie un comportement
> produit porte son test **dans la même tâche**. Toute tâche à dépendance externe est `bloqué`, porte
> ce qui la débloque, et **ne compte pas dans le chemin critique**. Une tâche sans critère
> d'acceptation vérifiable par un tiers n'entre pas dans ce plan.

## Repères de départ

| | Valeur | Mesurée le |
| --- | --- | --- |
| Suite backend | **137 suites / 1812 tests / 0 échec** (+16 suites gatées) | 2026-08-28 |
| Cypress | **17 specs / 167 tests / 0 échec** | 2026-08-28 |
| Base | `f71cfb9b` | — |

## Corrections aux documents d'audit, établies en préparant ce plan

Deux chiffres publiés étaient faux. Ils sont corrigés ici **et** dans les documents d'origine.

| Affirmation publiée | Réalité vérifiée | Conséquence |
| --- | --- | --- |
| « ~40 sites lisent `plan.regime` » (`08-CORRIDOR-MODEL.md` §5, `11-FRANCE…` A1) | **16 lecteurs hors specs, dans 8 fichiers** ; 28 occurrences en specs | L'adaptateur de compatibilité est bien moins risqué qu'annoncé. Coût A1 revu **11–18 j → 7–12 j** |
| « il manque Postgres au job CI » (`11-FRANCE…` B4) | Le job `queue-integration` **a déjà** Postgres 16, `DATABASE_URL`, et applique les migrations | B4 se réduit à un drapeau et un motif de test. Coût **0,5 j → 0,25 j** |

---

# Phase 1 — Lot court

*Quatre trous nets. Aucune dépendance externe. Cible : 2 à 3 jours.*

### P1-T01 — B3 : le test dit ce qu'il vérifie
- **Fait** : réécrit `it('rejects completely empty XML')`, qui assert aujourd'hui `errorCount === 0`
  — il documente le trou sous un nom qui affirme l'inverse. Le test doit passer par le **provider**
  (chemin de production) et non par `validateSchematron()` en direct.
- **Fichiers** : `backend/src/compliance/providers/format/format-validation.spec.ts`
- **Dépend de** : rien
- **Accepte si** : le test, exécuté seul, **échoue en rouge** avec un message nommant le document
  accepté à tort. Un tiers relance `npx jest format-validation.spec.ts` et voit l'échec.
- **Note** : il est attendu rouge à l'issue de cette tâche. C'est P1-T03 qui le fera passer — ou pas,
  voir P1-T04.
- **État** : à faire

### P1-T02 — A6 : mesurer avant de propager
- **Fait** : rend `providers.ts:145` refusant sur `bytes.length === 0`, **dans une copie de travail
  non commitée**, lance la suite complète, et **rapporte le nombre de tests cassés et lesquels**
  avant toute propagation.
- **Fichiers** : mesure seule, aucun commit de code
- **Dépend de** : rien
- **Accepte si** : la liste des suites et tests en échec est publiée dans le rapport, avec leur
  nombre. Un tiers reproduit la mesure en inversant la même ligne.
- **Pourquoi séparée** : faire échouer les 42 builders stub d'un coup est le résultat **correct**,
  mais c'est le genre de changement qu'on annule à mi-chemin faute d'en connaître l'ampleur.
- **État** : à faire

### P1-T03 — A6 : l'artefact vide n'est plus accepté
- **Fait** : `providers.ts:145` renvoie un rapport **invalide** au lieu de `okValidation(…'stub
  path')`. Propage aux tests que P1-T02 a recensés.
- **Fichiers** : `backend/src/compliance/providers/format/providers.ts` + les specs recensées
- **Dépend de** : P1-T02
- **Accepte si** : un artefact de zéro octet produit `valid: false` pour **les cinq syntaxes du
  chemin français** (`EN16931_CII`, `FACTURX`, `EN16931_UBL`, `PEPPOL_BIS`, `PDF_A3`), prouvé par un
  test nommé qui échouait avant ; **et** la suite complète repasse au vert.
- **État** : à faire

### P1-T04 — B3 : refermer, ou nommer le reste
- **Fait** : rejoue P1-T01. **Hypothèse à vérifier, pas à supposer** : le document du test est
  `<root/>`, bien formé et **non vide** — A6 ne traite que zéro octet, donc P1-T03 pourrait ne pas
  suffire. Si le test reste rouge, ajoute une garde d'élément racine dans le provider CII.
- **Fichiers** : `providers.ts`, `format-validation.spec.ts`
- **Dépend de** : P1-T03
- **Accepte si** : le test passe au vert **en assertant le rejet**, et le rapport dit laquelle des
  deux causes l'a fermé.
- **État** : à faire

### P1-T05 — A5 : format du numéro de facture
- **Fait** : contraint le numéro à la règle **G1.05 du DSE Annexe 7 v1.9** — 35 caractères maximum,
  caractères spéciaux limités à `espace - + _ /`, pas d'espace en tête ni en fin, pas d'espace
  consécutif. Validation à l'émission, message d'erreur nommant la règle violée.
- **Fichiers** : `backend/src/utils/numbering.ts`, `backend/src/modules/invoices/invoices.service.ts`
- **Dépend de** : rien
- **Accepte si** : une table de cas — 35 et 36 caractères, chaque caractère spécial autorisé, un
  interdit, espace en tête, en fin, double espace — passe, avec le cas limite accepté à 35 et refusé
  à 36. Test nommé, rouge sans la garde.
- **État** : à faire

### P1-T06 — B4 : le test CAS de numérotation entre en CI
- **Fait** : `apply-signal.live.spec.ts` sort de son drapeau `COMPLIANCE_LIVE_DB_TESTS` et s'exécute
  dans le job `queue-integration`, **qui a déjà** Postgres 16, `DATABASE_URL` et `migrate deploy`.
- **Fichiers** : `.github/workflows/cypress.yml`
- **Dépend de** : rien
- **Accepte si** : le job CI exécute le test TOCTOU déterministe et **échouerait** si le CAS était
  retiré. Vérifié localement contre un Postgres jetable avant de pousser.
- **État** : à faire

---

# Phase 2 — Déclencheur et obligations par couche

*Le chemin critique. Deux vérifications avant toute ligne de code : elles conditionnent la
conception, et les faire après reviendrait à concevoir sur une hypothèse.*
**Point d'arrêt obligatoire en fin de phase.**

### P2-V01 — Vérification juridique : FR→IT B2B relève-t-il de l'e-reporting ?
- **Fait** : vérifie contre **source primaire**, avec URL et date de consultation, que l'e-invoicing
  de l'art. 289 bis I ne s'applique pas à une opération dont l'acquéreur n'est pas établi en France,
  et que l'art. 290 la place en e-reporting. **Vérifie en particulier l'articulation avec
  l'art. 289 bis V**, qui exclut aussi les livraisons intracommunautaires exonérées : ce cas pourrait
  relever de deux exclusions par deux chemins différents, ce qui changerait le prédicat.
- **Fichiers** : `docs/compliance/audit/03-LEGAL-VERIFICATION.md` (ajout sourcé)
- **Dépend de** : rien
- **Accepte si** : chaque affirmation porte URL + date. Si la source ne tranche pas, la question est
  écrite en `open_question` avec ce qui la trancherait — **aucune valeur plausible**.
- **État** : à faire

### P2-V02 — Jouer le prédicat contre les six pivots
- **Fait** : écrit la fonction de prédicat `EstablishmentPredicate` **seule**, et six jeux d'entrées
  construits à la main (FR, DE, IT, PL, ES, MX). Pas d'intégration au moteur.
- **Fichiers** : nouveau `backend/src/compliance/engine/establishment-predicate.ts` + son spec
- **Dépend de** : P2-V01
- **Accepte si** : les six pivots rendent le verdict attendu. **Deux questions à trancher par
  l'épreuve, pas par l'intuition** : `EITHER_ESTABLISHED_IN` donne-t-il le bon verdict pour l'Italie,
  et l'Espagne a-t-elle besoin de deux règles ? Le rapport dit oui ou non, avec le cas qui le montre.
- **État** : à faire

### P2-T01 — A3 : `establishmentIntervening` porté par l'opération
- **Fait** : ajoute l'établissement intervenant au contexte d'opération et **supprime le repli
  silencieux** `countryCode: … ?? 'FR'` (`invoices.helpers.ts:130` et `:136`). Une opération sans
  établissement résolu **bloque**, avec un message nommant ce qui manque.
- **Fichiers** : `invoices.helpers.ts`, `canonical-document.ts`, migration Prisma, UI de saisie
- **Dépend de** : P2-V02
- **Accepte si** : une société sans pays renseigné **ne devient plus française** — l'émission est
  refusée avec un message nommant le champ manquant. Test rouge sans la garde. **Migration vérifiée
  contre un vrai Postgres**, pas seulement `prisma generate`.
- **État** : à faire

### P2-T02 — A1 : `ObligationRule` dans le schéma de profil, France seule
- **Fait** : introduit `ObligationLayer` et `ObligationRule` dans le schéma, et réécrit le **seul**
  profil FR en obligations. Les autres profils gardent leur forme actuelle.
- **Fichiers** : `profiles/schema.ts`, `profiles/data/fr.ts`
- **Dépend de** : P2-T01
- **Accepte si** : `data-integrity.spec.ts` valide la nouvelle forme, et le profil FR exprime les
  trois couches (émission, réception, archivage) avec leurs échéances distinctes.
- **État** : à faire

### P2-T03 — A1 : `plan.obligations` + adaptateur de compatibilité
- **Fait** : `resolve()` produit `obligations: ResolvedObligation[]`. Un accesseur
  `primaryObligation()` sert les lecteurs existants sans les toucher.
- **Fichiers** : `compliance-engine.ts`
- **Dépend de** : P2-T02
- **Accepte si** : les **16 lecteurs de `plan.regime` hors specs, répartis sur 8 fichiers**, passent
  par l'adaptateur ; suite complète verte. *(Chiffre mesuré, contre « ~40 sites » publié à tort.)*
- **État** : à faire

### P2-T04 — A1 : migrer les lecteurs, lot 1 — moteur et exécution
- **Fait** : `compliance-engine.ts`, `execution/executor.ts`, `operations/compliance-service.ts`
  lisent `obligations` directement.
- **Dépend de** : P2-T03 · **Accepte si** : suite complète verte après le lot. **État** : à faire

### P2-T05 — A1 : migrer les lecteurs, lot 2 — cycle de vie
- **Fait** : `lifecycle/runtime.ts`, `lifecycle/phases/contributors.ts`, `lifecycle/flow-descriptor.ts`.
- **Dépend de** : P2-T04 · **Accepte si** : suite complète verte après le lot. **État** : à faire

### P2-T06 — A1 : migrer les lecteurs, lot 3 — file et signaux
- **Fait** : `nest/apply-signal.ts`, `nest/queue/processors/transmit.processor.ts`. L'adaptateur est
  ensuite supprimé.
- **Dépend de** : P2-T05 · **Accepte si** : plus aucune occurrence de `plan.regime` hors specs ;
  suite complète verte. **État** : à faire

### P2-T07 — A2 : e-invoicing et e-reporting disjoints
- **Fait** : les deux régimes deviennent deux obligations distinctes — **F1 contre F10**, statuts
  **200/210/212/213 contre 300/301**, **24 h contre périodique**, **avoir ou rectificatif contre
  remplacement de période entière**.
- **Fichiers** : `profiles/data/fr.ts`, `lifecycle/`, `reporting/`
- **Dépend de** : P2-T06
- **Accepte si** : les quatre flux français produisent le plan juste, prouvé par un test qui échoue
  sur l'arbre actuel :
  | Flux | Attendu |
  | --- | --- |
  | FR→FR B2B | e-invoicing, canal PDP |
  | FR→FR B2C | e-reporting, **aucun** canal PDP |
  | FR→IT B2B | **e-reporting**, aucun canal PDP *(produit `DECENTRALIZED_CTC` + PDP aujourd'hui)* |
  | FR→US B2B | **e-reporting**, aucun canal PDP *(idem)* |
- **État** : à faire

### P2-T08 — A4 : BT-23 en cardinalité 1..1
- **Fait** : émet la catégorie d'opération biens/services en 1..1, valeurs limitatives dérivées du
  type d'opération.
- **Fichiers** : générateurs CII / Factur-X
- **Dépend de** : P2-T07
- **Accepte si** : tout artefact FR post-mandat porte BT-23 avec une valeur de la liste ; test rouge
  sans la contrainte ; le Schematron EN 16931 passe toujours.
- **État** : à faire

> ### ⏸ POINT D'ARRÊT — fin de phase 2
> Le modèle est présenté avant de se propager. **La phase 3 ne démarre pas sans feu vert.**

---

# Phase 3 — Machine à états dérivée du profil

*Les corrections d'abord — demande explicite. Le cycle de vie est **dérivé du profil**, jamais codé
en dur. Le runtime événementiel existe et est branché : `AWAIT_CALLBACK`, `ARM_TIMER`, six sites de
consommation, deux endpoints entrants. **On l'étend, on ne le refait pas.***

| # | Tâche | Dépend de | Accepte si |
| --- | --- | --- | --- |
| **P3-T01** | Recenser les voies de correction par pays — avoir, facture rectificative, avoir interne non transmis, *nota di debito*, *faktura korygująca*, annulation + substitution — et pour chacune : ouverte, requise, ou interdite | feu vert | Table sourcée, une ligne par pays × voie, chaque case avec sa référence légale |
| **P3-T02** | Porter ces voies dans le schéma de profil | P3-T01 | `data-integrity` valide ; les six pivots expriment leurs voies |
| **P3-T03** | **D2 — l'avoir interne français.** Sur statut *Refusée* ou *Rejetée*, l'annulation comptable ne génère **aucun flux F1** vers le PPF et **n'est pas transmise à l'acheteur**. Le code transmet aujourd'hui précisément là où la spécification l'interdit | P3-T02 | Un test prouve qu'aucune transmission n'est déclenchée depuis ces deux statuts, et qu'il échoue sur l'arbre actuel |
| **P3-T04** | **D1 — sortie de `REJECTED`**, aujourd'hui terminal (`REJECTED: {}`). Le modèle porte la divergence : l'Italie renvoie de préférence sous **mêmes date et numéro** après un *scarto*, la Pologne sous le même **P_2**. La France suffit à démarrer | P3-T02 | Depuis `REJECTED`, la voie française est ouverte et exerçable ; les voies IT et PL sont exprimables dans le profil sans code par pays |
| **P3-T05** | Fenêtres, délais et consentement de la contrepartie, par pays | P3-T02 | Chaque fenêtre est une donnée de profil ; un délai dépassé produit un effet observable |
| **P3-T06** | **D3 — journal append-only en base**, pas seulement applicatif : `UPDATE`/`DELETE` révoqués sur `ComplianceEvent`, ou trigger | feu vert | Une tentative d'`UPDATE` échoue **contre un vrai Postgres**, prouvé par un test qui l'exécute |

---

# Phase 4 — Socle de test frontend

| # | Tâche | Dépend de | Accepte si |
| --- | --- | --- | --- |
| **P4-T01** | **D4 — un runner** : Vitest + testing-library, aligné sur l'outillage existant (Vite 7, React 19) | phase 3 | `npm test` existe côté frontend, tourne en CI, et échoue si un test échoue |
| **P4-T02** | Couverture des **parcours** de conformité : émission, rejet, correction, avoir, annulation. Pas la couverture de lignes | P4-T01 | Un parcours par test nommé ; chacun échoue si l'écran cesse de montrer l'état |
| **P4-T03** | `17-invoice-rejection.cy.ts` s'étend aux nouveaux états | P4-T02 | La spec couvre les états ajoutés en phase 3 ; suite Cypress verte |

---

# Phase 5 — Câblage du transport

| # | Tâche | Dépend de | Accepte si | État |
| --- | --- | --- | --- | --- |
| **P5-T01** | **C1 — injection du port HTTP.** `registry.ts:70-88` ne passe que des credentials : **aucun canal ne peut émettre, pour aucun pays**. Câble l'injection | phase 4 | Le registre de production construit un provider avec un port réel ; un test le prouve sans credentials | à faire |
| **P5-T02** | **C2 — l'artefact d'acquittement est écrit par le code**, daté, dans `evidence/`. S'il n'existe aucune preuve aujourd'hui, c'est parce que rien n'en produit | P5-T01 | Un aller-retour réussi dépose un fichier daté et versionnable, sans intervention manuelle | à faire |
| **P5-T03** | Vérification d'un **triplet France complet**, de bout en bout | P5-T02 + credentials PDP | Une facture française émise, transmise, acquittée, avec l'artefact déposé | **bloqué** — credentials PDP |

---

# Discipline permanente

- Suite backend **après chaque tâche**. Cypress après chaque tâche touchant le front, et en fin de phase.
- **Un remplacement de texte non matché échoue** — `assert old in s` avant chaque `replace`. Erreur commise deux fois le même jour.
- **Lire la sortie brute avant de traiter un symptôme.** Le plantage du renderer a coûté cinq tentatives ; la clé dupliquée était dans le log depuis le début.
- **`git add -A` est proscrit.** Chemins explicites. `CLAUDE.md` a été repris deux fois.
- **Ne présumer d'aucun artefact.** Une migration se vérifie contre Postgres ; un test contre son contenu, pas son nom ; un comptage ne vaut pas une lecture.
- **Ne jamais corriger un chiffre dans une sonde sans le corriger dans le texte publié.**
- **Ce document est mis à jour à chaque tâche terminée.** C'est ce qui permet de reprendre après interruption.

# Journal

| Date | Tâche | État | Note |
| --- | --- | --- | --- |
| 2026-08-28 | — | — | Plan écrit. Branche créée depuis `f71cfb9b`. 11 branches `fix/` supprimées du remote après vérification qu'elles sont ancêtres de `feat/compliance-architecture`. |
