---
title: "TRA — Tanzania e-invoicing"
description: "Tanzania's TRA e-invoicing system, and what adding Tanzania to Invoicerr would involve. Invoicerr does not support Tanzania today."
sidebar_label: "Tanzania"
keywords: [TRA, VFD, Tanzania e-invoicing, Tanzania invoice XML]
---

# TRA — Tanzania e-invoicing

:::warning[Invoicerr does not support Tanzania]
No Tanzania data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Tanzania support knows what adding it would involve. The countries Invoicerr does cover
are listed in the [country directory](./index.md).
:::

Tanzania's e-invoicing is administered by the **TRA**, the Tanzania Revenue Authority, through its
e-Invoice System, integrated with e-Levy reporting and referred to in places as VFD.

## What supporting Tanzania would involve

| | |
|---|---|
| **System** | TRA e-Invoice System (e-Levy integration) |
| **Authority** | TRA — Tanzania Revenue Authority |
| **Format** | A national format (VFD). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the TRA e-Invoice System. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Mandatory for all businesses from 2023, with continuous real-time reporting.
- Described as a clearance model, integrated with e-Levy reporting.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Tanzania.

- `country-policy/data/tz.json` — which document actions Tanzania allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/tz.json` — which national identifier a party must carry.
- `tax/tax-systems/data/tz.json` and `vat-rates/data/tz.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/tz.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/tz.json` — the channel and format a Tanzanian public buyer requires.
- `transports/channel-policy/data/tz.json` — whether a channel is legally required of a seller
  established in Tanzania, and from what date.
- `archive/retention/data/tz.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the TRA e-Invoice System is a transmission channel this
repository does not implement, and the VFD format has no format provider. Both are code, not a JSON
file — see [When a country needs more than a file](../adding-a-country.md).

## Want Tanzania supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Tanzania, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Tanzania".
