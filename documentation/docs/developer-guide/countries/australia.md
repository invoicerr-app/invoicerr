---
title: "Australia e-invoicing"
description: "Australia's Peppol PINT A-NZ e-invoicing framework, and what adding Australia to Invoicerr would involve. Invoicerr does not support Australia today."
sidebar_label: "Australia"
keywords: [PINT A-NZ, Australia e-invoicing, Peppol Australia, ABN e-invoicing, Australia invoice XML]
---

# Australia e-invoicing

:::warning[Invoicerr does not support Australia]
No Australia data file exists anywhere in this repository — no country policy, no identifiers, no
tax system, no transmission channel. **Nothing on this page is implemented.** It is here so that
someone who wants Australia support knows what adding it would involve. The countries Invoicerr does
cover are listed in the [country directory](./index.md).
:::

Australia exchanges e-invoices over the Peppol Network, using the **Peppol PINT A-NZ** format
overseen by the Australian Taxation Office and the Peppol Authority. Government agencies must be
able to receive Peppol invoices; business-to-business use is voluntary but encouraged by major
accounting platforms.

## What supporting Australia would involve

| | |
|---|---|
| **System** | Peppol Network, using the PINT A-NZ specification |
| **Authority** | ATO — Australian Taxation Office, with the Peppol Authority governing the standard |
| **Format** | EN 16931 (Peppol BIS). This repository already builds and validates it (`formats/peppol-bis-provider.ts`, `formats/ubl-provider.ts`), so the format would not have to be written from scratch. |
| **Transmission** | Peppol Access Point. The Peppol transport was removed from this repository on 2026-09-15 for want of a real Access Point account, so one would have to be built. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Post-audit model; B2G reception is mandatory, B2B adoption remains voluntary.
- PINT A-NZ replaced the older BIS Billing 3.0 standard in May 2025.
- Standard GST rate is 10 percent.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Australia.

- `country-policy/data/au.json` — which document actions Australia allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/au.json` — which national identifier a party must carry.
- `tax/tax-systems/data/au.json` and `vat-rates/data/au.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/au.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/au.json` — the channel and format an Australian public buyer requires.
- `transports/channel-policy/data/au.json` — whether a channel is legally required of a seller
  established in Australia, and from what date.
- `archive/retention/data/au.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the Peppol network is a transmission channel this
repository does not implement, which is code, not a JSON file — see [When a country needs more than
a file](../adding-a-country.md).

## Want Australia supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Australia, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Australia".
