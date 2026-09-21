---
title: "GİB e-Fatura — Turkey e-invoicing"
description: "Turkey's e-Fatura/e-Arşiv clearance system run by GİB, and what adding Turkey to Invoicerr would involve. Invoicerr does not support Turkey today."
sidebar_label: "Turkey"
keywords: [GİB, e-Fatura, Turkey e-invoicing, e-Arşiv, UBL-TR]
---

# GİB e-Fatura — Turkey e-invoicing

:::warning[Invoicerr does not support Turkey]
No Turkey data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Turkey support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Turkey's e-invoicing is run by **GİB** (Gelir İdaresi Başkanlığı, the Revenue Administration) under
the **e-Belge** (e-Document) umbrella, split into **e-Fatura** for recipients registered in the
system and **e-Arşiv** for everyone else.

## What supporting Turkey would involve

| | |
|---|---|
| **System** | e-Belge, covering e-Fatura and e-Arşiv |
| **Authority** | GİB — Gelir İdaresi Başkanlığı (Revenue Administration) |
| **Format** | A national XML schema (UBL-TR 1.2). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | GİB's e-Belge system, typically reached through a certified private integrator. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- e-Fatura cited as mandatory B2B when the recipient is registered in the system; e-Arşiv otherwise.
- A near-total paper-invoice ban is cited as taking effect in January 2026.
- Signing is cited as requiring a "Mali Mühür" (financial seal) qualified certificate, usually
  delegated to an integrator.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Turkey.

- `country-policy/data/tr.json` — which document actions Turkey allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/tr.json` — which national identifier a party must carry.
- `tax/tax-systems/data/tr.json` and `vat-rates/data/tr.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/tr.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/tr.json` — the channel and format a Turkish public buyer requires.
- `transports/channel-policy/data/tr.json` — whether a channel is legally required of a seller
  established in Turkey, and from what date.
- `archive/retention/data/tr.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: GİB's e-Belge system is a transmission channel this
repository does not implement, and UBL-TR has no format provider. Both are code, not a JSON file —
see [When a country needs more than a file](../adding-a-country.md).

## Want Turkey supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Turkey, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Turkey".
