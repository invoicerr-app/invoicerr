# Invoicerr — Architecture du cycle de vie de la facture par juridiction

*Français · [English](COMPLIANCE_LIFECYCLE.md)*

> **Statut :** Conception / RFC — document compagnon de [`COMPLIANCE_ARCHITECTURE.md`](COMPLIANCE_ARCHITECTURE.fr.md) (étend §11 / §11.1).
> **Problème résolu :** la *vie* d'une facture diffère selon le **pays émetteur**, le **pays destinataire**, et
> le **canal de transmission**. Une facture *clearée* via une *PDP* française ne vit pas comme une facture
> envoyée par email, qui elle-même ne vit pas comme une facture Peppol : certaines doivent être
> **interrogées périodiquement** (*polling*) pour connaître leur statut, d'autres sont
> **validées automatiquement**, d'autres attendent une **réponse de l'acheteur** (avec *silence = acceptation*),
> d'autres doivent **être validées par une autorité avant même d'être valides**.
>
> Ce document définit une architecture unique qui produit un **cycle de vie différent et correct par
> `(émetteur, destinataire, canal)`** sans aucun `if (country)` dans le code métier.

---

## 1. L'idée centrale — le cycle de vie est *composé*, puis *interprété*

Nous arrêtons de modéliser le cycle de vie comme **une seule** machine à états fixe. Il se décompose à
la place en **trois axes orthogonaux**, chacun alimenté par des données que nous résolvons déjà :

| Axe | Question | Source |
| --- | --- | --- |
| **1. Phases** | *Quelles étapes existent ?* | composé : **régime** de l'émetteur + **obligations** du destinataire + rôles |
| **2. Drivers** | *Comment une étape avance-t-elle ?* (sync / poll / callback / timer / manual) | le **feedback model** du fournisseur de canal résolu |
| **3. Runtime** | *Qu'est-ce qui la fait vivre dans le temps ?* | un interpréteur durable, *event-sourced*, + scheduler + inbox + outbox |

> La vie d'une facture = `assemble(phases) × bind(drivers) → interprétée par le runtime`.
> `FR→IT`, `MX→MX`, `US→FR` produisent des **vies différentes à partir d'un seul moteur** — par
> composition, et non par énumération.

C'est le même ADN que le reste du système (`COMPLIANCE_ARCHITECTURE.md` §4) : *un pays est une donnée*.

---

## 2. Axe 1 — Les phases sont des contributeurs composables

Plutôt qu'un graphe d'enum figé, chaque **phase** est un contributeur pur qui, à partir du
`CompliancePlan` résolu, renvoie un *fragment* du graphe (états + transitions) ou `null` quand elle ne
s'applique pas. Cela reprend le pattern handler+registry déjà utilisé par `regimes/` et `reporting/`.

```ts
interface PhaseFragment { states: ComplianceStatus[]; transitions: TransitionSpec[]; }

interface PhaseContributor {
  id: string;
  contributes(plan: CompliancePlan, pctx: PhaseContext): PhaseFragment | null;
}
```

Contributeurs (chacun conditionné par le plan) :

| Contributeur | Ajoute | Conditionné par | Apporté par |
| --- | --- | --- | --- |
| **Issuance** | `DRAFT → ISSUED` (numéro, hash, gel) | toujours | — |
| **Clearance** (*la facture doit être validée par l'autorité avant d'être juridiquement valide*) | `ISSUED → PENDING_CLEARANCE → CLEARED \| REJECTED`, `CONTINGENCY` | `regime.blocking` | **émetteur** |
| **Delivery** | `→ DELIVERED` | toujours | émetteur/canal |
| **BuyerResponse** | `DELIVERED → AWAITING_RESPONSE → ACCEPTED \| REFUSED \| DISPUTED` | `lifecycle.response` / mandat du destinataire | **destinataire** (+ émetteur pour les statuts FR) |
| **Reporting** | `→ REPORTED` (parallèle) | `reporting[]` non vide | émetteur |
| **Corrections** | overlay manuel `CANCEL` / `CORRECT` | `lifecycle.cancellation` / `correctionModel` | les deux |

> **Émetteur *et* destinataire** : l'émetteur apporte ses phases de *clearance*/e-reporting ; le
> destinataire apporte sa phase « doit accepter / accuser réception ». Le graphe final est l'**union
> composée** — c'est précisément ainsi que « le cycle de vie en fonction de l'émetteur et du
> destinataire » est résolu *structurellement*.

