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
the contract each file has to satisfy; this is only the shopping list for United States.

- `country-policy/data/us.json` — which document actions United States allows. Start here: without
  this file every action is refused with a 403, naming the country.
- `country-identifiers/data/us.json` — which national identifier a party must carry.
- `tax/tax-systems/data/us.json` and `vat-rates/data/us.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/us.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/us.json` — the channel and format a public buyer in the United States requires.
- `transports/channel-policy/data/us.json` — whether a channel is legally required of a seller
  established in United States, and from what date.
- `archive/retention/data/us.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

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
