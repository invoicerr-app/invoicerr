# Invoicerr — Architecture du cycle de vie de la facture par juridiction (retiré)

> **Retiré le 2026-08-29.** Ce document était un RFC compagnon de `COMPLIANCE_ARCHITECTURE.md`,
> proposant un cycle de vie par juridiction **composé** à partir de contributeurs de phase (émission,
> *clearance*, livraison, réponse acheteur, reporting, corrections) et interprété par un runtime
> événementiel (`lifecycle/assembler.ts`, `lifecycle/runtime.ts`) consommant des signaux (`COMMAND`,
> `AUTHORITY_ACK`, `POLL_RESULT`, `INBOUND_STATUS`, `TIMER_ELAPSED`). Ce runtime — tout le répertoire
> `backend/src/compliance/lifecycle/` — a été supprimé avec le reste du moteur de conformité par le
> commit `fffbae77` (« refactor!: suppression des documents légaux et du moteur de conformité »).
> Aucun graphe de cycle de vie composé par juridiction n'existe dans ce dépôt aujourd'hui.

## Ce qui existe à la place

Une seule machine à états de statut de document, générique et indépendante du pays :
`backend/src/modules/documents/descriptors/lifecycle.ts`. Un `DocumentTypeDescriptor` déclare ses
propres `statuses`/`initialStatus`, une action déclare ses `transitions`, et le module garantit
qu'un handler ne peut jamais persister un statut que son propre type n'a pas déclaré — pour chaque
type de document (facture, devis, avoir, dépense, facture reçue) de la même façon, sans aucune
dimension pays.

La nuance de cycle de vie propre à un pays survit à exactement trois endroits, aucun n'étant un
graphe composé :
- `correction-routes/` — quelle voie de correction (avoir, annulation et remplacement, …) un pays
  autorise.
- `conformity/pollers/` — l'interrogation du statut côté autorité après envoi, câblée par
  **transport** (pdp, ksef, sdi, peppol, chorus-pro, anaf, face), jamais par pays.
- `archive/retention/` — la durée de rétention, pour la France uniquement.

Voir la section « The documents module » de `CLAUDE.md` pour l'architecture actuelle, et le tag
`avant-refonte-documents` pour lire le code source du runtime supprimé.
