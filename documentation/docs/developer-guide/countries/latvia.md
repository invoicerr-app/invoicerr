---
title: "EDS — Latvia e-invoicing"
description: "Latvia's EDS/eAddress e-invoicing platforms, and what adding Latvia to Invoicerr would involve. Invoicerr does not support Latvia today."
sidebar_label: "Latvia"
keywords: [EDS, Latvia e-invoicing, eAddress, Latvia invoice XML]
---

# EDS — Latvia e-invoicing

:::warning[Invoicerr does not support Latvia]
No Latvia data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Latvia support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Latvia's e-invoicing runs through the **EDS** (Electronic Declaration System) and the free
**eAddress** platform operated by the VDAA, under the State Revenue Service (VID). A government B2B
platform is due to open in 2026.

## What supporting Latvia would involve

| | |
|---|---|
| **System** | EDS (Electronic Declaration System) and eAddress |
| **Authority** | State Revenue Service (VID) |
| **Format** | EN 16931 (Peppol BIS). This repository already builds and validates it (`formats/peppol-bis-provider.ts`, `formats/ubl-provider.ts`), so the format would not have to be written from scratch. |
| **Transmission** | EDS / eAddress. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- B2G e-invoicing cited as mandatory from January 2025.
- A B2B government platform is cited as opening in March 2026, with a full B2B mandate cited from
  January 2028.
- Model described as near real-time reporting to VID, not plain post-audit.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Latvia.

- `country-policy/data/lv.json` — which document actions Latvia allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/lv.json` — which national identifier a party must carry.
- `tax/tax-systems/data/lv.json` and `vat-rates/data/lv.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/lv.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/lv.json` — the channel and format a Latvian public buyer requires.
- `transports/channel-policy/data/lv.json` — whether a channel is legally required of a seller
  established in Latvia, and from what date.
- `archive/retention/data/lv.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: EDS / eAddress is a transmission channel this repository
does not implement, which is code, not a JSON file — see [When a country needs more than a
file](../adding-a-country.md).

## Want Latvia supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Latvia, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Latvia".
