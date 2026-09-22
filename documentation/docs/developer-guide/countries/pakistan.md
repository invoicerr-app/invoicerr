---
title: "FBR — Pakistan e-invoicing"
description: "Pakistan's FBR e-invoicing system, and what adding Pakistan to Invoicerr would involve. Invoicerr does not support Pakistan today."
sidebar_label: "Pakistan"
keywords: [FBR, Pakistan e-invoicing, XIR, STRN, Pakistan invoice XML]
---

# FBR — Pakistan e-invoicing

:::warning[Invoicerr does not support Pakistan]
No Pakistan data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Pakistan support knows what adding it would involve. The countries Invoicerr does cover
are listed in the [country directory](./index.md).
:::

Pakistan requires mandatory e-invoicing through the Federal Board of Revenue's own system, which
returns a unique reference (XIR) for each authorised invoice. Coverage began with large taxpayers
and has extended progressively to further threshold-based categories.

## What supporting Pakistan would involve

| | |
|---|---|
| **System** | FBR e-Invoice System, returning an XIR reference per invoice |
| **Authority** | FBR — Federal Board of Revenue |
| **Format** | A national schema (FBR e-Invoice). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the FBR e-Invoice platform. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Progressive mandatory rollout from 2021, extending to further categories since.
- Clearance model: the FBR validates and returns the XIR reference before delivery.
- Standard GST rate is 18 percent.
- Archive retention is 6 years.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Pakistan.

- `country-policy/data/pk.json` — which document actions Pakistan allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/pk.json` — which national identifier a party must carry.
- `tax/tax-systems/data/pk.json` and `vat-rates/data/pk.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/pk.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/pk.json` — the channel and format a Pakistani public buyer requires.
- `transports/channel-policy/data/pk.json` — whether a channel is legally required of a seller
  established in Pakistan, and from what date.
- `archive/retention/data/pk.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the FBR e-Invoice platform is a transmission channel this
repository does not implement, and its schema has no format provider. Both are code, not a JSON file
— see [When a country needs more than a file](../adding-a-country.md).

## Want Pakistan supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Pakistan, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Pakistan".
