# Plan — Câblage complet du flow compliance dans le frontend

> Objectif : le frontend lit le **flow réel** (par juridiction / canal) depuis le backend et
> l'UI s'y adapte. Plus de libellés codés en dur ("Envoyer par mail") quand le canal n'est pas
> l'email. Le pipeline de progression, les boutons d'action et les états d'attente reflètent le
> lifecycle compliance effectif du document.

État au 2026-06-27. Branche : `feat/compliance-architecture`.

---

## Constat

Le **backend lifecycle est déjà câblé de bout en bout** :
- `complianceService.send()` choisit `SUBMIT_CLEARANCE` (régime bloquant) vs `DELIVER` (non
  bloquant) selon `plan.regime.blocking` — `compliance-service.ts:206`.
- `LifecycleRuntime.availableActions()` / `pendingDrivers()` exposent les transitions MANUAL et les
  drivers armés (poll/timer/callback) — `lifecycle/runtime.ts:42-51`.
- Le canal primaire et son `feedback` (SYNC / ASYNC_POLL / ASYNC_CALLBACK / NONE) sont résolus par
  `phaseContextFromPlan()` — `lifecycle/assembler.ts:21`.
- `plan.channels[0]` (type `ChannelType` : EMAIL, PEPPOL, SDI, PAC, OSE, GOV_PORTAL_API, PDP, PRINT)
  porte le canal — `types.ts:101`.

Le **gap est côté frontend** : l'UI est email-centrique et codée en dur.
1. `invoice-view.tsx` — bouton "send" générique, libellé toujours "email".
2. `invoice-progression.tsx` — pipeline figé `draft→issued→sent→paid→archived` ; les états
   clearance (PENDING_CLEARANCE/CLEARED) sont bricolés mais le pipeline n'est pas data-driven.
3. `invoice-list.tsx` — icônes d'action (mail, correct, cancel) conditionnées par `invoice.status`
   en dur, pas par les actions réellement permises.

---

## Pièce maîtresse : un descripteur de flow

Un helper **pur** `describeFlow(plan, status)` (aucune I/O) qui transforme un `CompliancePlan` +
`ComplianceStatus` en un descripteur consommable par l'UI. Réutilisé par :
- `getAvailableActions` (1 facture, complet) — le dialog de vue + la progression à la demande.
- `getInvoices` (liste, dérivé du `plan` JSON déjà stocké, sans migration) — la liste + progression.

### Forme (backend → frontend)

```typescript
type ChannelClass = 'EMAIL' | 'CLEARANCE' | 'PEPPOL' | 'PORTAL' | 'PRINT';

interface FlowDescriptor {
  primaryChannel: { type: ChannelType; providerId?: string; feedback: ChannelFeedback };
  channelClass: ChannelClass;
  sendLabelKey: string;            // 'sendByEmail' | 'submitClearance' | 'sendViaPeppol' | 'sendToPortal' | 'print'
  awaiting: 'CLEARANCE' | 'BUYER_RESPONSE' | 'DELIVERY' | null;
  pipeline: string[];             // step keys ordonnés pour la barre de progression
  terminal: boolean;
}
```

### Règles de dérivation

`channelClass` depuis `plan.channels[0].type` + `plan.regime.blocking` :
| ChannelType | blocking | channelClass | sendLabelKey |
|-------------|----------|--------------|--------------|
| EMAIL | – | EMAIL | sendByEmail |
| PRINT | – | PRINT | print |
| PEPPOL | false | PEPPOL | sendViaPeppol |
| SDI / PAC / OSE / GOV_PORTAL_API / PDP | true | CLEARANCE | submitClearance |
| SDI / PAC / OSE / GOV_PORTAL_API / PDP | false | PORTAL | sendToPortal |

`awaiting` depuis `status` + `runtime.pendingDrivers()` :
- `PENDING_CLEARANCE` ou `CONTINGENCY` avec un driver POLL/CALLBACK armé → `CLEARANCE`
- `AWAITING_RESPONSE` → `BUYER_RESPONSE`
- canal avec feedback async en attente de livraison → `DELIVERY`
- sinon `null`

