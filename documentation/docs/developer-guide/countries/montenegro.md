---
title: "Montenegro e-invoicing"
description: "Montenegro's fiscal-device reporting system, and what adding Montenegro to Invoicerr would involve. Invoicerr does not support Montenegro today."
sidebar_label: "Montenegro"
keywords: [Montenegro e-invoicing, e-fiscalization, Poreska uprava, Montenegro fiscal devices]
---

# Montenegro e-invoicing

:::warning[Invoicerr does not support Montenegro]
No Montenegro data file exists anywhere in this repository — no country policy, no identifiers, no
tax system, no transmission channel. **Nothing on this page is implemented.** It is here so that
someone who wants Montenegro support knows what adding it would involve. The countries Invoicerr
does cover are listed in the [country directory](./index.md).
:::

Montenegro's current system is e-fiscalization: certified fiscal devices report transactions in real
time to the Poreska uprava (Tax Administration) through its Fiscal Control System. A dedicated B2B
e-invoicing framework, separate from this retail fiscalization, is still being developed.

## What supporting Montenegro would involve

| | |
|---|---|
| **System** | Fiscal Control System (FCS), driven by certified fiscal devices |
| **Authority** | Poreska uprava — Tax Administration |
| **Format** | Not established here. The source names only a generic fiscal-receipt format for retail devices; no B2B e-invoicing XML schema is named. |
| **Transmission** | Fiscal Control System (FCS). No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Fiscal device certification is cited as required for retail transactions.
- A B2B e-invoicing framework is described as still under development, with no confirmed date.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Montenegro.

- `country-policy/data/me.json` — which document actions Montenegro allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/me.json` — which national identifier a party must carry.
- `tax/tax-systems/data/me.json` and `vat-rates/data/me.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/me.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/me.json` — the channel and format a Montenegrin public buyer requires.
- `transports/channel-policy/data/me.json` — whether a channel is legally required of a seller
  established in Montenegro, and from what date.
- `archive/retention/data/me.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the Fiscal Control System is a transmission channel this
repository does not implement, and no B2B e-invoicing format has been established to build against.
Both are code, not a JSON file — see [When a country needs more than a
file](../adding-a-country.md).

## Want Montenegro supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Montenegro, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Montenegro".
