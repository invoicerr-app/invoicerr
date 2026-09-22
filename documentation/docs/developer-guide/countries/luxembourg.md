---
title: "Luxembourg e-invoicing"
description: "Luxembourg's Peppol-based e-invoicing, and what adding Luxembourg to Invoicerr would involve. Invoicerr does not support Luxembourg today."
sidebar_label: "Luxembourg"
keywords: [Luxembourg e-invoicing, Peppol Luxembourg, CTIE, Luxembourg invoice XML]
---

# Luxembourg e-invoicing

:::warning[Invoicerr does not support Luxembourg]
No Luxembourg data file exists anywhere in this repository — no country policy, no identifiers, no
tax system, no transmission channel. **Nothing on this page is implemented.** It is here so that
someone who wants Luxembourg support knows what adding it would involve. The countries Invoicerr
does cover are listed in the [country directory](./index.md).
:::

Luxembourg routes its e-invoicing mandate over the **Peppol** network, with the CTIE (Centre des
Technologies de l'Information de l'État) handling government-side processing through the MyGuichet
portal. The Administration des contributions directes is the tax authority.

## What supporting Luxembourg would involve

| | |
|---|---|
| **System** | Peppol Network, with CTIE / MyGuichet on the government side |
| **Authority** | Administration des contributions directes — Tax Administration |
| **Format** | EN 16931 (Peppol BIS). This repository already builds and validates it (`formats/peppol-bis-provider.ts`, `formats/ubl-provider.ts`), so the format would not have to be written from scratch. |
| **Transmission** | Peppol Access Point. The Peppol transport was removed from this repository on 2026-09-15 for want of a real Access Point account, so one would have to be built. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- B2G e-invoicing became fully mandatory for all company sizes in January 2023, after a phased
  rollout starting with large enterprises in May 2022.
- B2B e-invoicing remains voluntary.
- Archive retention cited at 10 years.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Luxembourg.

- `country-policy/data/lu.json` — which document actions Luxembourg allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/lu.json` — which national identifier a party must carry.
- `tax/tax-systems/data/lu.json` and `vat-rates/data/lu.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/lu.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/lu.json` — the channel and format a public buyer in Luxembourg requires.
- `transports/channel-policy/data/lu.json` — whether a channel is legally required of a seller
  established in Luxembourg, and from what date.
- `archive/retention/data/lu.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the Peppol network is a transmission channel this
repository does not implement, which is code, not a JSON file — see [When a country needs more than
a file](../adding-a-country.md).

## Want Luxembourg supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Luxembourg, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Luxembourg".