---

## 3. Axe 2 — Les drivers : pourquoi *superpdp ≠ email ≠ peppol*

Une transition ne déclare pas seulement `from → to` mais aussi **comment elle est déclenchée** :

```ts
type Trigger =
  | { kind: 'IMMEDIATE' }                                       // synchronous, inline result
  | { kind: 'POLL';     poll: PollPolicy; channelProviderId? } // ask the third party periodically
  | { kind: 'CALLBACK'; correlationKey? }                       // wait for an inbound webhook / notifica
  | { kind: 'TIMER';    deadlineHours?; onElapse }              // silence = acceptance
  | { kind: 'MANUAL';   action }                                // user / API command
  | { kind: 'CONTINGENCY' };                                    // authority outage
```

**Le trigger est résolu à partir du fournisseur de canal, pas du pays.** Chaque `TransmissionProvider`
déclare un **feedback model** :

```ts
interface TransmissionProvider {
  // …
  feedback?: 'SYNC' | 'ASYNC_POLL' | 'ASYNC_CALLBACK' | 'NONE';
  pollPolicy?: { everySeconds: number; timeoutHours: number; backoff?: 'NONE' | 'EXPONENTIAL' };
}
```

| Provider | `feedback` | Driver résultant pour sa phase |
| --- | --- | --- |
| `email` | `NONE` | Delivery = `IMMEDIATE` |
| `peppol` | `ASYNC_CALLBACK` | Invoice Response / MLR `CALLBACK` |
| **`pdp` / une « super PDP »** | `ASYNC_CALLBACK` **ou** `ASYNC_POLL` | statuts poussés *ou* interrogés (*polled*) — **c'est l'instance du provider qui décide** (deux PDP françaises peuvent différer) |
| `pac` (MX) | `ASYNC_POLL` | *clearance* `POLL` |
| `sdi` (IT) | `ASYNC_CALLBACK` | notifiche `CALLBACK` |
| `gov-portal` / national | `ASYNC_POLL` | *clearance*/déclaration `POLL` |

Ainsi « interroger périodiquement un tiers pour connaître le statut » = `POLL` lié à `provider.poll()` ;
« validée automatiquement » = `IMMEDIATE` ou `TIMER`. **Même phase, driver différent, choisi par le
canal.**

---

## 4. Axe 3 — Le runtime : un interpréteur durable, *event-sourced*

La machine est **interprétée, pas codée en dur**, et la vie d'une facture est un **journal d'événements
append-only** (`ComplianceEvent`) ; `complianceStatus` n'est qu'une **projection**. Cela donne l'audit
légal + le replay gratuitement.

```ts
// 1. At issuance: assemble the graph and FREEZE it with the profile version.
const graph = assembleLifecycle(plan, pctx);   // compose fragments + bind drivers
invoice.lifecycleSnapshot = graph;             // immutable → lives by the rules of ITS issue date
invoice.profileVersion   = 'FR@1.0';

// 2. The runtime processes SIGNALS (commands + inbound), never direct mutations.
type LifecycleSignal =
  | { type: 'COMMAND'; event: ComplianceEvent }          // issue/send/cancel/correct
  | { type: 'AUTHORITY_ACK'; cleared: boolean }
  | { type: 'POLL_RESULT'; status: 'CLEARED' | 'REJECTED' | 'PENDING' }
  | { type: 'INBOUND_STATUS'; status: string }           // déposée / refusée / encaissée …
  | { type: 'TIMER_ELAPSED' };

dispatch(signal) ⇒ find legal transition in the graph ⇒ apply ⇒ append event ⇒ schedule next drivers.
```

Le driver de la transition *suivante* devient une infrastructure générique — **trois mécanismes, une
seule implémentation chacun, réutilisés par tous les pays** :

| Trigger | Mécanisme générique | Statut dans le repo |
| --- | --- | --- |
| `POLL` | un **scheduler** enfile un job récurrent → `provider.poll()` → émet `POLL_RESULT` | scheduler TODO ; `poll()` ✅ |
| `CALLBACK` | un **inbound router** (webhook/SSE depuis PDP/SdI/AP) → émet `INBOUND_STATUS` | embryon `reception/` ✅ |
| `TIMER` | le même scheduler arme une échéance → émet `TIMER_ELAPSED` (silence=acceptation) | scheduler TODO ; `ResponseTracker` ✅ |
| sortant | l'**outbox** at-least-once + idempotence | §13 prévu |

