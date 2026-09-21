---
title: "ZATCA — Saudi Arabia e-invoicing"
description: "Saudi Arabia's ZATCA e-invoicing system, FATOORA, and what adding Saudi Arabia to Invoicerr would involve. Invoicerr does not support Saudi Arabia today."
sidebar_label: "Saudi Arabia"
keywords: [ZATCA, Fatoora, Saudi Arabia e-invoicing, Saudi invoice XML, e-invoicing Saudi Arabia]
---

# ZATCA — Saudi Arabia e-invoicing

:::warning[Invoicerr does not support Saudi Arabia]
No Saudi Arabia data file exists anywhere in this repository — no country policy, no identifiers, no
tax system, no transmission channel. **Nothing on this page is implemented.** It is here so that
someone who wants Saudi Arabia support knows what adding it would involve. The countries Invoicerr
does cover are listed in the [country directory](./index.md).
:::

Saudi Arabia's e-invoicing mandate runs through ZATCA, the Zakat, Tax and Customs Authority, on its
FATOORA platform. Invoices use an extended UBL 2.1 profile carrying a ZATCA-compliant QR code,
cleared by the authority before reaching the buyer.

## What supporting Saudi Arabia would involve

| | |
|---|---|
| **System** | FATOORA — ZATCA's e-Invoicing Platform |
| **Authority** | ZATCA — Zakat, Tax and Customs Authority |
| **Format** | A national XML schema (ZATCA UBL 2.1 — an extended profile of UBL 2.1). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the FATOORA platform. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Phased rollout: Phase 1 (generation/storage) from December 2021, Phase 2 (clearance) from December
  2023, a B2C QR framework from January 2025.
- Clearance model: real-time validation before the invoice reaches the buyer.
- Standard VAT rate 15%.
- Archive retention 6 years, kept within Saudi Arabia.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Saudi Arabia.

- `country-policy/data/sa.json` — which document actions Saudi Arabia allows. Start here: without
  this file every action is refused with a 403, naming the country.
- `country-identifiers/data/sa.json` — which national identifier a party must carry.
- `tax/tax-systems/data/sa.json` and `vat-rates/data/sa.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/sa.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/sa.json` — the channel and format a Saudi Arabia public buyer requires.
- `transports/channel-policy/data/sa.json` — whether a channel is legally required of a seller
  established in Saudi Arabia, and from what date.
- `archive/retention/data/sa.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the FATOORA platform is a transmission channel this
repository does not implement, and its schema has no format provider. Both are code, not a JSON file
— see [When a country needs more than a file](../adding-a-country.md).

## Want Saudi Arabia supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Saudi Arabia, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Saudi Arabia".