`pipeline` (step keys) par `channelClass` :
- `EMAIL` / `PRINT` : `["draft","issued","sent","paid","archived"]`
- `CLEARANCE` : `["draft","issued","pending_clearance","cleared","sent","paid","archived"]`
- `PEPPOL` / `PORTAL` : `["draft","issued","delivered","paid","archived"]`

`terminal` : `runtime.availableActions().length === 0 && pendingDrivers().length === 0` ou statut
terminal (`CANCELLED`/`CORRECTED`/`REJECTED`/`REFUSED`/`REPORTED`).

---

## Phases

### Phase 1 — Backend : `describeFlow` + câblage (FONDATION)
- Nouveau fichier `backend/src/compliance/lifecycle/flow-descriptor.ts` : `describeFlow(plan, status)`
  pur + helper `channelClassOf(plan)`. Tests unitaires `flow-descriptor.spec.ts`.
- `getAvailableActions` : ajoute `flow: FlowDescriptor` à la réponse. Remplace `send: boolean` par
  un `send` conscient du canal (garder le booléen pour compat + ajouter `sendLabelKey` via `flow`).
- `getInvoices` : sélectionne `plan` dans `complianceDocuments`, calcule `flow` slim par facture, et
  **remplace** `plan` par `{ channelClass, sendLabelKey, awaiting }` avant de renvoyer (payload léger,
  pas de migration).

### Phase 2 — Frontend : types + i18n
- `use-available-actions.ts` : étendre `AvailableActions` avec `flow?: FlowDescriptor`.
- `types/invoice.ts` : `complianceDocuments[].flow?` slim sur les items de liste.
- i18n (`invoices.view.actions.*` et nouveau `invoices.flow.*`) : `sendByEmail`, `submitClearance`,
  `sendViaPeppol`, `sendToPortal`, `print`, et libellés d'attente `awaitingClearance`,
  `awaitingBuyerResponse`, `awaitingDelivery`. Ajouter dans **en** et **fr** (les autres locales en
  fallback EN).

### Phase 3 — Frontend : `invoice-view.tsx` send conscient du canal
- Le bouton send affiche le libellé via `actions.flow.sendLabelKey` + icône adaptée
  (Mail/UploadCloud/Send/Printer).
- Bandeau d'attente quand `actions.flow.awaiting` est non nul (ex. "En attente de validation
  administrative").
- (déjà fait dans une passe précédente : URL `POST /api/invoices/send` + check `res.ok`.)

### Phase 4 — Frontend : `invoice-progression.tsx` pipeline data-driven
- Le pipeline rendu vient de `flow.pipeline` (par facture) au lieu de la constante figée.
- `stepColors` complété pour `delivered`, `pending_clearance`, `cleared` (déjà ajoutés).
- L'action de la ligne utilise `flow.sendLabelKey` ; badge d'attente quand `flow.awaiting`.

### Phase 5 — Frontend : `invoice-list.tsx` actions par ligne
- Les icônes (mail/correct/cancel) viennent du `flow`/actions de la ligne (via le `flow` slim de la
  liste) plutôt que de `invoice.status` en dur. Libellé du tooltip d'envoi adapté au canal.

---

## Ordre de livraison
PR 1 = Phases 1+2+3 (slice verticale du bouton send — règle l'exemple "pas de Envoyer par mail si
ce n'est pas du mail"). PR 2 = Phase 4. PR 3 = Phase 5.

## Invariants à respecter
- `describeFlow` reste **pur** (pas de DB/réseau) — testable et réutilisable liste + détail.
- Tout reste non bloquant : si `plan`/compliance absent, fallback EMAIL (comportement actuel).
- Pas de migration Prisma (on dérive du `plan` JSON déjà stocké).
- i18n : pas de libellé en dur dans le TSX.
</content>