Tout est durable (l'état, les polls planifiés, les timers, l'outbox) → un crash ne perd ni ne double
une transition.

---

## 5. Preuve par composition (un seul moteur, des vies différentes)

| Émetteur (canal, feedback) → Destinataire | Vie assemblée |
| --- | --- |
| **FR (pdp, CALLBACK)** → FR B2B | Issue → Deliver(PDP) → AWAITING{`déposée`,`approuvée`/`refusée`,`encaissée` + silence TIMER} ∥ Reporting |
| **MX (pac, POLL)** → MX B2B | Issue → PENDING_CLEARANCE{POLL} → CLEARED → Deliver(≤72h) ; annulation ⇒ requiert buyerConsent |
| **US (email, NONE)** → FR | Issue → Deliver{IMMEDIATE} → terminé (indicateur de self-assessment de l'acheteur) |
| **CL (gov, POLL)** → CL | Issue → clear{POLL} → Deliver → AWAITING{TIMER 8j ⇒ ACCEPTED} |
| **DE (peppol, CALLBACK)** → DE B2G | Issue → Deliver(Peppol) → AWAITING{MLR CALLBACK} → ACCEPTED |

Aucun de ces cas n'est un cas particulier dans le code — chacun est `assemble(phases) × bind(drivers)`.

---

## 6. Persistance (*event-sourced*) et correction temporelle

- Les lignes **`ComplianceEvent`** sont la source de vérité (append-only). `Invoice.complianceStatus`
  est une projection reconstruite à partir d'elles.
- **`Invoice.lifecycleSnapshot`** (le graphe assemblé) + **`profileVersion`** sont gelés à l'émission,
  afin que le document continue de vivre selon les règles en vigueur à sa date d'émission même quand la
  loi (le profil) change ensuite. Les corrections sont de *nouveaux* documents
  (`COMPLIANCE_ARCHITECTURE.md` §11).
- **`ScheduledJob`** (cadence de poll + timers de silence), **`OutboxMessage`** (sortant),
  **`DocumentResponse`** (statuts entrants) — tous dans le modèle de données §13.

---

## 7. Organisation des modules (évolution, pas réécriture)

```
backend/src/compliance/
  lifecycle/
    state-machine.ts        # KEEP — the legal SUPERSET of states/transitions (legality guard)
    response.ts             # KEEP — ResponseTracker (silence=acceptance)
    triggers.ts             # NEW — Trigger + TransitionSpec + bind-to-provider feedback
    phases/
      phase-contributor.ts  # NEW — PhaseContributor + PhaseFragment + PhaseContext
      contributors.ts       # NEW — issuance · clearance · delivery · buyer-response · reporting · corrections
      registry.ts           # NEW — mirrors regimes/registry.ts
    assembler.ts            # NEW — compose(plan) → LifecycleGraph (validated vs superset, frozen)
    runtime.ts              # NEW — event-sourced interpreter + availableActions() + pendingDrivers()
    drivers/                # LATER — poll-scheduler · timer-scheduler · inbound-router
    outbox.ts dispatcher.ts # LATER — durable I/O (§12)
  providers/transmission/transmission-provider.ts  # + feedback / pollPolicy
```

**Le front suit trivialement** (consommateurs de `COMPLIANCE_ARCHITECTURE.md`) : il affiche la
**projection** du graphe gelé — une *timeline* (états + `ComplianceEvent`s, en direct via le SSE
existant) plus `availableActions(invoice)` (les transitions `MANUAL` actuellement légales). Il ne sait
toujours rien d'un pays quel qu'il soit.

---

## 8. Décisions de conception (assumées, délibérées)

1. **Cycle de vie composé, pas un enum figé** — sinon il faut maintenir N machines.
2. **Le driver = une propriété du fournisseur de canal** (feedback model), pas du pays — *c'est* la
   réponse à « super PDP ≠ email ≠ peppol ».
3. **Event sourcing** — journal append-only + projection ; l'audit légal l'exige de toute façon.
4. **Snapshot gelé à l'émission** + `profileVersion` — la facture vit selon les règles de sa propre
   date.
5. **Trois mécanismes génériques** (poll / timer / inbound) réutilisés partout — pas de plomberie par
   pays.

---

*Fin du RFC. L'ordre de construction est au §7 ; l'assembleur pur + les contributeurs arrivent en
premier (entièrement testables en unitaire, sans I/O), puis les drivers durables (scheduler / inbox /
outbox), puis la projection front.*
