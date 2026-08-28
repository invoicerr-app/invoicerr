# 11 — France B2B : ce qui manque, ordonné

> Liste de travail, pas d'audit. Ordonnée par **ce qui bloque quoi**, pas par gravité. Chaque ligne
> porte son bloqueur et son coût ; un coût sans bloqueur nommé serait une estimation en l'air.
>
> Coûts en jours de développement, hors obtention de credentials, qui n'est pas un travail de dev.
> Les lignes marquées **⛔** ne peuvent pas démarrer avant que leur bloqueur tombe.

---

## A. Ce qui empêche d'émettre une facture française juste

| # | Manque | Bloqué par | Coût |
| --- | --- | --- | --- |
| **A1** | **Le déclencheur bilatéral.** Une facture FR→étranger est routée en `DECENTRALIZED_CTC` vers un PDP, au lieu de l'e-reporting. Deux flux français sur quatre produisent un plan faux. | rien — conception faite (`08-CORRIDOR-MODEL.md`) | **7–12 j** |
| **A2** | **E-invoicing et e-reporting disjoints.** F1 contre F10, statuts 200/210/212/213 contre 300/301, 24 h contre périodique, avoir contre remplacement de période. Le moteur n'en produit qu'un. | A1 (même modèle) | inclus dans A1 |
| **A3** | **`establishmentIntervening` sur l'opération.** `countryCode` vient de la société avec repli **silencieux** sur `'FR'` (`invoices.helpers.ts:130`, `:136`). Une société sans pays devient française et tombe dans le mandat. | rien | **2–3 j** |
| **A4** | **BT-23 en cardinalité 1..1** — catégorie d'opération biens/services. Son absence fait échouer les contrôles fonctionnels PPF. | rien ; valeurs limitatives à dériver du type d'opération | **2–3 j** |
| **A5** | **Contrainte de format du numéro** : 35 caractères, caractères spéciaux limités. Sans elle, rejet du flux F1. | rien | **0,5 j** |
| **A6** | **Artefact vide accepté.** `providers.ts:145` court-circuite la validation quand `bytes.length === 0`. Un document de zéro octet traverse build → validate → archivage. | rien — **un** endroit à retourner | **1 j** |

## B. Ce qui empêche de prouver qu'elle est juste

| # | Manque | Bloqué par | Coût |
| --- | --- | --- | --- |
| **B1** | **Le chaînage de hash générique n'est pas vérifié.** Le profil FR exige `hashChain: true`. Le code chaîne (`compliance-service.ts:244-251`) mais le seul test assert `toBeDefined()`. Personne ne sait si la chaîne relie. | rien — le modèle existe : `verifactu-chain.spec.ts` fait exactement ça pour l'Espagne | **1–2 j** |
| **B2** | **Factur-X n'est pas validé.** Le XML embarqué dans le PDF/A-3 n'est jamais extrait ; c'est la copie remise à l'acheteur. | rien ; extraction de pièce jointe PDF/A-3 | **2–3 j** |
| **B3** | **Un test dont le nom ment.** `it('rejects completely empty XML')` assert `errorCount === 0`. Il documente le trou sous un nom qui affirme l'inverse. | rien | **0,5 j** |
| **B4** | **Le CAS de numérotation n'est pas exercé en CI.** Le test TOCTOU est derrière `COMPLIANCE_LIVE_DB_TESTS`, positionné seulement dans un workflow `workflow_dispatch`. La séquence gapless française repose dessus. | rien — **correction : le job `queue-integration` a déjà Postgres 16, `DATABASE_URL` et `prisma migrate deploy`**. Il ne manque qu'un drapeau et un motif de test | **0,25 j** |

## C. Ce qui empêche de la transmettre

| # | Manque | Bloqué par | Coût |
| --- | --- | --- | --- |
| **C1** | ⛔ **Aucun port HTTP n'est injecté en production.** La couture existe et fonctionne — les specs live injectent un port réel — mais `registry.ts` ne passe que des credentials. Aucun canal ne peut émettre. | **credentials PDP** | **1–2 j** une fois débloqué |
| **C2** | ⛔ **`PROVEN` n'est pas falsifiable.** Aucun accusé d'autorité versionné : ni UPO, ni ricevuta, ni accusé PDP. La maturité déclarée du canal PDP repose sur de la prose. | un aller-retour réel | **0,5 j** de versionnement |
| **C3** | **Le runtime n'a jamais été actionné par une autorité.** Câblé, testé contre des doubles, corrélation sur référence externe prouvée — jamais éprouvé par un webhook réel. | C1 | 0 j de code |
| **C4** | **`GOV_PORTAL_API/choruspro` est dans le profil FR post-mandat** alors qu'il ne peut rien émettre (port stub codé en dur). Le plan propose un canal mort. | décision : B2G maintenant ou plus tard | **0,5 j** |

## D. Ce qui manque au produit autour de la facture

| # | Manque | Bloqué par | Coût |
| --- | --- | --- | --- |
| **D1** | **Sortie de `REJECTED`.** L'état est terminal (`REJECTED: {}`). Après un rejet PPF, l'utilisateur n'a ni re-soumission, ni correction, ni annulation. C'est F-007. | règles par pays divergentes — mais **la France seule suffit à démarrer** | **3–5 j** |
| **D2** | **L'avoir interne.** `correctionModel: 'CREDIT_NOTE'` est déclaré ; le chemin produit existe pour la facture rectificative, pas pour l'avoir en tant que tel dans le flux CTC. | A2 (l'avoir et le remplacement de période sont deux objets) | **2–3 j** |
| **D3** | **Journal non append-only en base.** Rien n'empêche `UPDATE`/`DELETE` sur `ComplianceEvent`. La promesse d'événementiel est architecturale, pas garantie. C'est F-005. | rien — révocation de droits ou trigger | **1 j** |
| **D4** | **Aucun runner de test frontend.** Quatre défauts frontend en une session, tous invisibles au backend, tous trouvés par la première spec e2e. | rien | **2–3 j** |

---

## Ordre recommandé

1. **A5, A6, B3, B4** — quatre lignes à 0,5–1 j qui retirent des trous nets. **2,5 j au total.**
2. **A3** puis **A1/A2** — le chemin critique. Sans le déclencheur, tout le reste est construit sur un plan faux pour deux flux sur quatre.
3. **A4** — échéance PPF.
4. **B1, B2** — la preuve. B1 a un modèle déjà écrit à copier.
5. **D1** — dès qu'un rejet est possible, ne pas savoir en sortir devient bloquant.
6. **C1–C3** quand les credentials tombent ; **C4** est une décision, pas un développement.
7. **D3, D4** en fond.

**Total hors credentials : environ 26 à 39 jours** (révisé depuis 30–45 après comptage réel des lecteurs de `plan.regime` — 16, pas ~40 — et vérification du job CI). L'incertitude est concentrée sur A1 (l'adaptateur
de compatibilité, ~40 sites lisent `plan.regime`) et sur D1 (dont le périmètre dépend d'un arbitrage
métier autant que technique).
