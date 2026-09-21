---
title: "Netherlands e-invoicing"
description: "The Netherlands' Peppol-based e-invoicing and SI-UBL format, and what adding the Netherlands to Invoicerr would involve. Invoicerr does not support the Netherlands today."
sidebar_label: "Netherlands"
keywords: [Netherlands e-invoicing, SI-UBL, NLCIUS, Digipoort, Peppol Netherlands]
---

# Netherlands e-invoicing

:::warning[Invoicerr does not support the Netherlands]
No Netherlands data file exists anywhere in this repository — no country policy, no identifiers, no
tax system, no transmission channel. **Nothing on this page is implemented.** It is here so that
someone who wants Netherlands support knows what adding it would involve. The countries Invoicerr
does cover are listed in the [country directory](./index.md).
:::

Dutch government suppliers deliver over the **Peppol** network, addressed with the OIN or KVK
identifier, with Logius operating the Digipoort hub behind it and the NPa (Nederlandse
Peppolautoriteit) regulating the Peppol side. The invoice format is **SI-UBL 2.0**, the Dutch
implementation of EN 16931 (NLCIUS).

## What supporting the Netherlands would involve

| | |
|---|---|
| **System** | Peppol Network, with Logius / Digipoort behind it |
| **Authority** | Logius (Digipoort) and the NPa (Nederlandse Peppolautoriteit) |
| **Format** | EN 16931 (Peppol BIS). This repository already builds and validates it (`formats/peppol-bis-provider.ts`, `formats/ubl-provider.ts`), so the format would not have to be written from scratch. |
| **Transmission** | Peppol Access Point. The Peppol transport was removed from this repository on 2026-09-15 for want of a real Access Point account, so one would have to be built. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- B2G e-invoicing cited as mandatory for Central Government since 2017 and for local government
  since 2019.
- B2B e-invoicing remains voluntary, with no mandate as of 2026.
- Model described as post-audit, not clearance.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for the Netherlands.

- `country-policy/data/nl.json` — which document actions the Netherlands allows. Start here: without
  this file every action is refused with a 403, naming the country.
- `country-identifiers/data/nl.json` — which national identifier a party must carry.
- `tax/tax-systems/data/nl.json` and `vat-rates/data/nl.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/nl.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/nl.json` — the channel and format a Dutch public buyer requires.
- `transports/channel-policy/data/nl.json` — whether a channel is legally required of a seller
  established in the Netherlands, and from what date.
- `archive/retention/data/nl.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the Peppol network is a transmission channel this
repository does not implement, which is code, not a JSON file — see [When a country needs more than
a file](../adding-a-country.md).

## Want the Netherlands supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for the Netherlands, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add the
Netherlands".
