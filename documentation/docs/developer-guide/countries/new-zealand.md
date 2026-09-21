---
title: "New Zealand e-invoicing"
description: "New Zealand's Peppol PINT A-NZ e-invoicing framework, and what adding New Zealand to Invoicerr would involve. Invoicerr does not support New Zealand today."
sidebar_label: "New Zealand"
keywords: [PINT A-NZ, New Zealand e-invoicing, Peppol New Zealand, NZBN e-invoicing, New Zealand invoice XML]
---

# New Zealand e-invoicing

:::warning[Invoicerr does not support New Zealand]
No New Zealand data file exists anywhere in this repository — no country policy, no identifiers, no
tax system, no transmission channel. **Nothing on this page is implemented.** It is here so that
someone who wants New Zealand support knows what adding it would involve. The countries Invoicerr
does cover are listed in the [country directory](./index.md).
:::

New Zealand exchanges e-invoices over the Peppol Network, using the **Peppol PINT A-NZ** format
shared with Australia under the Trans-Tasman framework. The Ministry of Business, Innovation and
Employment runs the country's Peppol framework, and larger government agencies must be able to send
and receive e-invoices.

## What supporting New Zealand would involve

| | |
|---|---|
| **System** | Peppol Network, using the PINT A-NZ specification (shared with Australia) |
| **Authority** | MBIE — Ministry of Business, Innovation and Employment |
| **Format** | EN 16931 (Peppol BIS). This repository already builds and validates it (`formats/peppol-bis-provider.ts`, `formats/ubl-provider.ts`), so the format would not have to be written from scratch. |
| **Transmission** | Peppol Access Point. The Peppol transport was removed from this repository on 2026-09-15 for want of a real Access Point account, so one would have to be built. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Central agencies must already be able to receive Peppol invoices; larger agencies must send and
  receive from January 2026.
- Large suppliers are expected to be required to send e-invoices to government from 2027.
- Standard GST rate is 15 percent.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for New Zealand.

- `country-policy/data/nz.json` — which document actions New Zealand allows. Start here: without
  this file every action is refused with a 403, naming the country.
- `country-identifiers/data/nz.json` — which national identifier a party must carry.
- `tax/tax-systems/data/nz.json` and `vat-rates/data/nz.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/nz.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/nz.json` — the channel and format a public buyer in New Zealand requires.
- `transports/channel-policy/data/nz.json` — whether a channel is legally required of a seller
  established in New Zealand, and from what date.
- `archive/retention/data/nz.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the Peppol network is a transmission channel this
repository does not implement, which is code, not a JSON file — see [When a country needs more than
a file](../adding-a-country.md).

## Want New Zealand supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for New Zealand, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add New Zealand".
