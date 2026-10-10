---
title: "United States e-invoicing"
description: "The United States' e-invoicing landscape and what adding it to Invoicerr would involve. Invoicerr does not support the United States today."
sidebar_label: "United States"
keywords: [United States e-invoicing, e-invoicing United States, Peppol USA, US invoice XML]
---

# United States e-invoicing

:::warning[Invoicerr does not support the United States]
No United States data file exists anywhere in this repository — no country policy, no identifiers,
no tax system, no transmission channel. **Nothing on this page is implemented.** It is here so that
someone who wants United States support knows what adding it would involve. The countries Invoicerr
does cover are listed in the [country directory](./index.md).
:::

No system, authority, or platform is documented for the United States in this repository's own
research; the only fact on record is that a United States e-invoicing path would route through the
Peppol network.

## What supporting United States would involve

| | |
|---|---|
| **System** | Not established here. |
| **Authority** | Not established here. |
| **Format** | EN 16931 (Peppol BIS). This repository already builds and validates it (`formats/peppol-bis-provider.ts`, `formats/ubl-provider.ts`), so the format would not have to be written from scratch. |
| **Transmission** | Peppol Access Point. The Peppol transport was removed from this repository on 2026-09-15 for want of a real Access Point account, so one would have to be built. |

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each section has to satisfy; this is only the shopping list of sections United States would need in
`countries/data/us.json`.

- `policy` - which document actions United States allows. Start here: without this
  section every action is refused with a 403, naming the country.
- `identifiers` - which national identifier a party must carry.
- `taxSystem` and `vatRates` - the tax kind, and the rate ladder
  offered on an invoice line.
- `correctionRoutes` - all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2gRouting` - the channel and format a public buyer in the United States requires.
- `channelPolicy` - whether a channel is legally required of a seller
  established in United States, and from what date.
- `retention` - how long an archived document is kept, and what the duration is
  counted from.

Add `mentions`, `contentRequirements`, `countryFields`, `reporting` and
`domesticReverseCharge` sections only where the law actually gives them content.

Data alone will not finish the job here: a Peppol Access Point is a transmission channel this
repository does not implement, which is code, not a JSON file — see [When a country needs more than
a file](../adding-a-country.md).

## Want United States supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for United States, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add United
States".
