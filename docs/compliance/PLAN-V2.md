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
| Suite backend | 137 suites / 1812 tests / 0 échec → **139 / 1837 / 0** | 2026-08-28 |
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
- **Pourquoi séparée** : c'est le genre de changement qu'on annule à mi-chemin faute d'en connaître
  l'ampleur.
- **État** : ✅ **fait — 2026-08-28**

> ### Mesure P1-T02 — et elle infirme l'hypothèse de départ
>
> **6 suites, 31 tests** en échec (1812 → 1783 passants ; le total passe de 1909 à 1911 à cause des
> deux tests rouges de P1-T01, dont l'un — *zero-byte artifact* — devient vert sous A6).
>
> | Suite | Ce qui casse |
> | --- | --- |
> | `execution/executor.spec.ts` | ComplianceExecutor — France (CTC décentralisé) : numéro, Factur-X, TVA, signature, transmission PDP |
> | `operations/compliance-service.spec.ts` | émission FR, avoirs, notes de débit, statut *encaissée*, e-reporting FR→IT |
> | `operations/format-validation-blocking.spec.ts` | garde de blocage à la validation |
> | `lifecycle/lifecycle-coherence.spec.ts` | cohérence du cycle de vie |
> | `providers/format/format-validation.spec.ts` | dont les 2 tests de P1-T01 |
> | `canonical/cached-existence-client.spec.ts` | câblage d'existence §7 |
>
> **Ce ne sont pas les 42 builders stub.** L'hypothèse était que faire rejeter le zéro octet les
> ferait tomber d'un coup ; la mesure dit autre chose, et c'est plus grave. Les suites qui cassent
> sont celles du **chemin français**, et la cause est en `providers.ts:96-142` : le provider EN16931
> ne produit de vrais octets que si le port de rendu `this.artifacts` **et** `ctx.externalRef` sont
> présents. Sinon il retombe sur `rendered(artifact)` — zéro octet — avec un simple `log.todo`.
>
> `executor.spec.ts` instancie le **vrai** `ComplianceExecutor` avec le registre par défaut, sans
> injecter de port de rendu. Les trois artefacts français — `EN16931_CII/AUTHORITATIVE`,
> `FACTURX/HUMAN`, `FACTURX/BUYER` — sont donc **réellement vides**, et le pipeline les signe, les
> archive et les « transmet » aujourd'hui sans objection. C'est F-001, vu depuis un autre angle, et
> c'est le même motif que C1 : **une couture d'injection qui n'est câblée que sur certains chemins.**
>
> **Correction d'un chiffre de ce plan** : « `providers.ts:145` — **un** endroit à retourner » est
> faux. Il y a **cinq** court-circuits identiques : lignes **146, 346, 393, 521, 566**
> (EN16931, CFDI, FatturaPA, FA_VAT, Facturae).
>
> **Et la mesure elle-même était incomplète** — même défaut, un cran plus bas. Je n'avais inversé
> **qu'un** des cinq court-circuits, donc « 6 suites / 31 tests » ne mesurait qu'EN16931. Les cinq
> inversés : **8 suites / 52 tests**, avec `execution/europe.spec.ts` et
> `execution/peppol-f7-reachability.spec.ts` en plus. Mesurer une partie et nommer le total est la
> version chiffrée de compter au lieu de lire.
>
> **Conséquence sur P1-T03** : ce n'est plus une tâche d'une ligne. Faire rejeter le zéro octet sans
> câbler le port de rendu rendrait la suite rouge sur le chemin français. P1-T03 est donc découpée.

### P1-T03a — A6 : injecter le port de rendu là où il manque
- **Fait** : les chemins qui construisent des artefacts sans port de rendu injecté en reçoivent un.
  C'est le préalable rendu obligatoire par la mesure P1-T02 : sans lui, refuser le zéro octet rend
  la suite rouge sur le chemin français au lieu de corriger quoi que ce soit.
- **Fichiers** : `execution/executor.ts`, `operations/compliance-service.ts`, specs concernées
- **Dépend de** : P1-T02
- **Accepte si** : `executor.spec.ts` produit des artefacts français à **octets non nuls** —
  `EN16931_CII` et les deux `FACTURX` — vérifié par une assertion sur `bytes.length > 0` qui échoue
  sur l'arbre actuel.
- **État** : à faire

### P1-T03b — extraire un port de rendu partagé pour les tests
- **Fait** : `peppol-f7-reachability.spec.ts:63` porte déjà un `makeArtifactPort(fixtureData)` — un
  **vrai** `InvoiceArtifactPort` adossé au pipeline de rendu, sans base. Extrait-le en fixture
  partagée sous `compliance/__fixtures__/`.
- **Fichiers** : nouvelle fixture, `peppol-f7-reachability.spec.ts` (devient consommateur)
- **Dépend de** : P1-T03a
- **Accepte si** : `peppol-f7-reachability.spec.ts` passe en utilisant la fixture extraite, sans
  changement de comportement — suite complète verte.
- **État** : ✅ **fait — `5024cf18`**

### P1-T03c — les suites du chemin français construisent de vrais artefacts
- **Fait** : les 8 suites qui construisent aujourd'hui des artefacts vides reçoivent le port de la
  fixture : `executor`, `compliance-service`, `format-validation-blocking`, `lifecycle-coherence`,
  `europe`, `cached-existence-client`, `peppol-f7-reachability`, `format-validation`.
- **Dépend de** : P1-T03b
- **Accepte si** : une assertion `bytes.length > 0` sur les trois artefacts français
  (`EN16931_CII/AUTHORITATIVE`, `FACTURX/HUMAN`, `FACTURX/BUYER`) passe dans `executor.spec.ts`, et
  échouait avant. Suite complète verte.
- **État** : ✅ **fait — `7e899b9a`**. Deux manques, pas un : le port **et** `ctx.externalRef`
  (`providers.ts:96` exige les deux ; en production `externalRef` est un paramètre requis du
  constructeur de contexte). Résultat : CII 6469 o, Factur-X 11557 o ×2. Deux assertions existantes
  corrigées — elles vérifiaient le `log.todo` du chemin **stub** sous un nom disant « builds ».

### P1-T03d — A6 : l'artefact vide n'est plus accepté
- **Fait** : les **cinq** court-circuits renvoient un rapport **invalide** au lieu de
  `okValidation(…'stub path')`.
- **Fichiers** : `backend/src/compliance/providers/format/providers.ts`
- **Dépend de** : P1-T03c
- **Accepte si** : un artefact de zéro octet produit `valid: false`, prouvé par un test nommé qui
  échouait avant ; **et** la suite complète repasse au vert.
- **État** : ✅ **fait — `6a51ac48`**, mais **pas comme énoncé**. Le rejet à plat mettait 8 suites /
  46 tests au rouge. La distinction juste n'est pas « zéro octet » mais **« un moteur de rendu
  était câblé et n'a rien produit »** — sans port, zéro octet parle du *pipeline* et reste toléré ;
  avec port, la construction a **échoué**. La production a toujours le port, donc elle est stricte.
  Retombée : 46 tests → 5, et les 5 étaient réels.
- **Restriction assumée** : appliqué à la famille EN 16931 (le chemin français). Les quatre
  providers nationaux gardent l'ancien comportement — leurs renderers de test rendent `''`.

### P1-T04 — B3 : refermer, ou nommer le reste
- **État** : ✅ **fait — `6a51ac48`**. L'hypothèse était **juste** : A6 n'a pas suffi. `<root/>` est
  bien formé et **non vide**, donc la garde du zéro octet ne l'atteint pas. Fermé par une **garde
  d'élément racine**, placée avant Schematron — lequel ne peut structurellement pas l'attraper :
  ses règles sont ancrées sur des contextes internes, donc un document qui n'en contient aucun
  ressort avec **zéro erreur**, ce qui est la bonne réponse Schematron et une garde inutile.

### P1-T05 — A5 : format du numéro de facture
- **Fait** : contraint le numéro à la règle **G1.05 du DSE Annexe 7 v1.9** — 35 caractères maximum,
  caractères spéciaux limités à `espace - + _ /`, pas d'espace en tête ni en fin, pas d'espace
  consécutif. Validation à l'émission, message d'erreur nommant la règle violée.
- **Fichiers** : `backend/src/utils/numbering.ts`, `backend/src/modules/invoices/invoices.service.ts`
- **Dépend de** : rien
- **Accepte si** : une table de cas — 35 et 36 caractères, chaque caractère spécial autorisé, un
  interdit, espace en tête, en fin, double espace — passe, avec le cas limite accepté à 35 et refusé
  à 36. Test nommé, rouge sans la garde.
- **État** : ✅ **fait — `e4fe5438`**, 19 tests. Garde à l'**allocation**, pas à la transmission :
  un numéro sort d'une série sans trou, le refuser plus tard le laisserait brûlé.

### P1-T06 — B4 : le test CAS de numérotation entre en CI
- **Fait** : `apply-signal.live.spec.ts` sort de son drapeau `COMPLIANCE_LIVE_DB_TESTS` et s'exécute
  dans le job `queue-integration`, **qui a déjà** Postgres 16, `DATABASE_URL` et `migrate deploy`.
- **Fichiers** : `.github/workflows/cypress.yml`
- **Dépend de** : rien
- **Accepte si** : le job CI exécute le test TOCTOU déterministe et **échouerait** si le CAS était
  retiré. Vérifié localement contre un Postgres jetable avant de pousser.
- **État** : ✅ **fait — `d2207df6`**. Vérifié contre Postgres 16.11 dans les deux sens : 8 verts
  avec le CAS, **2 rouges sans** (les deux preuves M-12b).

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
- **État** : ✅ **fait — `447eb2f3`**, dans `docs/compliance/FR-RATTACHEMENT.md`. Quatre résultats,
  dont trois non anticipés :
  1. Le déclencheur bilatéral est confirmé **littéralement**, mais le critère est **triple** —
     « établis **ou** domicile **ou** résidence habituelle ». Le type se renomme `Attachment`.
  2. La **double exclusion tient**, et les deux voies sont **indépendantes** : sans la seconde,
     FR→IT aurait le bon verdict *par accident*. La France a besoin de **deux règles**.
  3. L'art. 290 est **bien plus large que « transfrontalier »** — il couvre aussi des opérations
     domestiques et les acquisitions. Le profil FR le réduit au rôle `B2C`.
  4. **Trouvé en lisant, non cherché** : les deux articles sont **abrogés au 2027-01-01**
     (Ord. n° 2025-1247), fondement transféré au CIBS. Toute citation `CGI art. 289 bis` du dépôt
     périme quatre mois après le début du mandat. `open_question` ouverte : la recodification
     est-elle à droit constant **sur le déclencheur** ? Non vérifié, rien codé dessus.

### P2-V02 — Jouer le prédicat contre les six pivots
- **Fait** : écrit la fonction de prédicat `EstablishmentPredicate` **seule**, et six jeux d'entrées
  construits à la main (FR, DE, IT, PL, ES, MX). Pas d'intégration au moteur.
- **Fichiers** : nouveau `backend/src/compliance/engine/establishment-predicate.ts` + son spec
- **Dépend de** : P2-V01
- **Accepte si** : les six pivots rendent le verdict attendu. **Deux questions tranchées par
  l'épreuve** :
  - **Italie** — `EITHER_ATTACHED_TO` est la bonne forme, et la mauvaise est visible : un prédicat
    bilatéral **refuse IT→FR**, que le SdI achemine. Asserté dans les deux sens.
  - **Espagne** — **une seule** règle de rattachement suffit. Sa seconde règle est l'exclusivité
    SII / Veri\*Factu (RD 1007/2023 art. 3.3), un **choix de régime**, pas un rattachement : elle
    n'a pas sa place dans ce type.
  - *(non prévu)* **la France**, elle, en a besoin de deux — voir P2-V01 §2.
- **État** : ✅ **fait — `291a91c1`**, 14 tests. L'indécidabilité est modélisée : un rattachement
  non résolu renvoie `null`, `null` domine `true` et `false` domine `null`. C'est ce qui permettra
  à A3 de **bloquer** au lieu de retomber sur la France.

### P2-T01 — A3 : `establishmentIntervening` porté par l'opération
- **Fait** : ajoute l'établissement intervenant au contexte d'opération et **supprime le repli
  silencieux** `countryCode: … ?? 'FR'` (`invoices.helpers.ts:130` et `:136`). Une opération sans
  établissement résolu **bloque**, avec un message nommant ce qui manque.
- **Fichiers** : `invoices.helpers.ts`, `canonical-document.ts`, migration Prisma, UI de saisie
- **Dépend de** : P2-V02
- **Accepte si** : une société sans pays renseigné **ne devient plus française** — l'émission est
  refusée avec un message nommant le champ manquant. Test rouge sans la garde.
- **État** : ✅ **fait — `c5dfc682`**, 5 tests, 3 rouges avec le repli restauré.
- **Périmètre revu à la lecture du code** : aucune migration Prisma n'était nécessaire. Le champ
  `countryCode` existe déjà des deux côtés ; le défaut n'était pas un stockage manquant mais le
  **repli `?? 'FR'`** dans le constructeur de contexte. Le côté acheteur avait déjà une garde à
  l'émission (F-006) — mais le constructeur repliait **en dessous d'elle**, et le côté
  **fournisseur**, celui qui décide quel régime national s'applique, n'en avait aucune.

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
- **Dépend de** : P2-T03 · **Accepte si** : suite complète verte après le lot. **État** : ✅ **fait — `558f88a4`** (executor 2, compliance-service 1)

### P2-T05 — A1 : migrer les lecteurs, lot 2 — cycle de vie
- **Fait** : `lifecycle/runtime.ts`, `lifecycle/phases/contributors.ts`, `lifecycle/flow-descriptor.ts`.
- **Dépend de** : P2-T04 · **Accepte si** : suite complète verte après le lot. **État** : ✅ **fait — `558f88a4`** (contributors 6, flow-descriptor 1)

### P2-T06 — A1 : migrer les lecteurs, lot 3 — file et signaux
- **Fait** : `nest/apply-signal.ts`, `nest/queue/processors/transmit.processor.ts`. L'adaptateur est
  ensuite supprimé.
- **Dépend de** : P2-T05 · **Accepte si** : plus aucune occurrence de `plan.regime` hors specs ;
  suite complète verte. **État** : ✅ **fait — `558f88a4`**. Le lot 3 était **vide** : `apply-signal`
  et `transmit.processor` lisent `execution.regime`, le champ du **résultat d'exécution**, pas le
  plan. Lire les deux fichiers plutôt que la liste du plan est ce qui l'a montré. Le champ
  `plan.regime` est **supprimé**, pas seulement contourné.

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
- **État** : ✅ **fait — `fed4c693`**, 6 tests, **rouge avant / vert après** vérifié en remisant
  `fr.ts` : une seule assertion sur six tombe, celle que le plan nommait.
- **Correction d'une erreur que j'avais publiée** : j'avais écrit que la justification de `fr.ts`
  (« filtrer le B2C couperait le chemin des données ») était infirmée par le code. Elle ne l'était
  pas. J'avais lu `report.processor.ts` — clôture de période, mockée — et généralisé.
  `compliance-service.spec.ts` a échoué et montré l'autre chemin : `transmitStatus()` résout son
  canal depuis le plan, donc une facture B2C payée n'aurait plus eu où déclarer son « encaissée ».
- **Le correctif est celui que cette note demandait** : `TransmissionRule.serves`, et un plan qui
  porte `reportingChannels` à côté de `channels` — où vont les **données**, distinct d'où va la
  **facture**. Les autres profils le laissent vide et retombent sur le canal de facture, inchangés.

### P2-T08 — A4 : BT-23 en cardinalité 1..1
- **Fait** : émet la catégorie d'opération biens/services en 1..1, valeurs limitatives dérivées du
  type d'opération.
- **Fichiers** : générateurs CII / Factur-X
- **Dépend de** : P2-T07
- **Accepte si** : tout artefact FR post-mandat porte BT-23 avec une valeur de la liste ; test rouge
  sans la contrainte ; le Schematron EN 16931 passe toujours.
- **État** : ✅ **fait — `96ecaf0f`**, 9 tests, dérivation vérifiée sur un **artefact réel**
  (`SERVICES → S1`, `GOODS → B1`).
- **Le défaut n'était pas l'absence.** `@e-invoice-eu/core` émet `M1` **en dur** : la valeur était
  présente et **fausse dans deux cas sur trois**. Un contrôle de présence ne l'aurait pas vu — c'est
  pourquoi l'audit l'avait classée « absente ».
- **Limite** : seul le cadre **1** est dérivé. Les cadres 2 (auto-facturation), 4 (mandat) et 5/6/7
  dépendent de qui facture pour qui, ce que le dépôt ne modélise pas. Consigné plutôt que deviné.

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

## Limites assumées de P2-T02/T03, à reprendre en A2

Consignées ici parce qu'elles sont **modélisées à moitié ou pas du tout**, et qu'une limite tue est
une dette invisible :

1. **Le B2C domestique garde ses canaux actuels.** Il est hors mandat par le rôle, mais l'art. 290 III
   veut que les **données** d'e-reporting transitent par la plateforme agréée — et `channels` est
   aujourd'hui une seule liste qui sert à la fois au routage de la facture et au chemin des données.
   Les séparer est précisément l'objet du modèle d'obligations d'A2.
2. **L'art. 290 I est plus large que « transfrontalier »** : livraisons domestiques à un assujetti
   non établi (1° b), B2C situé en France (2° b, f), acquisitions (3°). Seul le complément du test
   bilatéral est encodé.
3. **Monaco** : le rattachement est évalué sur le pays **résolu**, donc MC hérite de FR par
   délégation — la décision existante du dépôt, préservée et non rejugée. Mais l'art. 290 I 4° a)
   range explicitement les opérations FR↔Monaco en e-reporting. À sourcer à part.

## Constats du run e2e complet (2026-08-28), non corrigés

Trouvés en lisant le journal d'un système qui **tourne**, pas le code.

### C1 — un envoi français est bloqué par `BR-Z-02`, et l'utilisateur ne peut pas le savoir

8 avertissements et **2 envois bloqués** pendant le run :

> `[BR-Z-02]` An Invoice that contains an Invoice line where the Invoiced item VAT category code
> (BT-151) is "Zero rated" shall contain the Seller VAT Identifier (BT-31) […]

**Ce n'est pas un faux positif.** La société e2e n'a **aucun identifiant TVA** — ni l'onboarding ni
les réglages n'en saisissent — et la spec `07-invoices` saisit délibérément un taux de `0`. La
facture porte donc réellement une ligne à taux zéro sans BT-31, et le Schematron a raison.

**Le défaut n'est pas la garde, c'est ce qui l'entoure :**

1. Le produit laisse créer une société française **sans identifiant TVA**, puis émettre une facture
   à 0 %, et ne le signale **qu'au moment de l'envoi**.
2. **La suite e2e passe quand même** : aucune spec n'assert que l'envoi aboutit. Deux transmissions
   échouent en silence dans un run vert.

**✅ Corrigé — `b1d139cd`.** La garde est posée **à l'émission**, à côté des gardes de pays et pour la
même raison : une facture qui ne peut pas être transmise ne doit pas atteindre un état où
l'utilisateur croit l'avoir émise. Le message nomme la règle et les **deux** sorties — ajouter le
numéro de TVA, ou sortir du taux zéro. 8 tests.

Volontairement **étroite** : France domestique, taux 0, pas d'identifiant TVA vendeur. Les
exportations (catégories G/K) et l'autoliquidation (AE) portent aussi un taux 0 et relèvent de
BR-IC-02 / BR-AE-02, dont les conditions diffèrent — bloquer sur « le taux vaut 0 » refuserait des
factures parfaitement valides. Deux tests assertent que le transfrontalier et le vendeur non
français sont laissés tranquilles.

**Reste ouvert** : aucune spec e2e n'assert encore qu'un envoi aboutit, donc un échec de
transmission peut toujours se loger dans un run vert.

### C2 — la fixture de port d'artefacts rend un document FIGÉ

Limite de mon propre travail (P1-T03b/c), trouvée en essayant de reproduire C1 hors ligne.

`makeArtifactPort(fixtureData)` rend toujours **le même document** — `FR_B2B_STANDARD` — quel que
soit le `TransactionContext` passé à `buildAll()`. Conséquence : dans toute suite qui l'utilise, la
validation de format **ne valide pas le contexte sous test**. Un contexte à taux zéro produit un
artefact à 20 %, et le test le déclare valide.

C'était suffisant pour ce que P1-T03c visait — prouver que les artefacts ne sont plus vides — et
**insuffisant pour toute assertion sur le contenu**. C'est ce qui m'a empêché de reproduire C1.

**✅ Corrigé — `253178b5`.** Le port accepte désormais un **résolveur par identifiant de facture**,
et les caches sont clés sur `(invoiceId, format)`. Le cas simple reste simple ; une suite peut
enregistrer des données par `ctx.externalRef`. **C1 est reproduit par un test** : le même document
français à taux zéro est **invalide** sans l'identifiant TVA du vendeur et valide avec, `BR-Z-02`
nommé dans les erreurs.

### C3 — `BR-AE-02` bloque le transfrontalier, et la garde C1 ne le couvre pas *(nouveau)*

Trouvé en construisant la reproduction. Premier essai avec la fixture standard telle quelle : son
acheteur est une société **allemande**, donc un taux 0 est de l'**autoliquidation** (catégorie AE) et
c'est **`BR-AE-02`** qui a tiré, pas `BR-Z-02`.

`BR-AE-02` exige le même identifiant TVA vendeur **plus** un identifiant acheteur. La garde C1 est
délibérément domestique et ne le couvre pas : **un vendeur français sans identifiant TVA facturant
0 % à un acheteur allemand est toujours bloqué à la transmission aujourd'hui.**

**✅ Corrigé — `132da085`**, et lire les règles plutôt que les extrapoler a montré que C1 était faux
**des deux côtés** :

| Cat. | Règle | Exige du vendeur |
| --- | --- | --- |
| `Z` | BR-Z-02 | id TVA **ou** id d'immatriculation fiscale **ou** représentant |
| `E` | BR-E-02 | idem |
| `AE` | BR-AE-02 | idem, **plus** un identifiant acheteur |
| `K` | BR-IC-02 | id TVA ou représentant — **pas** l'immatriculation fiscale |
| `G` | BR-G-02 | id TVA ou représentant — **pas** l'immatriculation fiscale |
| `O` | BR-O-02 | **interdit** l'identifiant TVA vendeur |

**`O` rend une garde fondée sur le taux indéfendable** : taux 0, et elle *interdit* ce que les cinq
autres exigent. Une règle « taux 0 ⇒ identifiant TVA requis » aurait refusé des factures que la
norme interdit d'en porter un.

La garde porte donc sur la **catégorie résolue**, que le moteur calcule déjà, et la distinction
`K`/`G` est encodée plutôt qu'aplatie. **Cela referme aussi le trou de la correction de routage** :
FR→IT et FR→US sont exactement les flux corrigés en P2-T02/T03, et leurs taux zéro sont `AE`, `K` et
`G` — tous bloqués à la transmission par une règle que la garde domestique de C1 ne couvrait pas.

**Reste ouvert, nommé** : les exigences côté **acheteur** de `BR-AE-02` et `BR-IC-02`.

### C4 — le produit **sur-facture** la TVA sur une prestation intracommunautaire B2B *(nouveau)*

Trouvé en vérifiant que la garde C3 couvre bien l'export. Sondé sur le chemin **produit**
(`resolveInvoiceTax`), sans forcer de taux :

```
FR→IT B2B services, TVA acheteur fournie    cat=[S] taux=[20] TVA=20
FR→IT B2B services, sans TVA acheteur       cat=[S] taux=[20] TVA=20
FR→US B2B services                          cat=[O] taux=[0]  TVA=0
```

Une prestation de services B2B à un assujetti italien relève de l'**autoliquidation** — art. 44 de
la directive 2006/112, CGI art. 259-1° : le lieu d'imposition est en Italie, la France ne facture
rien, le preneur autoliquide. Le produit facture **20 % de TVA française**, catégorie `S`.

**Ce n'est pas le moteur.** `tax-matrix.spec.ts` prouve que `determineTax` rend correctement
l'autoliquidation — il l'appelle avec des identifiants `validated: true`. C'est le **câblage** :
`invoice-tax.ts:59-62` code en dur `validated: false as const`, et `TrustFlagVatValidator`
(`classification.ts:61`) n'ouvre l'autoliquidation que pour `validated === true`. Depuis le chemin
facture, **aucun numéro de TVA n'est jamais validé**, donc les catégories `AE` et `K` sont
**inatteignables en production**.

**Le choix est délibéré et documenté** : le commentaire explique qu'accepter un numéro non vérifié
laisserait n'importe qui saisir un faux numéro et obtenir 0 % — une **sous**-facturation. Ils ont
préféré la sur-facturation. C'est défendable comme garde-fou, mais la conséquence n'est écrite
nulle part : **le produit ne sait pas émettre une facture intracommunautaire B2B correcte**, et une
sur-facturation de TVA est elle aussi une erreur de conformité — le client paie une taxe non due et
la catégorie TVA de la facture est fausse.

**À ne pas « corriger » en basculant le drapeau** : ce serait rétablir exactement le risque que le
commentaire écarte. Le correctif est une **validation VIES réelle**, c'est-à-dire une tâche, pas un
booléen.

*Conséquence secondaire* : la branche `K` de la garde C3 est correcte et testée, mais **inatteignable
depuis le chemin facture** tant que C4 tient.

## Instabilité connue, non résolue

`ksef-transmission.spec.ts` — « transmit() receives the resolved config from the registry » et
« includes KSEF_NUMBER authority ID » échouent **par intermittence dans le run complet**, jamais
isolément (3 exécutions isolées de suite : 44/44). Taux observé ≈ 50 % sur 4 runs complets.

**Mécanisme plausible, non prouvé** : le test effectue une vraie tentative de transmission avec des
clés RSA invalides, donc du travail cryptographique sensible au temps sous charge parallèle. Ma
fixture d'artefacts alourdit la suite (construction de PDF), ce qui pourrait y contribuer — la
mémoïsation l'a réduit mais je n'ai pas mesuré l'effet.

**C'est une hypothèse, pas un diagnostic.** Consigné plutôt que supposé résolu ; à reprendre avec un
`--runInBand` ciblé pour confirmer ou infirmer la piste temporelle.

# Discipline permanente

- Suite backend **après chaque tâche**. Cypress après chaque tâche touchant le front, et en fin de phase.
- **Un remplacement de texte non matché échoue** — `assert old in s` avant chaque `replace`. Erreur commise deux fois le même jour.
- **Lire la sortie brute avant de traiter un symptôme.** Le plantage du renderer a coûté cinq tentatives ; la clé dupliquée était dans le log depuis le début.
- **`git add -A` est proscrit.** Chemins explicites. `CLAUDE.md` a été repris deux fois.
- **Ne présumer d'aucun artefact.** Une migration se vérifie contre Postgres ; un test contre son contenu, pas son nom ; un comptage ne vaut pas une lecture.
- **`tsc -b` est incrémental et ment.** Il a rapporté « compile » alors que `TransmissionRule` n'avait pas `appliesTo` ; 44 suites avaient déjà échoué à compiler. Utiliser `tsc --noEmit -p tsconfig.json` après avoir supprimé le cache, ou `npm run build`.
- **Ne jamais corriger un chiffre dans une sonde sans le corriger dans le texte publié.**
- **Ce document est mis à jour à chaque tâche terminée.** C'est ce qui permet de reprendre après interruption.

# Journal

| Date | Tâche | État | Note |
| --- | --- | --- | --- |
| 2026-08-28 | — | — | Plan écrit. Branche créée depuis `f71cfb9b`. 11 branches `fix/` supprimées du remote après vérification qu'elles sont ancêtres de `feat/compliance-architecture`. |
| 2026-08-28 | **P1-T01** | ✅ fait | `8b3f0aa2`. Deux tests rouges à dessein, comme le critère l'exige. |
| 2026-08-28 | **P1-T02** | ✅ fait | Mesure : 6 suites / 31 tests. Hypothèse des « 42 builders stub » **infirmée** — ce sont les tests du chemin français, port de rendu non injecté. P1-T03 découpée en a/b. |
| 2026-08-28 | **P1-T03a** | ✅ fait | `6a6d2d5c`. **Défaut de production** : `ComplianceService` n'était pas câblée avec `formats` — `sendViaChannel`, `archiveDocument` et `validate` opéraient sur des artefacts vides. Gardé par un test de métadonnées de module. |
| 2026-08-28 | **P1-T05** | ✅ fait | `e4fe5438`. G1.05 gardée à l'allocation, 19 tests, bornes 35/36 comprises. |
| 2026-08-28 | **P1-T06** | ✅ fait | `d2207df6`. Le job CI avait déjà Postgres ; seul le drapeau manquait. Vérifié dans les deux sens. |
| 2026-08-28 | **P1-T03b** | ✅ fait | `5024cf18`. Fixture de port extraite depuis `peppol-f7-reachability`. |
| 2026-08-28 | **P1-T03c** | ✅ fait | `7e899b9a`. Port **et** `externalRef` manquaient. |
| 2026-08-28 | **P1-T03d + P1-T04** | ✅ fait | `6a51ac48`. Sémantique conditionnelle au port ; garde d'élément racine. **Suite entièrement verte : 139 suites / 1837 tests / 0 échec.** |
| 2026-08-28 | **P2-V01** | ✅ fait | `447eb2f3`. Légifrance, source primaire. Critère **triple**, **deux** règles pour la France, art. 290 bien plus large que « transfrontalier », et articles **abrogés au 2027-01-01**. |
| 2026-08-28 | **P2-V02** | ✅ fait | `291a91c1`. Six pivots, 14 tests. Italie : `EITHER` confirmé. Espagne : une seule règle. |
| 2026-08-28 | **P2-T01** | ✅ fait | `c5dfc682`. Repli `?? 'FR'` supprimé des **deux** côtés ; le fournisseur n'était pas gardé du tout. Pas de migration : le champ existait. |
| 2026-08-28 | **P2-T02 + P2-T03** | ✅ fait | `0cf83366`. **Le routage français est corrigé** : FR→IT et FR→US passent de `DECENTRALIZED_CTC` + PDP à `REAL_TIME_REPORTING` + EMAIL. Profils non migrés inchangés (asserté PL→DE). |
| 2026-08-28 | **P2-T08** | ✅ fait | `96ecaf0f`. BT-23 dérivé du contenu. `M1` en dur était **faux 2 fois sur 3**, pas absent. |
| 2026-08-28 | **⏸ PHASE 2 CLOSE** | — | **Point d'arrêt atteint.** Le modèle est présenté ; la phase 3 attend le feu vert. |
| 2026-08-28 | **C4 branché** | ✅ fait | `e5877c59`. C4 était *prêt*, pas *fait* : rien n'écrivait `validationStatus`, le client n'était pas dans le graphe DI. Validation **à la saisie**, seuil de revalidation 90 j, jeton d'injection requis. Preuve : test de **chaîne** (numéro saisi → facture `AE` à 0 %), pas test de port. |
| 2026-08-28 | **C4 / garde-fou test** | ✅ fait | `a5178898`. Le câblage faisait appeler VIES par chaque création de client en e2e — il cassait une décision déjà écrite dans `16-company-lookup.cy.ts` (« a CI job must never depend on INSEE or VIES being up »). `NullVatValidationClient` sous `NODE_ENV=test` : `UNAVAILABLE`, ce qui est **vrai**. |
| 2026-08-28 | **§3 — moitié acheteur** | ✅ fait | `53709b92`. BR-AE-02 et BR-IC-02 sont des **conjonctions** ; seul le côté vendeur avait été lu. AE accepte l'identifiant légal, K exige le numéro de TVA. Portée annoncée : défense en profondeur, pas un blocage vivant aujourd'hui. |
| 2026-08-28 | **§4 — dette BR-Z-02** | ✅ fait | `0dd01abd`. C'est `08-payments.cy.ts`, sur `POST /invoices/send`. Cause : `invoice-rendering.service.ts:358` redérive la catégorie **du taux** — 3 sorties pour un moteur qui en produit 5. **3 cas sur 5 divergent**, mesuré sur le XML rendu. Spec d'observation verte à inverser quand le rendu consommera le plan. |
| 2026-08-28 | **§1 — catégorie depuis le plan** | ✅ fait | `571f06c1` + `2244a694`. BT-151 résolue par le moteur, **persistée** sur la ligne, **lue** par le rendu ; absente ⇒ refus. BR-O-05 et BR-O-02 appliquées. Cas `O` : **valide, zéro erreur**, avec et sans identifiant vendeur. Assertions inversées. Dérivation depuis le taux : **10 sites, pas 3**. |
| 2026-08-28 | **§2 — isolation e2e** | ✅ fait | `9f74e7e2`+. Un seul `resetDatabase` pour 17 specs ⇒ 11/9/13 échecs selon l'ordre. Reset+seed par spec. Trois ordres : **2, 2, 2 échecs**, tous le même plantage Electron. |
| 2026-08-28 | **§3 — spec 17** | ✅ fait | `3f3c54f4`. Ni la mémoire, ni la spec 17 : plantage **Electron** sur un select Radix, localisé par instrumentation côté Node. **Firefox : 17/17.** |
| 2026-08-28 | **§4 — inventaire** | ✅ fait | `ae4a2d82`. `12-SUPPRESSION.md`. 79 fichiers / 2 064 lignes certains. Blocage réel : le schéma ne sait pas dire « pas de sortie ». |
| 2026-08-28 | **Vérification sur HEAD** | ✅ fait | La présomption laissée au rapport précédent est levée. Electron : **2 échecs, tous deux le plantage** (`grep -c` = 2). **Firefox : 167/167, 17 specs sur 17** — suite complète verte pour la première fois. Backend 1 926, `biome ci` 0/0, build frontend, i18n. |
| 2026-08-28 | **Phase 2 rouverte** | ⚠️ | Le journal comptait **P2-T03 fait** ; le corps de tâche disait « à faire » et **le code confirmait** — `plan.obligations` n'existait pas. `0cf83366` avait livré le *résultat* de routage (tableau de P2-T07), pas la structure de T03. Journal dérivé de l'arbre, publié tel quel. |
| 2026-08-28 | **P2-T03** | ✅ fait | `85c2e74a`. `obligations` plurielles ; `regime` conservé en adaptateur ; 12 tests. |
| 2026-08-28 | **P2-T04/T05/T06** | ✅ fait | `558f88a4`. 16 lecteurs migrés, **`plan.regime` supprimé**. Lot 3 vide — `execution.regime` est un autre objet. Un test devenu tautologique (`x === x`) réécrit plutôt que laissé vert. |
| 2026-08-28 | **P2-T07** | ✅ fait | `fed4c693`. Tableau des quatre flux complet, rouge-avant/vert-après vérifié. **`PHASE 2 CLOSE`, pour de bon.** Et une correction : ma vérification précédente était fausse — le chemin de données existait, `transmitStatus()` l'emprunte ; la suite m'a corrigé. |
| 2026-08-28 | *(historique)* **P1-T03d** | ↩ tenté, annulé | Mesure P1-T02 corrigée : 8 suites / 52 tests, pas 6/31 — je n'avais inversé qu'un des cinq court-circuits. Redécoupée en T03b/c/d. |
