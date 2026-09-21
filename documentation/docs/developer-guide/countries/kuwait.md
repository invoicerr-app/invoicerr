---
title: "Kuwait e-invoicing"
description: "Kuwait's e-invoicing system, run by the Ministry of Finance, and what adding Kuwait to Invoicerr would involve. Invoicerr does not support Kuwait today."
sidebar_label: "Kuwait"
keywords: [Kuwait e-invoicing, MOF Kuwait, Kuwait invoice XML, e-invoicing Kuwait]
---

# Kuwait e-invoicing

:::warning[Invoicerr does not support Kuwait]
No Kuwait data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Kuwait support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Kuwait's e-invoicing mandate runs through the MOF, the Ministry of Finance, on its own e-Invoice
System. Invoices are validated and authorized on submission against the ministry's own schema.

## What supporting Kuwait would involve

| | |
|---|---|
| **System** | e-Invoice System (MOF) |
| **Authority** | MOF — Ministry of Finance |
| **Format** | A national XML schema (MOF schema). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the MOF e-Invoice System. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Mandatory for all businesses; no phased rollout dates recorded.
- Real-time authorization required on submission.
- VAT rate cited as 0% / 5%.
- Archive retention 6 years.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Kuwait.

- `country-policy/data/kw.json` — which document actions Kuwait allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/kw.json` — which national identifier a party must carry.
- `tax/tax-systems/data/kw.json` and `vat-rates/data/kw.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/kw.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/kw.json` — the channel and format a public buyer in Kuwait requires.
- `transports/channel-policy/data/kw.json` — whether a channel is legally required of a seller
  established in Kuwait, and from what date.
- `archive/retention/data/kw.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the MOF e-Invoice System is a transmission channel this
repository does not implement, and its schema has no format provider. Both are code, not a JSON file
— see [When a country needs more than a file](../adding-a-country.md).

## Want Kuwait supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Kuwait, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Kuwait".
