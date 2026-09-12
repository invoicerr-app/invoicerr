# Invoicerr — Compliance Architecture (retired)

> **Retired 2026-08-29.** This document was the design RFC for a compliance **engine**: one
> `CountryComplianceProfile` per country, resolved by `compliance-engine.resolve()` into a
> `CompliancePlan`, executed by a lifecycle graph assembled per plan. That engine —
> `backend/src/compliance/` (`profiles/`, `engine/`,
> `providers/{format,signing,transmission,archive}/`, `lifecycle/`) — was deleted wholesale in commit
> `fffbae77` ("refactor!: suppression des documents légaux et du moteur de conformité", ~298k lines
> removed). The design described below no longer exists in this codebase.

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
document status machine (`descriptors/lifecycle.ts`); the only country-specific lifecycle nuance
left is `correction-routes/` (which correction path a country allows), `conformity/pollers/`
(post-send authority polling, wired per transport, not per country), and `archive/retention/`
(retention duration, France only).

See `CLAUDE.md`'s "The documents module" section for the current architecture, and tag
`avant-refonte-documents` (`git show avant-refonte-documents:backend/src/compliance/...`) to read
the removed engine's own source.
