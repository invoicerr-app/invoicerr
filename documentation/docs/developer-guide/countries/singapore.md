---
title: "InvoiceNow — Singapore e-invoicing"
description: "Singapore's InvoiceNow (Peppol PINT-SG) e-invoicing network, and what adding Singapore to Invoicerr would involve. Invoicerr does not support Singapore today."
sidebar_label: "Singapore"
keywords: [InvoiceNow, PINT-SG, Singapore e-invoicing, Peppol Singapore, UEN e-invoicing]
---

# InvoiceNow — Singapore e-invoicing

:::warning[Invoicerr does not support Singapore]
No Singapore data file exists anywhere in this repository — no country policy, no identifiers, no
tax system, no transmission channel. **Nothing on this page is implemented.** It is here so that
someone who wants Singapore support knows what adding it would involve. The countries Invoicerr does
cover are listed in the [country directory](./index.md).
:::

Singapore's national e-invoicing network is called **InvoiceNow**, built on the Peppol network and
governed jointly by IMDA and IRAS. Invoices use the **Peppol PINT-SG** format, and GST-registered
businesses on InvoiceNow transmit invoice data to IRAS through the same channel used to deliver the
invoice to the buyer.

## What supporting Singapore would involve

| | |
|---|---|
| **System** | InvoiceNow, Singapore's national Peppol network, using the PINT-SG format |
| **Authority** | IRAS — Inland Revenue Authority of Singapore, with IMDA running the InvoiceNow network |
| **Format** | EN 16931 (Peppol BIS). This repository already builds and validates it (`formats/peppol-bis-provider.ts`, `formats/ubl-provider.ts`), so the format would not have to be written from scratch. |
| **Transmission** | Peppol Access Point. The Peppol transport was removed from this repository on 2026-09-15 for want of a real Access Point account, so one would have to be built. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- New GST registrants are being brought onto mandatory InvoiceNow transmission in phases from late
  2025 into 2026.
- The Access Point forwards each invoice to the buyer and to IRAS at the same time, rather than as a
  separate reporting step.
- Standard GST rate is 9 percent.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Singapore.

- `country-policy/data/sg.json` — which document actions Singapore allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/sg.json` — which national identifier a party must carry.
- `tax/tax-systems/data/sg.json` and `vat-rates/data/sg.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/sg.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/sg.json` — the channel and format a Singaporean public buyer requires.
- `transports/channel-policy/data/sg.json` — whether a channel is legally required of a seller
  established in Singapore, and from what date.
- `archive/retention/data/sg.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the Peppol network is a transmission channel this
repository does not implement, which is code, not a JSON file — see [When a country needs more than
a file](../adding-a-country.md).

## Want Singapore supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Singapore, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Singapore".
