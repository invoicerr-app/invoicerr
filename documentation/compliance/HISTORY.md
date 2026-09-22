# Compliance engine — history (retired)

> **Retired 2026-08-29.** This repository used to have a compliance **engine**: one
> `CountryComplianceProfile` per country, resolved by `compliance-engine.resolve()` into a
> `CompliancePlan`, executed by a per-jurisdiction lifecycle graph *assembled* per plan
> (`lifecycle/assembler.ts` + `lifecycle/runtime.ts`, an event-sourced runtime consuming `COMMAND`,
> `AUTHORITY_ACK`, `POLL_RESULT`, `INBOUND_STATUS`, `TIMER_ELAPSED` signals). That whole tree —
> `backend/src/compliance/` (`profiles/`, `engine/`,
> `providers/{format,signing,transmission,archive}/`, `lifecycle/`) — was deleted wholesale in commit
> `fffbae77` ("refactor!: suppression des documents légaux et du moteur de conformité", ~298k lines
> removed). None of the design described below exists in this codebase today.
>
> This page merges what used to be four separate retired pointers (`COMPLIANCE_ARCHITECTURE.md`,
> `COMPLIANCE_LIFECYCLE.md`, `COMPLIANCE_BUILD_ORDER.md`, `COMPLIANCE_STATUS.md`) — each pointed at
> the same replacement and the same tag, so one short page replaces all four.

## What replaced it

There is no single engine and no `CompliancePlan` any more. Compliance logic lives in about a dozen
narrow, independent catalogs under `backend/src/modules/documents/` — `country-policy/`,
`country-identifiers/`, `correction-routes/`, `b2g-routing/`, `transports/channel-policy/`, `tax/`
(`tax-engine.ts` + `tax-systems/`), `vat-rates/`, `country-fields/`, `content-requirements/`,
`mentions/`, `archive/retention/`, `reporting/` — each with its own `data/<countryCode>.json`, its
own schema, its own loader, and mostly its own database mirror and boot-reseed service. Several of
those schemas' own header comments say plainly which piece of the old `CountryComplianceProfile`
they replace.

There is also no per-country lifecycle graph any more. What exists is one generic, country-blind
document status machine, `backend/src/modules/documents/descriptors/lifecycle.ts`: a
`DocumentTypeDescriptor` declares its own `statuses`/`initialStatus`, an action declares
`transitions`, and the module enforces that a handler can never persist a status its own type didn't
declare — for every document type (invoice, quote, credit note, expense, received invoice) alike,
with no country dimension at all.

Country-specific lifecycle nuance survives in exactly three places, none of them a composed graph:
- `correction-routes/` — which correction path (credit note vs. cancel-and-replace) a country allows.
- `conformity/pollers/` — post-send authority status polling, wired per **transport** (pdp, ksef,
  chorus-pro), never per country.
- `archive/retention/` — retention duration and its counting origin, DE/FR/PL/PT today.

## Where the current status lives

- The current architecture is described in `CLAUDE.md`'s "The documents module" section.
- Per-channel and per-format implementation status (which transmission channels are proven live,
  which are implemented-awaiting-credentials, which are stubs) is tracked in
  `documentation/docs/developer-guide/live-testing.md`.
- The NF-525 compliance posture (inalterability, audit trail, hash-chaining, retention, archival,
  gapless numbering) is now a property of the documents module directly — see `descriptors/
  lifecycle.ts`, `archive/`, `numbering/` — rather than of a separate compliance engine.

Tag `avant-refonte-documents` (`git show avant-refonte-documents:backend/src/compliance/...`)
recovers the removed engine's own source for anyone doing archaeology.
