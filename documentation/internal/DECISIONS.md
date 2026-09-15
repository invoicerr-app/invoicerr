# Decisions Made Autonomously

One decision per entry: what was settled, why, and what would reopen it. Calls made by the owner
live in the handoff notes, not here. What belongs to the owner and to the owner alone — the 118
Docusaurus pages, the CI switch to Firefox, a warning to users, anything with legal implications — is
**not** settled here: it is posed as a question.

---

## D-001 — `archival.retentionYears` stays at 10 years, the layer declares 6

**Date**: 2026-08-28 · **Task**: P2-T02

The French profile keeps **10 years**. The `ARCHIVAL` layer that P2-T02 adds declares **6 years**,
LPF art. L102 B — the **tax** duration, the one an e-invoicing mandate attaches to.
`03-LEGAL-VERIFICATION.md` flags the gap as **FR-D9**: the 10 years belong to commercial law
(C. com. art. L123-22), on its own clock, and conflating the two is "approximate and poorly
grounded".

**Decided**: I am not changing `retentionYears`. Doing so would **reduce** what the product retains,
from 10 to 6 — a behavior change with legal consequences, in the direction of the weaker guarantee.
A duration that is too long puts no one at fault; one that is too short does.

**What reopens it**: an explicit decision on what the runtime must enforce. Both durations are real
and answer two distinct obligations; the product should probably carry both rather than choosing
one. The `openQuestion` on the `ARCHIVAL` layer carries the trace.

---

## D-002 — P2-T02's deadlines are not wired up, and phase 3 will wire them

**Date**: 2026-08-28 · **Task**: P2-T02

A deadline mechanism **already exists** and works: `deadlineHours` on lifecycle transitions,
consumed by `lifecycle/drivers/timer-scheduler.ts` and `nest/apply-signal.ts`, which arm real
timers. The `obligations[].deadline` layer I am adding is a **second representation that nothing
reads**.

**Decided**: I am shipping it anyway, and naming it for what it is. P2-T02's acceptance criterion is
about the **model** — that the French profile expresses its three layers with their deadlines — and
consuming it is phase 3's job, the "profile-derived state machine". Shipping the model without
wiring it is the intended order here, not an oversight.

**What reopens it, and the risk to watch**: this is exactly the "sound but unwired" shape the audit
criticizes the repository for, and that I have already reproduced twice (`ComplianceService` with no
`formats`, `ViesVatValidationClient` left unwired). Phase 3 must **connect** `obligations[].
deadline` to the existing `deadlineHours`, not build a third representation. If it builds a third
one, this entry is the record that I saw it coming.
