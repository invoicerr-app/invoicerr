---
title: "NBR — Bangladesh e-invoicing"
description: "Bangladesh's NBR e-Invoice system, and what adding Bangladesh to Invoicerr would involve. Invoicerr does not support Bangladesh today."
sidebar_label: "Bangladesh"
keywords: [NBR, Bangladesh e-invoicing, NBR e-Invoice, e-TIN Bangladesh, Bangladesh invoice XML]
---

# NBR — Bangladesh e-invoicing

:::warning[Invoicerr does not support Bangladesh]
No Bangladesh data file exists anywhere in this repository — no country policy, no identifiers, no
tax system, no transmission channel. **Nothing on this page is implemented.** It is here so that
someone who wants Bangladesh support knows what adding it would involve. The countries Invoicerr
does cover are listed in the [country directory](./index.md).
:::

Bangladesh's e-invoicing runs through the National Board of Revenue's own e-Invoice System. Large
taxpayers were brought on first, with further categories of business added over time, each
submission signed and authorised before it reaches the buyer.

## What supporting Bangladesh would involve

| | |
|---|---|
| **System** | NBR e-Invoice System |
| **Authority** | NBR — National Board of Revenue |
| **Format** | A national XML schema (NBR e-Invoice). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the NBR e-Invoice platform. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Mandatory rollout began with large taxpayers from 2021, extending progressively since.
- Clearance model: the NBR validates and authorises each invoice before delivery.
- Standard VAT rate is 15 percent.
- Archive retention is 5 years.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Bangladesh.

- `country-policy/data/bd.json` — which document actions Bangladesh allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/bd.json` — which national identifier a party must carry.
- `tax/tax-systems/data/bd.json` and `vat-rates/data/bd.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/bd.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/bd.json` — the channel and format a Bangladeshi public buyer requires.
- `transports/channel-policy/data/bd.json` — whether a channel is legally required of a seller
  established in Bangladesh, and from what date.
- `archive/retention/data/bd.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the NBR e-Invoice platform is a transmission channel this
repository does not implement, and its XML schema has no format provider. Both are code, not a JSON
file — see [When a country needs more than a file](../adding-a-country.md).

## Want Bangladesh supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Bangladesh, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Bangladesh".
