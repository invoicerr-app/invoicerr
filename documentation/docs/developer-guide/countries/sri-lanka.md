---
title: "IRD — Sri Lanka e-invoicing"
description: "Sri Lanka's IRD e-invoicing system, and what adding Sri Lanka to Invoicerr would involve. Invoicerr does not support Sri Lanka today."
sidebar_label: "Sri Lanka"
keywords: [IRD, Sri Lanka e-invoicing, e-Invoice Sri Lanka, TIN Sri Lanka]
---

# IRD — Sri Lanka e-invoicing

:::warning[Invoicerr does not support Sri Lanka]
No Sri Lanka data file exists anywhere in this repository — no country policy, no identifiers, no
tax system, no transmission channel. **Nothing on this page is implemented.** It is here so that
someone who wants Sri Lanka support knows what adding it would involve. The countries Invoicerr does
cover are listed in the [country directory](./index.md).
:::

Sri Lanka requires mandatory e-invoicing through the Inland Revenue Department's own e-Invoice
System, with each invoice validated before it reaches the buyer.

## What supporting Sri Lanka would involve

| | |
|---|---|
| **System** | e-Invoice System, run by the IRD |
| **Authority** | IRD — Inland Revenue Department |
| **Format** | A national XML schema. No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the IRD e-Invoice System. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Clearance model: pre-submission validation is required before an invoice is valid.
- A digital signature and authorised software are required to issue an invoice.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each section has to satisfy; this is only the shopping list of sections Sri Lanka would need in
`countries/data/lk.json`.

- `policy` - which document actions Sri Lanka allows. Start here: without this
  section every action is refused with a 403, naming the country.
- `identifiers` - which national identifier a party must carry.
- `taxSystem` and `vatRates` - the tax kind, and the rate ladder
  offered on an invoice line.
- `correctionRoutes` - all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2gRouting` - the channel and format a Sri Lankan public buyer requires.
- `channelPolicy` - whether a channel is legally required of a seller
  established in Sri Lanka, and from what date.
- `retention` - how long an archived document is kept, and what the duration is
  counted from.

Add `mentions`, `contentRequirements`, `countryFields`, `reporting` and
`domesticReverseCharge` sections only where the law actually gives them content.

Data alone will not finish the job here: the IRD e-Invoice System is a transmission channel this
repository does not implement, and its XML schema has no format provider. Both are code, not a JSON
file — see [When a country needs more than a file](../adding-a-country.md).

## Want Sri Lanka supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Sri Lanka, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Sri Lanka".
