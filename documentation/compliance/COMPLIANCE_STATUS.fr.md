# Compliance — État d'implémentation (retiré)

> **Retiré le 2026-08-29.** Ce document suivait l'avancement d'implémentation du **moteur de
> conformité** — `backend/src/compliance/` (cœur de résolution, providers format/transmission/
> signature/archivage, runtime de cycle de vie événementiel, câblage NestJS sous `ComplianceModule`/
> `ComplianceCoreModule`). Cet arbre entier a été supprimé par le commit `fffbae77` (« refactor!:
> suppression des documents légaux et du moteur de conformité », ~298 000 lignes retirées) : plus
> aucun des éléments de suivi ci-dessous ne correspond à du code présent dans ce dépôt.

## Où se trouve l'état actuel

- L'architecture actuelle (les catalogues qui ont remplacé le moteur, et ce qui survit — ou non — de
  l'ancien cycle de vie) est décrite dans la section « The documents module » de `CLAUDE.md`.
- L'état d'implémentation par canal et par format (quels canaux de transmission sont prouvés en
  réel, lesquels sont implémentés en attente d'identifiants, lesquels restent des stubs) est suivi
  dans `COMPLIANCE_TODO.md`, à la racine du dépôt.
- La posture de conformité NF-525 (inaltérabilité, piste d'audit, chaînage de hachage, rétention,
  archivage, numérotation sans trou) est désormais une propriété directe du module documents — voir
  les modules listés dans `CLAUDE.md` (`descriptors/lifecycle.ts`, `archive/`, `numbering/`) plutôt
  que d'un moteur de conformité séparé.

Le tag `avant-refonte-documents` (`git show avant-refonte-documents:...`) permet de retrouver le
code source du moteur supprimé pour toute recherche archéologique.
