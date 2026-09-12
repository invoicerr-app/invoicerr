# Invoicerr — Per-Jurisdiction Invoice Lifecycle Architecture (retired)

> **Retired 2026-08-29.** This document was a companion RFC to `COMPLIANCE_ARCHITECTURE.md`,
> proposing a per-jurisdiction lifecycle **composed** from phase contributors (issuance, clearance,
> delivery, buyer-response, reporting, corrections) and interpreted by an event-sourced runtime
> (`lifecycle/assembler.ts`, `lifecycle/runtime.ts`) that consumed signals (`COMMAND`,
> `AUTHORITY_ACK`, `POLL_RESULT`, `INBOUND_STATUS`, `TIMER_ELAPSED`). That runtime — the whole
> `backend/src/compliance/lifecycle/` directory — was deleted along with the rest of the compliance
> engine in commit `fffbae77` ("refactor!: suppression des documents légaux et du moteur de
> conformité"). No composed per-jurisdiction lifecycle graph exists in this codebase today.

## What exists instead

One generic, country-blind document status machine, `backend/src/modules/documents/
descriptors/lifecycle.ts`: a `DocumentTypeDescriptor` declares its own `statuses`/`initialStatus`,
an action declares `transitions`, and the module enforces that a handler can never persist a status
its own type didn't declare — for every document type (invoice, quote, credit note, expense,
received invoice) alike, with no country dimension at all.

Country-specific lifecycle nuance survives in exactly three places, none of them a composed graph:
- `correction-routes/` — which correction path (credit note vs. cancel-and-replace) a country allows.
- `conformity/pollers/` — post-send authority status polling, wired per **transport** (pdp, ksef,
  peppol, chorus-pro, anaf, face), never per country.
- `archive/retention/` — retention duration, France only.

See `CLAUDE.md`'s "The documents module" section for the current architecture, and tag
`avant-refonte-documents` to read the removed runtime's own source.
