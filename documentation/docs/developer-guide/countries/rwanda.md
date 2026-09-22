---
title: "EBM — Rwanda e-invoicing"
description: "Rwanda's EBM e-invoicing system, run by the RRA, and what adding Rwanda to Invoicerr would involve. Invoicerr does not support Rwanda today."
sidebar_label: "Rwanda"
keywords: [EBM, RRA, Rwanda e-invoicing, Rwanda invoice XML]
---

# EBM — Rwanda e-invoicing

:::warning[Invoicerr does not support Rwanda]
No Rwanda data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Rwanda support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Rwanda's e-invoicing runs through **EBM**, administered by the **RRA**, the Rwanda Revenue
Authority, via its e-Invoice System.

## What supporting Rwanda would involve

| | |
|---|---|
| **System** | RRA e-Invoice System (EBM) |
| **Authority** | RRA — Rwanda Revenue Authority |
| **Format** | A national format (EBM). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the RRA e-Invoice System. No transport in `backend/src/modules/documents/transports/` talks to it today. |

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Rwanda.

- `country-policy/data/rw.json` — which document actions Rwanda allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/rw.json` — which national identifier a party must carry.
- `tax/tax-systems/data/rw.json` and `vat-rates/data/rw.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/rw.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/rw.json` — the channel and format a Rwandan public buyer requires.
- `transports/channel-policy/data/rw.json` — whether a channel is legally required of a seller
  established in Rwanda, and from what date.
- `archive/retention/data/rw.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the RRA e-Invoice System is a transmission channel this
repository does not implement, and the EBM format has no format provider. Both are code, not a JSON
file — see [When a country needs more than a file](../adding-a-country.md).

## Want Rwanda supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Rwanda, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Rwanda".
