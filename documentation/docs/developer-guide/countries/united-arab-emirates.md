---
title: "United Arab Emirates e-invoicing"
description: "The UAE's e-invoicing mandate, run by the FTA over Peppol, and what adding it to Invoicerr would involve. Invoicerr does not support the United Arab Emirates today."
sidebar_label: "United Arab Emirates"
keywords: [UAE e-invoicing, FTA, Peppol PINT AE, United Arab Emirates invoice XML]
---

# United Arab Emirates e-invoicing

:::warning[Invoicerr does not support the United Arab Emirates]
No United Arab Emirates data file exists anywhere in this repository — no country policy, no
identifiers, no tax system, no transmission channel. **Nothing on this page is implemented.** It is
here so that someone who wants United Arab Emirates support knows what adding it would involve. The
countries Invoicerr does cover are listed in the [country directory](./index.md).
:::

The United Arab Emirates runs its e-invoicing mandate through the FTA, the Federal Tax Authority, on
its own e-Invoice Management System. Invoices travel over the Peppol network using the PINT AE
profile, a UAE-localized version of the international PINT invoice model.

## What supporting the United Arab Emirates would involve

| | |
|---|---|
| **System** | e-Invoice Management System, over the Peppol network's PINT AE profile |
| **Authority** | FTA — Federal Tax Authority |
| **Format** | EN 16931 (Peppol BIS). This repository already builds and validates it (`formats/peppol-bis-provider.ts`, `formats/ubl-provider.ts`), so the format would not have to be written from scratch. |
| **Transmission** | Peppol Access Point. The Peppol transport was removed from this repository on 2026-09-15 for want of a real Access Point account, so one would have to be built. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Progressive rollout beginning 2021, full mandatory e-invoicing for all VAT taxpayers by 2023, a
  B2C framework added from 2025.
- Clearance model: real-time validation for B2B transactions.
- VAT rate 5% standard, 0% on exports.
- Archive retention 6 years.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for the United Arab Emirates.

- `country-policy/data/ae.json` — which document actions the United Arab Emirates allows. Start
  here: without this file every action is refused with a 403, naming the country.
- `country-identifiers/data/ae.json` — which national identifier a party must carry.
- `tax/tax-systems/data/ae.json` and `vat-rates/data/ae.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/ae.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/ae.json` — the channel and format a public buyer in the United Arab Emirates
  requires.
- `transports/channel-policy/data/ae.json` — whether a channel is legally required of a seller
  established in the United Arab Emirates, and from what date.
- `archive/retention/data/ae.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: a Peppol Access Point connection is a transmission channel
this repository does not implement, which is code, not a JSON file — see [When a country needs more
than a file](../adding-a-country.md).

## Want the United Arab Emirates supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for the United Arab Emirates, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add the United
Arab Emirates".
