---
title: "FIRS — Nigeria e-invoicing"
description: "Nigeria's FIRS e-invoicing system, and what adding Nigeria to Invoicerr would involve. Invoicerr does not support Nigeria today."
sidebar_label: "Nigeria"
keywords: [FIRS, Nigeria e-invoicing, FIRS e-Invoice, Nigeria invoice XML]
---

# FIRS — Nigeria e-invoicing

:::warning[Invoicerr does not support Nigeria]
No Nigeria data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Nigeria support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Nigeria's e-invoicing is administered by the **FIRS**, the Federal Inland Revenue Service, through
its e-Invoice System, built around TIN verification and referred to as FIRS e-Invoice.

## What supporting Nigeria would involve

| | |
|---|---|
| **System** | FIRS e-Invoice System (TIN and e-Invoice) |
| **Authority** | FIRS — Federal Inland Revenue Service |
| **Format** | A national format (FIRS e-Invoice). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the FIRS e-Invoice System. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Progressive rollout: large taxpayers mandated from 2021, extended to all businesses from 2024.
- Described as a clearance model built around TIN and e-Invoice verification.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each section has to satisfy; this is only the shopping list of sections Nigeria would need in
`countries/data/ng.json`.

- `policy` - which document actions Nigeria allows. Start here: without this
  section every action is refused with a 403, naming the country.
- `identifiers` - which national identifier a party must carry.
- `taxSystem` and `vatRates` - the tax kind, and the rate ladder
  offered on an invoice line.
- `correctionRoutes` - all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2gRouting` - the channel and format a Nigerian public buyer requires.
- `channelPolicy` - whether a channel is legally required of a seller
  established in Nigeria, and from what date.
- `retention` - how long an archived document is kept, and what the duration is
  counted from.

Add `mentions`, `contentRequirements`, `countryFields`, `reporting` and
`domesticReverseCharge` sections only where the law actually gives them content.

Data alone will not finish the job here: the FIRS e-Invoice System is a transmission channel this
repository does not implement, and the FIRS e-Invoice format has no format provider. Both are code,
not a JSON file — see [When a country needs more than a file](../adding-a-country.md).

## Want Nigeria supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Nigeria, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Nigeria".
