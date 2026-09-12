# Ordre d'implémentation des stubs — formats puis envois (retiré)

> **Retiré le 2026-08-29.** Ce document listait, dans l'ordre, les stubs de format et de canal à
> rendre réels dans le moteur de conformité — `backend/src/compliance/providers/{format,
> transmission}/`. Cet arbre entier a été supprimé par le commit `fffbae77` (« refactor!: suppression
> des documents légaux et du moteur de conformité », ~298k lignes retirées) : les chemins, les
> stubs et l'index de contrôle des 106 juridictions cités ci-dessous ne correspondent plus à aucun
> code de ce dépôt.

## Où se trouve l'état actuel

- L'architecture actuelle (les catalogues qui remplacent le moteur, ce qui subsiste — ou non — du
  cycle de vie) est décrite dans la section « The documents module » de `CLAUDE.md`.
- L'état réel par canal et par format (quel canal est prouvé en live, lequel est implémenté en
  attente d'identifiants, lequel est un stub) est suivi dans `COMPLIANCE_TODO.md`, à la racine du
  dépôt.

Le tag `avant-refonte-documents` (`git show avant-refonte-documents:...`) permet de retrouver le
code source du moteur supprimé pour qui ferait de l'archéologie.
