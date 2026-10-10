---
title: "ETA — Egypt e-invoicing"
description: "Egypt's ETA e-Invoice system, and what adding Egypt to Invoicerr would involve. Invoicerr does not support Egypt today."
sidebar_label: "Egypt"
keywords: [ETA, Egypt e-invoicing, ETA e-Invoice, Egypt invoice XML]
---

# ETA — Egypt e-invoicing

:::warning[Invoicerr does not support Egypt]
No Egypt data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Egypt support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Egypt's e-invoicing system is named **ETA e-Invoice**.

## What supporting Egypt would involve

| | |
|---|---|
| **System** | ETA e-Invoice |
| **Authority** | Not established here. |
| **Format** | A national format (ETA e-Invoice). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Not established here. |

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each section has to satisfy; this is only the shopping list of sections Egypt would need in
`countries/data/eg.json`.

- `policy` - which document actions Egypt allows. Start here: without this
  section every action is refused with a 403, naming the country.
- `identifiers` - which national identifier a party must carry.
- `taxSystem` and `vatRates` - the tax kind, and the rate ladder
  offered on an invoice line.
- `correctionRoutes` - all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2gRouting` - the channel and format an Egyptian public buyer requires.
- `channelPolicy` - whether a channel is legally required of a seller
  established in Egypt, and from what date.
- `retention` - how long an archived document is kept, and what the duration is
  counted from.

Add `mentions`, `contentRequirements`, `countryFields`, `reporting` and
`domesticReverseCharge` sections only where the law actually gives them content.

Beyond those files, the work here is mostly research: this page names no national platform a
transport would have to be built for.

## Want Egypt supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Egypt, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Egypt".
