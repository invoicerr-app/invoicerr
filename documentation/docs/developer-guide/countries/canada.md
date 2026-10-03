---
title: "Canada e-invoicing"
description: "Canada's e-invoicing landscape and what adding Canada to Invoicerr would involve. Invoicerr does not support Canada today."
sidebar_label: "Canada"
keywords: [Canada e-invoicing, e-invoicing Canada, Peppol Canada, Canada invoice XML]
---

# Canada e-invoicing

:::warning[Invoicerr does not support Canada]
No Canada data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Canada support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

No system, authority, or platform is documented for Canada in this repository's own research; the
only fact on record is that a Canadian e-invoicing path would route through the Peppol network.

## What supporting Canada would involve

| | |
|---|---|
| **System** | Not established here. |
| **Authority** | Not established here. |
| **Format** | EN 16931 (Peppol BIS). This repository already builds and validates it (`formats/peppol-bis-provider.ts`, `formats/ubl-provider.ts`), so the format would not have to be written from scratch. |
| **Transmission** | Peppol Access Point. The Peppol transport was removed from this repository on 2026-09-15 for want of a real Access Point account, so one would have to be built. |

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each section has to satisfy; this is only the shopping list of sections Canada would need in
`countries/data/ca.json`.

- `policy` - which document actions Canada allows. Start here: without this
  section every action is refused with a 403, naming the country.
- `identifiers` - which national identifier a party must carry.
- `taxSystem` and `vatRates` - the tax kind, and the rate ladder
  offered on an invoice line.
- `correctionRoutes` - all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2gRouting` - the channel and format a Canadian public buyer requires.
- `channelPolicy` - whether a channel is legally required of a seller
  established in Canada, and from what date.
- `retention` - how long an archived document is kept, and what the duration is
  counted from.

Add `mentions`, `contentRequirements`, `countryFields`, `reporting` and
`domesticReverseCharge` sections only where the law actually gives them content.

Data alone will not finish the job here: a Peppol Access Point is a transmission channel this
repository does not implement, which is code, not a JSON file — see [When a country needs more than
a file](../adding-a-country.md).

## Want Canada supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Canada, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Canada".
