---
title: "ISTD — Jordan e-invoicing"
description: "Jordan's ISTD e-invoicing system, JoFotara, and what adding Jordan to Invoicerr would involve. Invoicerr does not support Jordan today."
sidebar_label: "Jordan"
keywords: [ISTD, Jordan e-invoicing, JoFotara, Jordan invoice XML]
---

# ISTD — Jordan e-invoicing

:::warning[Invoicerr does not support Jordan]
No Jordan data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Jordan support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Jordan's e-invoicing runs through ISTD, the Income and Sales Tax Department, on its JoFotara
e-Invoice System. The department issues its own schema and requires a digital certificate before an
invoice clears the platform.

## What supporting Jordan would involve

| | |
|---|---|
| **System** | JoFotara — ISTD's e-Invoice System |
| **Authority** | ISTD — Income and Sales Tax Department |
| **Format** | A national XML schema (JoFotara). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the ISTD platform. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Progressive mandatory rollout since 2018, ongoing for all businesses.
- Pre-clearance model: real-time validation before an invoice reaches the buyer.
- Standard GST rate 16%.
- Archive retention 6 years.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Jordan.

- `country-policy/data/jo.json` — which document actions Jordan allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/jo.json` — which national identifier a party must carry.
- `tax/tax-systems/data/jo.json` and `vat-rates/data/jo.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/jo.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/jo.json` — the channel and format a public buyer in Jordan requires.
- `transports/channel-policy/data/jo.json` — whether a channel is legally required of a seller
  established in Jordan, and from what date.
- `archive/retention/data/jo.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the ISTD platform is a transmission channel this repository
does not implement, and its schema has no format provider. Both are code, not a JSON file — see
[When a country needs more than a file](../adding-a-country.md).

## Want Jordan supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Jordan, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Jordan".
