# Invoicerr — Per-Jurisdiction Invoice Lifecycle Architecture

> **Status:** Design / RFC — companion to [`COMPLIANCE_ARCHITECTURE.md`](COMPLIANCE_ARCHITECTURE.md) (extends §11 / §11.1).
> **Problem it solves:** the *life* of an invoice differs by **issuer country**, **recipient country**, and
> **transmission channel**. A country cleared via a French *PDP* does not live like one sent by email,
> which does not live like Peppol: some must be **polled periodically** for their status, some are
> **validated automatically**, some wait for a **buyer response** (with *silence = acceptance*), some
> must **clear with an authority before they are valid at all**.
>
> This document defines a single architecture that produces a **different, correct lifecycle per
> `(issuer, recipient, channel)`** without any `if (country)` in business code.

---

## 1. The core idea — lifecycle is *composed*, then *interpreted*

We stop modelling the lifecycle as **one** fixed state machine. Instead it decomposes into **three
orthogonal axes**, each sourced from data we already resolve:

| Axis | Question | Source |
| --- | --- | --- |
| **1. Phases** | *Which stages exist?* | composed: issuer **regime** + recipient **obligations** + roles |
| **2. Drivers** | *How does a stage advance?* (sync / poll / callback / timer / manual) | the resolved **channel provider's feedback model** |
| **3. Runtime** | *What makes it live over time?* | a durable, event-sourced interpreter + scheduler + inbox + outbox |

> The life of one invoice = `assemble(phases) × bind(drivers) → interpreted by the runtime`.
> `FR→IT`, `MX→MX`, `US→FR` yield **different lives from one engine** — by composition, not enumeration.

This is the same DNA as the rest of the system (`COMPLIANCE_ARCHITECTURE.md` §4): *a country is data*.

---

## 2. Axis 1 — Phases are composable contributors

Rather than a frozen enum graph, each **phase** is a pure contributor that, given the resolved
`CompliancePlan`, returns a *fragment* of the graph (states + transitions) or `null` when it does not
apply. This mirrors the existing `regimes/` and `reporting/` handler+registry pattern.

```ts
interface PhaseFragment { states: ComplianceStatus[]; transitions: TransitionSpec[]; }

interface PhaseContributor {
  id: string;
  contributes(plan: CompliancePlan, pctx: PhaseContext): PhaseFragment | null;
}
```

Contributors (each gated by the plan):

| Contributor | Adds | Gated by | Contributed by |
| --- | --- | --- | --- |
| **Issuance** | `DRAFT → ISSUED` (number, hash, freeze) | always | — |
| **Clearance** | `ISSUED → PENDING_CLEARANCE → CLEARED \| REJECTED`, `CONTINGENCY` | `regime.blocking` | **issuer** |
| **Delivery** | `→ DELIVERED` | always | issuer/channel |
| **BuyerResponse** | `DELIVERED → AWAITING_RESPONSE → ACCEPTED \| REFUSED \| DISPUTED` | `lifecycle.response` / recipient mandate | **recipient** (+ issuer for FR statuses) |
| **Reporting** | `→ REPORTED` (parallel) | `reporting[]` non-empty | issuer |
| **Corrections** | `CANCEL` / `CORRECT` manual overlay | `lifecycle.cancellation` / `correctionModel` | both |

> **Issuer *and* recipient**: the issuer contributes its clearance/e-reporting phases; the recipient
> contributes its "must accept / acknowledge" phase. The final graph is the **composed union** — this
> is precisely how "lifecycle as a function of issuer and recipient" is resolved *structurally*.

---

## 3. Axis 2 — Drivers: why *superpdp ≠ email ≠ peppol*

A transition declares not only `from → to` but **how it is triggered**:

```ts
type Trigger =
  | { kind: 'IMMEDIATE' }                                       // synchronous, inline result
  | { kind: 'POLL';     poll: PollPolicy; channelProviderId? } // ask the third party periodically
  | { kind: 'CALLBACK'; correlationKey? }                       // wait for an inbound webhook / notifica
  | { kind: 'TIMER';    deadlineHours?; onElapse }              // silence = acceptance
  | { kind: 'MANUAL';   action }                                // user / API command
  | { kind: 'CONTINGENCY' };                                    // authority outage
```

**The trigger is resolved from the channel provider, not the country.** Each `TransmissionProvider`
declares a **feedback model**:

```ts
interface TransmissionProvider {
  // …
  feedback?: 'SYNC' | 'ASYNC_POLL' | 'ASYNC_CALLBACK' | 'NONE';
  pollPolicy?: { everySeconds: number; timeoutHours: number; backoff?: 'NONE' | 'EXPONENTIAL' };
}
```

