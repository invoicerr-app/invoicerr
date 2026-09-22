---
title: "United Kingdom e-invoicing"
description: "The United Kingdom's Peppol mandate for NHS suppliers, and what adding the United Kingdom would involve. Invoicerr does not support the United Kingdom today."
sidebar_label: "United Kingdom"
keywords: [United Kingdom e-invoicing, Peppol UK, NHS e-invoicing, UK invoice XML, HMRC]
---

# United Kingdom e-invoicing

:::warning[Invoicerr does not support the United Kingdom]
No United Kingdom data file exists anywhere in this repository — no country policy, no identifiers,
no tax system, no transmission channel. **Nothing on this page is implemented.** It is here so that
someone who wants United Kingdom support knows what adding it would involve. The countries Invoicerr
does cover are listed in the [country directory](./index.md).
:::

The United Kingdom has no general e-invoicing mandate yet, but suppliers to the **NHS** must send
e-invoices over the **Peppol** network, under **HMRC** (His Majesty's Revenue and Customs).
Separately, Making Tax Digital requires businesses to keep digital VAT records and submit returns
through an API — it does not itself require sending structured e-invoices to customers. A universal
B2B mandate has been proposed but is not yet confirmed.

## What supporting the United Kingdom would involve

| | |
|---|---|
| **System** | Peppol BIS Billing 3.0 e-invoicing, mandatory for suppliers to the NHS and used voluntarily elsewhere |
| **Authority** | HMRC (His Majesty's Revenue and Customs); the NHS separately mandates Peppol for its own suppliers |
| **Format** | EN 16931 (Peppol BIS). This repository already builds and validates it (`formats/peppol-bis-provider.ts`, `formats/ubl-provider.ts`), so the format would not have to be written from scratch. |
| **Transmission** | Peppol Access Point. The Peppol transport was removed from this repository on 2026-09-15 for want of a real Access Point account, so one would have to be built. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Making Tax Digital requires digital VAT record-keeping and return submission, but does not
  itself mandate sending e-invoices.
- The NHS operates a strict "no purchase order, no payment" policy tied to the invoice's Peppol
  order reference.
- A universal B2B e-invoicing mandate has been proposed for April 2029, not yet confirmed.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for the United Kingdom.

- `country-policy/data/gb.json` — which document actions the United Kingdom allows. Start here:
  without this file every action is refused with a 403, naming the country.
- `country-identifiers/data/gb.json` — which national identifier a party must carry.
- `tax/tax-systems/data/gb.json` and `vat-rates/data/gb.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/gb.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/gb.json` — the channel and format a public buyer in the United Kingdom requires.
- `transports/channel-policy/data/gb.json` — whether a channel is legally required of a seller
  established in the United Kingdom, and from what date.
- `archive/retention/data/gb.json` — how long an archived document is kept, and what the duration
  is counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the Peppol network is a transmission channel this
repository does not implement, which is code, not a JSON file — see [When a country needs more than
a file](../adding-a-country.md).

## Want the United Kingdom supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for the United Kingdom, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add the United
Kingdom".
