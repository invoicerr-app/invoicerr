---
title: "CIS — Albania e-invoicing"
description: "Albania's CIS e-invoicing platform, run by the DPT, and what adding Albania to Invoicerr would involve. Invoicerr does not support Albania today."
sidebar_label: "Albania"
keywords: [CIS, Albania e-invoicing, e-Fatura, Albania invoice XML, DPT]
---

# CIS — Albania e-invoicing

:::warning[Invoicerr does not support Albania]
No Albania data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Albania support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Albania's e-invoicing runs through the **CIS** (Central Information System), the government platform
operated by the **DPT** (General Directorate of Taxation), also reachable at the e-Fatura portal.
Invoices are submitted to CIS for validation before they reach the buyer.

## What supporting Albania would involve

| | |
|---|---|
| **System** | Central Information System (CIS) |
| **Authority** | DPT — General Directorate of Taxation |
| **Format** | EN 16931 (Peppol BIS). This repository already builds and validates it (`formats/peppol-bis-provider.ts`, `formats/ubl-provider.ts`), so the format would not have to be written from scratch. |
| **Transmission** | The Central Information System (CIS), Albania's national e-invoicing clearance platform. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Mandatory for B2B invoicing since 2021.
- Clearance model — invoices are validated by the tax authority before issuance.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Albania.

- `country-policy/data/al.json` — which document actions Albania allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/al.json` — which national identifier a party must carry.
- `tax/tax-systems/data/al.json` and `vat-rates/data/al.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/al.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/al.json` — the channel and format an Albanian public buyer requires.
- `transports/channel-policy/data/al.json` — whether a channel is legally required of a seller
  established in Albania, and from what date.
- `archive/retention/data/al.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the CIS platform is a transmission channel this repository
does not implement, which is code, not a JSON file — see [When a country needs more than a
file](../adding-a-country.md).

## Want Albania supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Albania, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Albania".
