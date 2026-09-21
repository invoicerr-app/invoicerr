---
title: "DGI — Cameroon e-invoicing"
description: "Cameroon's DGI e-invoicing system, and what adding Cameroon to Invoicerr would involve. Invoicerr does not support Cameroon today."
sidebar_label: "Cameroon"
keywords: [DGI, Cameroon e-invoicing, Cameroon invoice XML]
---

# DGI — Cameroon e-invoicing

:::warning[Invoicerr does not support Cameroon]
No Cameroon data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Cameroon support knows what adding it would involve. The countries Invoicerr does cover
are listed in the [country directory](./index.md).
:::

Cameroon's e-invoicing is administered by the **DGI**, the Direction Générale des Impôts, through
its e-Invoice System.

## What supporting Cameroon would involve

| | |
|---|---|
| **System** | DGI e-Invoice System |
| **Authority** | DGI — Direction Générale des Impôts |
| **Format** | A national XML schema. No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the DGI e-Invoice System. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Described as a clearance model, with tax-authority authorization required before an invoice is
  valid.
- Digital signature named as a requirement.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Cameroon.

- `country-policy/data/cm.json` — which document actions Cameroon allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/cm.json` — which national identifier a party must carry.
- `tax/tax-systems/data/cm.json` and `vat-rates/data/cm.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/cm.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/cm.json` — the channel and format a Cameroonian public buyer requires.
- `transports/channel-policy/data/cm.json` — whether a channel is legally required of a seller
  established in Cameroon, and from what date.
- `archive/retention/data/cm.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the DGI e-Invoice System is a transmission channel this
repository does not implement, and its XML schema has no format provider. Both are code, not a JSON
file — see [When a country needs more than a file](../adding-a-country.md).

## Want Cameroon supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Cameroon, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Cameroon".
