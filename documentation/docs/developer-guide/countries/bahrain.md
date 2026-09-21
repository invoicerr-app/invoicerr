---
title: "NBR — Bahrain e-invoicing"
description: "Bahrain's NBR eTax e-invoicing system and what adding Bahrain to Invoicerr would involve. Invoicerr does not support Bahrain today."
sidebar_label: "Bahrain"
keywords: [NBR, Bahrain e-invoicing, eTax, Bahrain invoice XML]
---

# NBR — Bahrain e-invoicing

:::warning[Invoicerr does not support Bahrain]
No Bahrain data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Bahrain support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Bahrain's e-invoicing mandate runs through the NBR, the National Bureau for Revenue, on its eTax
Electronic System. The system aligns with the wider GCC VAT framework and centers on real-time
invoice reporting.

## What supporting Bahrain would involve

| | |
|---|---|
| **System** | eTax Electronic System |
| **Authority** | NBR — National Bureau for Revenue |
| **Format** | A national XML/JSON schema (GCC standard). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the eTax Electronic System. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Mandatory for all businesses since 2022, with continuous real-time reporting.
- Standard VAT rate 10%.
- Digital signature required at submission.
- Archive retention 6 years.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Bahrain.

- `country-policy/data/bh.json` — which document actions Bahrain allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/bh.json` — which national identifier a party must carry.
- `tax/tax-systems/data/bh.json` and `vat-rates/data/bh.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/bh.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/bh.json` — the channel and format a public buyer in Bahrain requires.
- `transports/channel-policy/data/bh.json` — whether a channel is legally required of a seller
  established in Bahrain, and from what date.
- `archive/retention/data/bh.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the eTax Electronic System is a transmission channel this
repository does not implement, and its schema has no format provider. Both are code, not a JSON file
— see [When a country needs more than a file](../adding-a-country.md).

## Want Bahrain supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Bahrain, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Bahrain".
