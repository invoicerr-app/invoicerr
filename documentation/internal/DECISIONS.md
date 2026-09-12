# Décisions prises en autonomie

Une décision par entrée : ce qui a été tranché, pourquoi, et ce qui la rouvrirait. Les arbitrages
rendus par le mandant vivent dans la passation, pas ici. Ce qui revient au mandant et à lui seul —
les 118 pages Docusaurus, la bascule CI vers Firefox, un avertissement aux utilisateurs, tout ce qui
engage juridiquement — n'est **pas** tranché ici : c'est posé en question.

---

## D-001 — `archival.retentionYears` reste à 10 ans, la couche déclare 6

**Date** : 2026-08-28 · **Tâche** : P2-T02

Le profil français retient **10 ans**. La couche `ARCHIVAL` que P2-T02 ajoute déclare **6 ans**,
LPF art. L102 B — la durée **fiscale**, celle à laquelle un mandat de facturation électronique
s'attache. `03-LEGAL-VERIFICATION.md` signale l'écart comme **FR-D9** : les 10 ans relèvent du droit
commercial (C. com. art. L123-22), sur sa propre horloge, et les confondre est « approximatif et mal
fondé ».

**Décidé** : je ne change pas `retentionYears`. Le faire **réduirait** ce que le produit conserve,
de 10 à 6 — un changement de comportement à conséquence juridique, dans le sens du moins-disant.
Une durée trop longue ne met personne en défaut ; une durée trop courte, si.

**Ce qui la rouvre** : une décision explicite sur ce que le runtime doit appliquer. Les deux durées
sont réelles et répondent à deux obligations distinctes ; le produit devrait probablement porter les
deux plutôt que d'en choisir une. `openQuestion` sur la couche `ARCHIVAL` porte la trace.

---

## D-002 — les échéances de P2-T02 ne sont pas branchées, et c'est la phase 3 qui les branchera

**Date** : 2026-08-28 · **Tâche** : P2-T02

Un mécanisme d'échéance **existe déjà** et fonctionne : `deadlineHours` sur les transitions du cycle
de vie, consommé par `lifecycle/drivers/timer-scheduler.ts` et `nest/apply-signal.ts`, qui arment de
vrais minuteurs. La couche `obligations[].deadline` que j'ajoute est une **seconde représentation que
rien ne lit**.

**Décidé** : je la livre quand même, et je la nomme telle quelle. Le critère d'acceptation de P2-T02
porte sur le **modèle** — que le profil français exprime ses trois couches avec leurs échéances — et
la consommation est l'objet de la phase 3, « machine à états dérivée du profil ». Livrer le modèle
sans le brancher est ici l'ordre voulu, pas un oubli.

**Ce qui la rouvre, et le risque à surveiller** : c'est exactement la forme « saine mais non
branchée » que l'audit reproche au dépôt, et que j'ai déjà reproduite deux fois (`ComplianceService`
sans `formats`, `ViesVatValidationClient` non câblé). La phase 3 doit **relier** `obligations[].
deadline` au `deadlineHours` existant, pas en construire un troisième. Si elle en construit un
troisième, cette entrée est le témoin que je l'avais vu venir.
