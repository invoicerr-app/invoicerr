---
title: "KRA — Kenya e-invoicing"
description: "Kenya's KRA e-invoicing system (eTIMS), and what adding Kenya to Invoicerr would involve. Invoicerr does not support Kenya today."
sidebar_label: "Kenya"
keywords: [KRA, eTIMS, Kenya e-invoicing, Kenya invoice XML]
---

# KRA — Kenya e-invoicing

:::warning[Invoicerr does not support Kenya]
No Kenya data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Kenya support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Kenya's e-invoicing is administered by the **KRA**, the Kenya Revenue Authority, through the iTax /
e-Tax System, also referred to as eTIMS.

## What supporting Kenya would involve

| | |
|---|---|
| **System** | KRA iTax / e-Tax System (eTIMS) |
| **Authority** | KRA — Kenya Revenue Authority |
| **Format** | A national format (eTIMS). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission through the KRA iTax / e-Tax System. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Progressive rollout: large taxpayers mandated from 2020, extended to all businesses from 2024.
- Described as a clearance model, with pre-registration and real-time validation required.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each section has to satisfy; this is only the shopping list of sections Kenya would need in
`countries/data/ke.json`.

- `policy` - which document actions Kenya allows. Start here: without this
  section every action is refused with a 403, naming the country.
- `identifiers` - which national identifier a party must carry.
- `taxSystem` and `vatRates` - the tax kind, and the rate ladder
  offered on an invoice line.
- `correctionRoutes` - all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2gRouting` - the channel and format a Kenyan public buyer requires.
- `channelPolicy` - whether a channel is legally required of a seller
  established in Kenya, and from what date.
- `retention` - how long an archived document is kept, and what the duration is
  counted from.

Add `mentions`, `contentRequirements`, `countryFields`, `reporting` and
`domesticReverseCharge` sections only where the law actually gives them content.

Data alone will not finish the job here: the KRA iTax / e-Tax System is a transmission channel this
repository does not implement, and the eTIMS format has no format provider. Both are code, not a
JSON file — see [When a country needs more than a file](../adding-a-country.md).

## Want Kenya supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Kenya, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Kenya".
