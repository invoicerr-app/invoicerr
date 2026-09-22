---
title: "GDT — Vietnam e-invoicing"
description: "Vietnam's GDT-authenticated electronic invoice system, and what adding Vietnam to Invoicerr would involve. Invoicerr does not support Vietnam today."
sidebar_label: "Vietnam"
keywords: [GDT, Vietnam e-invoicing, Hoadondientu, T-VAN, Vietnam invoice XML]
---

# GDT — Vietnam e-invoicing

:::warning[Invoicerr does not support Vietnam]
No Vietnam data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Vietnam support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Vietnam authenticates most invoices before they reach the buyer: the General Department of Taxation
(GDT) issues a unique authentication code through its **Hoadondientu** electronic invoice system,
reached through a licensed **T-VAN** intermediary rather than a direct connection. A minority of
high-volume sectors are allowed to issue without a code.

## What supporting Vietnam would involve

| | |
|---|---|
| **System** | Hoadondientu — the GDT's electronic invoice system |
| **Authority** | GDT — General Department of Taxation |
| **Format** | A national XML schema, submitted through Hoadondientu. No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to Hoadondientu through a licensed T-VAN provider. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Clearance model: most invoices need a GDT-issued authentication code before they are valid.
- Utilities, banking and telecom sectors may issue high-volume invoices without a code.
- Corrections use linked "adjustment" or "replacement" invoices rather than deleting the original.
- A temporary reduced VAT rate of 8 percent applies alongside the standard rate, currently extended
  through 2026.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Vietnam.

- `country-policy/data/vn.json` — which document actions Vietnam allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/vn.json` — which national identifier a party must carry.
- `tax/tax-systems/data/vn.json` and `vat-rates/data/vn.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/vn.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/vn.json` — the channel and format a Vietnamese public buyer requires.
- `transports/channel-policy/data/vn.json` — whether a channel is legally required of a seller
  established in Vietnam, and from what date.
- `archive/retention/data/vn.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the Hoadondientu platform is a transmission channel this
repository does not implement, and its XML schema has no format provider. Both are code, not a JSON
file — see [When a country needs more than a file](../adding-a-country.md).

## Want Vietnam supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Vietnam, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Vietnam".
