---
title: "SEF — Serbia e-invoicing"
description: "Serbia's SEF e-invoicing clearance hub, and what adding Serbia to Invoicerr would involve. Invoicerr does not support Serbia today."
sidebar_label: "Serbia"
keywords: [SEF, Serbia e-invoicing, e-Faktura, Serbia invoice XML]
---

# SEF — Serbia e-invoicing

:::warning[Invoicerr does not support Serbia]
No Serbia data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Serbia support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Serbia's e-invoicing runs through **SEF** (Sistem E-Faktura), a centralized clearance hub operated
under the Ministry of Finance. An invoice not issued through SEF is not legally valid.

## What supporting Serbia would involve

| | |
|---|---|
| **System** | SEF (Sistem E-Faktura) |
| **Authority** | Ministry of Finance |
| **Format** | A national XML schema (SRBEFN, Serbia's own UBL 2.1 customization). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | SEF. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- B2G e-invoicing cited as mandatory since 2022, B2B since 2023.
- Model described as clearance: SEF validates a submitted invoice before it reaches the buyer.
- An unanswered invoice is described as auto-rejected in B2B or auto-accepted in B2G after a fixed
  waiting period.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Serbia.

- `country-policy/data/rs.json` — which document actions Serbia allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/rs.json` — which national identifier a party must carry.
- `tax/tax-systems/data/rs.json` and `vat-rates/data/rs.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/rs.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/rs.json` — the channel and format a Serbian public buyer requires.
- `transports/channel-policy/data/rs.json` — whether a channel is legally required of a seller
  established in Serbia, and from what date.
- `archive/retention/data/rs.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: SEF is a transmission channel this repository does not
implement, and SRBEFN has no format provider. Both are code, not a JSON file — see [When a country
needs more than a file](../adding-a-country.md).

## Want Serbia supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Serbia, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Serbia".