| Provider | `feedback` | Resulting driver for its phase |
| --- | --- | --- |
| `email` | `NONE` | Delivery = `IMMEDIATE` |
| `peppol` | `ASYNC_CALLBACK` | Invoice Response / MLR `CALLBACK` |
| **`pdp` / a "super PDP"** | `ASYNC_CALLBACK` **or** `ASYNC_POLL` | statuses pushed *or* polled — **the provider instance decides** (two French PDPs can differ) |
| `pac` (MX) | `ASYNC_POLL` | clearance `POLL` |
| `sdi` (IT) | `ASYNC_CALLBACK` | notifiche `CALLBACK` |
| `gov-portal` / national | `ASYNC_POLL` | clearance/report `POLL` |

So "periodically ask a third party for the status" = `POLL` bound to `provider.poll()`; "validated
automatically" = `IMMEDIATE` or `TIMER`. **Same phase, different driver, chosen by the channel.**

---

## 4. Axis 3 — The runtime: durable, event-sourced interpreter

The machine is **interpreted, not hardcoded**, and an invoice's life is an **append-only event log**
(`ComplianceEvent`); `complianceStatus` is just a **projection**. This gives legal audit + replay for
free.

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

The driver of the *next* transition becomes generic infrastructure — **three mechanisms, one
implementation each, reused by every country**:

| Trigger | Generic mechanism | Status in repo |
| --- | --- | --- |
| `POLL` | a **scheduler** enqueues a recurring job → `provider.poll()` → emits `POLL_RESULT` | scheduler TODO; `poll()` ✅ |
| `CALLBACK` | an **inbound router** (webhook/SSE from PDP/SdI/AP) → emits `INBOUND_STATUS` | `reception/` embryo ✅ |
| `TIMER` | the same scheduler arms a deadline → emits `TIMER_ELAPSED` (silence=accept) | scheduler TODO; `ResponseTracker` ✅ |
| outbound | the **outbox** at-least-once + idempotency | §13 planned |

Everything durable (state, scheduled polls, timers, outbox) → a crash neither loses nor doubles a
transition.

---

## 5. Proof by composition (one engine, different lives)

| Issuer (channel, feedback) → Recipient | Assembled life |
| --- | --- |
| **FR (pdp, CALLBACK)** → FR B2B | Issue → Deliver(PDP) → AWAITING{`déposée`,`approuvée`/`refusée`,`encaissée` + silence TIMER} ∥ Reporting |
| **MX (pac, POLL)** → MX B2B | Issue → PENDING_CLEARANCE{POLL} → CLEARED → Deliver(≤72h); cancel ⇒ requires buyerConsent |
| **US (email, NONE)** → FR | Issue → Deliver{IMMEDIATE} → done (buyer self-assess flag) |
| **CL (gov, POLL)** → CL | Issue → clear{POLL} → Deliver → AWAITING{TIMER 8d ⇒ ACCEPTED} |
| **DE (peppol, CALLBACK)** → DE B2G | Issue → Deliver(Peppol) → AWAITING{MLR CALLBACK} → ACCEPTED |

None of these is a special case in code — each is `assemble(phases) × bind(drivers)`.

---

## 6. Persistence (event-sourced) & temporal correctness

- **`ComplianceEvent`** rows are the source of truth (append-only). `Invoice.complianceStatus` is a
  projection rebuilt from them.
- **`Invoice.lifecycleSnapshot`** (the assembled graph) + **`profileVersion`** are frozen at issue, so
  the document keeps living by the rules in force on its issue date even when the law (profile) later
  changes. Corrections are *new* documents (`COMPLIANCE_ARCHITECTURE.md` §11).
- **`ScheduledJob`** (poll cadence + silence timers), **`OutboxMessage`** (outbound), **`DocumentResponse`**
  (inbound statuses) — all in the §13 data model.

---

## 7. Module layout (evolution, not rewrite)

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

**The front follows trivially** (`COMPLIANCE_ARCHITECTURE.md` consumers): it renders the **projection**
of the frozen graph — a *timeline* (states + `ComplianceEvent`s, live via the existing SSE) plus
`availableActions(invoice)` (the `MANUAL` transitions currently legal). It still knows nothing about
any country.

---

## 8. Design decisions (assumed, deliberate)

1. **Composed lifecycle, not a frozen enum** — otherwise you maintain N machines.
2. **Driver = property of the channel provider** (feedback model), not the country — *this* is the
   answer to "super PDP ≠ email ≠ peppol".
3. **Event sourcing** — append-only log + projection; the legal audit requires it anyway.
4. **Snapshot frozen at issue** + `profileVersion` — the invoice lives by the rules of its own date.
5. **Three generic mechanisms** (poll / timer / inbound) reused everywhere — no per-country plumbing.

---

*End of RFC. The build order is §7; the pure assembler + contributors land first (fully unit-testable,
no I/O), then the durable drivers (scheduler / inbox / outbox), then the front projection.*
