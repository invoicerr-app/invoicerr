---
title: "QR-bill — Switzerland e-invoicing"
description: "Switzerland's QR-bill payment standard and the eBill network, and what adding Switzerland would involve. Invoicerr does not support Switzerland today."
sidebar_label: "Switzerland"
keywords: [QR-bill, Switzerland e-invoicing, eBill, Swiss QR code, ZUGFeRD Switzerland]
---

# QR-bill — Switzerland e-invoicing

:::warning[Invoicerr does not support Switzerland]
No Switzerland data file exists anywhere in this repository — no country policy, no identifiers, no
tax system, no transmission channel. **Nothing on this page is implemented.** It is here so that
someone who wants Switzerland support knows what adding it would involve. The countries Invoicerr
does cover are listed in the [country directory](./index.md).
:::

Switzerland is outside the EU VAT regime and runs its own invoicing standards. Every Swiss invoice,
paper or digital, must carry the **Swiss QR-bill** payment section, a standard maintained by **SIX
Interbank Clearing**; the old ESR/BVR payment slips are retired. For fully digital invoicing,
**eBill** is the dominant network, run by SIX together with banking partners such as PostFinance.

## What supporting Switzerland would involve

| | |
|---|---|
| **System** | Swiss QR-bill, the mandatory payment-slip standard, alongside the eBill digital invoicing network |
| **Authority** | SIX Interbank Clearing (standard steward) and the Federal Tax Administration (FTA) |
| **Format** | A national payment-slip standard (the Swiss QR-bill, with ZUGFeRD as an optional hybrid PDF format). No provider in `backend/src/modules/documents/formats/` builds either today. |
| **Transmission** | The eBill network, run by SIX and its banking partners. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- QR-bill (the Swiss QR Code) is the only accepted payment-slip standard on Swiss invoices.
- eBill is the leading network for recurring digital billing, such as telecom and utility invoices.
- No clearance model — invoices are not submitted to a tax authority for pre-approval.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Switzerland.

- `country-policy/data/ch.json` — which document actions Switzerland allows. Start here: without
  this file every action is refused with a 403, naming the country.
- `country-identifiers/data/ch.json` — which national identifier a party must carry.
- `tax/tax-systems/data/ch.json` and `vat-rates/data/ch.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/ch.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/ch.json` — the channel and format a Swiss public buyer requires.
- `transports/channel-policy/data/ch.json` — whether a channel is legally required of a seller
  established in Switzerland, and from what date.
- `archive/retention/data/ch.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the eBill network is a transmission channel this repository
does not implement, and the Swiss QR-bill format has no format provider either. Both are code, not a
JSON file — see [When a country needs more than a file](../adding-a-country.md).

## Want Switzerland supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Switzerland, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Switzerland".
