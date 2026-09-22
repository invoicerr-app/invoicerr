---
title: "IRD — Nepal e-invoicing"
description: "Nepal's IRD e-invoicing system, and what adding Nepal to Invoicerr would involve. Invoicerr does not support Nepal today."
sidebar_label: "Nepal"
keywords: [IRD, Nepal e-invoicing, e-Invoice Nepal, PAN Nepal]
---

# IRD — Nepal e-invoicing

:::warning[Invoicerr does not support Nepal]
No Nepal data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Nepal support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Nepal requires mandatory e-invoicing through the Inland Revenue Department's own e-Invoice System,
with each invoice validated before it reaches the buyer.

## What supporting Nepal would involve

| | |
|---|---|
| **System** | e-Invoice System, run by the IRD |
| **Authority** | IRD — Inland Revenue Department |
| **Format** | A national schema (CBMS). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the IRD e-Invoice System. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Clearance model: pre-submission validation is required before an invoice is valid.
- A digital signature and authorised software are required to issue an invoice.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Nepal.

- `country-policy/data/np.json` — which document actions Nepal allows. Start here: without this file
  every action is refused with a 403, naming the country.
- `country-identifiers/data/np.json` — which national identifier a party must carry.
- `tax/tax-systems/data/np.json` and `vat-rates/data/np.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/np.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/np.json` — the channel and format a Nepali public buyer requires.
- `transports/channel-policy/data/np.json` — whether a channel is legally required of a seller
  established in Nepal, and from what date.
- `archive/retention/data/np.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the IRD e-Invoice System is a transmission channel this
repository does not implement, and its schema has no format provider. Both are code, not a JSON file
— see [When a country needs more than a file](../adding-a-country.md).

## Want Nepal supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Nepal, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Nepal".
