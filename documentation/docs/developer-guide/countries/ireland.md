---
title: "Ireland e-invoicing"
description: "Ireland's Peppol-based B2G e-invoicing mandate and its phased ViDA roadmap, and what adding Ireland would involve. Invoicerr does not support Ireland today."
sidebar_label: "Ireland"
keywords: [Ireland e-invoicing, Peppol Ireland, Revenue Commissioners, Ireland invoice XML, ROS]
---

# Ireland e-invoicing

:::warning[Invoicerr does not support Ireland]
No Ireland data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Ireland support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Ireland has required public bodies to receive e-invoices since 2019, under EU Directive 2014/55/EU,
delivered over the **Peppol** network to buyers registered with **Revenue** (the Revenue
Commissioners). B2B e-invoicing is voluntary today, but Revenue announced a phased domestic mandate
in October 2025 that would extend it to all VAT-registered businesses.

## What supporting Ireland would involve

| | |
|---|---|
| **System** | Peppol e-invoicing for Ireland's public-sector buyers, under EU Directive 2014/55/EU |
| **Authority** | Revenue Commissioners (Revenue) |
| **Format** | EN 16931 (Peppol BIS). This repository already builds and validates it (`formats/peppol-bis-provider.ts`, `formats/ubl-provider.ts`), so the format would not have to be written from scratch. |
| **Transmission** | Peppol Access Point. The Peppol transport was removed from this repository on 2026-09-15 for want of a real Access Point account, so one would have to be built. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- B2G e-invoice receiving has been mandatory since April 2019 for central bodies, and since April
  2020 for all public entities.
- Revenue's October 2025 roadmap phases in a domestic B2B mandate between 2028 and 2030, starting
  with large VAT-registered businesses.
- Future reporting is expected to tie into VIES, the EU's cross-border VAT information exchange.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Ireland.

- `country-policy/data/ie.json` — which document actions Ireland allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/ie.json` — which national identifier a party must carry.
- `tax/tax-systems/data/ie.json` and `vat-rates/data/ie.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/ie.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/ie.json` — the channel and format an Irish public buyer requires.
- `transports/channel-policy/data/ie.json` — whether a channel is legally required of a seller
  established in Ireland, and from what date.
- `archive/retention/data/ie.json` — how long an archived document is kept, and what the duration
  is counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the Peppol network is a transmission channel this
repository does not implement, which is code, not a JSON file — see [When a country needs more than
a file](../adding-a-country.md).

## Want Ireland supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Ireland, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Ireland".
