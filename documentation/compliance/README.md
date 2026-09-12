# Compliance pages

Invoicerr covers exactly five countries: **France, Poland, Italy, Portugal, Germany** (the
2026-09-10 five-country pivot). This directory holds one page per country — `<CC>-<Country>.md` —
rendered at `/compliance/<cc>` by `documentation/plugins/compliance-content-plugin.ts`, and listed
on the `/compliance` index page.

Each page is written from the compliance catalogs under `backend/src/modules/documents/`
(`country-policy/`, `country-identifiers/`, `correction-routes/`, `b2g-routing/`,
`transports/channel-policy/`, `tax/tax-systems/`, `vat-rates/`, `reporting/`) — the same data the
backend itself loads at boot. A page states plainly when a catalog has no file for that country,
and never promotes a catalog fact marked `unverified` to a stated one.

| Country | Code | Page |
| --- | --- | --- |
| France | `FR` | [FR-France.md](./FR-France.md) |
| Poland | `PL` | [PL-Poland.md](./PL-Poland.md) |
| Italy | `IT` | [IT-Italy.md](./IT-Italy.md) |
| Portugal | `PT` | [PT-Portugal.md](./PT-Portugal.md) |
| Germany | `DE` | [DE-Germany.md](./DE-Germany.md) |

Earlier revisions of this directory carried speculative pages for roughly a hundred other
jurisdictions, written ahead of any implementation. That research was not lost — it stays in git
history — but it described a product that did not exist; this directory now only documents the five
countries the product actually supports today.

For the retired v1 compliance-engine design docs (kept as short pointers), see
`COMPLIANCE_ARCHITECTURE.md`, `COMPLIANCE_LIFECYCLE.md`, `COMPLIANCE_BUILD_ORDER.md` and
`COMPLIANCE_STATUS.md` in this same directory.
