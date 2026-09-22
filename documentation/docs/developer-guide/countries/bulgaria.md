---
title: "NIS — Bulgaria e-invoicing"
description: "Bulgaria's NIS e-invoicing platform for B2G, run by the NRA, and what adding Bulgaria would involve. Invoicerr does not support Bulgaria today."
sidebar_label: "Bulgaria"
keywords: [NIS, Bulgaria e-invoicing, Bulgaria invoice XML, NRA, SAF-T Bulgaria]
---

# NIS — Bulgaria e-invoicing

:::warning[Invoicerr does not support Bulgaria]
No Bulgaria data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Bulgaria support knows what adding it would involve. The countries Invoicerr does cover
are listed in the [country directory](./index.md).
:::

Bulgaria's B2G e-invoicing runs through **NIS** (National Information System), the platform operated
by the **NRA** (National Revenue Agency) for public-procurement invoices. B2B e-invoicing remains
voluntary, with direct delivery between trading partners rather than a clearance step. Bulgaria is
separately preparing a SAF-T reporting regime.

## What supporting Bulgaria would involve

| | |
|---|---|
| **System** | NIS — National Information System, Bulgaria's B2G e-invoicing platform |
| **Authority** | National Revenue Agency (NRA) |
| **Format** | EN 16931 (Peppol BIS). This repository already builds and validates it (`formats/peppol-bis-provider.ts`, `formats/ubl-provider.ts`), so the format would not have to be written from scratch. |
| **Transmission** | NIS (National Information System), Bulgaria's B2G e-invoicing platform. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- B2G e-invoicing through NIS has been mandatory since 2016.
- B2B e-invoicing is voluntary and post-audit — no clearance step, invoices go directly to the
  buyer.
- SAF-T reporting is being phased in, starting with large enterprises.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Bulgaria.

- `country-policy/data/bg.json` — which document actions Bulgaria allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/bg.json` — which national identifier a party must carry.
- `tax/tax-systems/data/bg.json` and `vat-rates/data/bg.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/bg.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/bg.json` — the channel and format a Bulgarian public buyer requires.
- `transports/channel-policy/data/bg.json` — whether a channel is legally required of a seller
  established in Bulgaria, and from what date.
- `archive/retention/data/bg.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the NIS platform is a transmission channel this repository
does not implement, which is code, not a JSON file — see [When a country needs more than a
file](../adding-a-country.md).

## Want Bulgaria supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Bulgaria, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Bulgaria".
