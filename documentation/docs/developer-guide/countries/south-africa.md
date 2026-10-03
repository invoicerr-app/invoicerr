---
title: "SARS — South Africa e-invoicing"
description: "South Africa's planned SARS e-invoicing system, and what adding South Africa to Invoicerr would involve. Invoicerr does not support South Africa today."
sidebar_label: "South Africa"
keywords: [SARS, South Africa e-invoicing, Peppol South Africa, South Africa invoice XML]
---

# SARS — South Africa e-invoicing

:::warning[Invoicerr does not support South Africa]
No South Africa data file exists anywhere in this repository — no country policy, no identifiers, no
tax system, no transmission channel. **Nothing on this page is implemented.** It is here so that
someone who wants South Africa support knows what adding it would involve. The countries Invoicerr
does cover are listed in the [country directory](./index.md).
:::

South Africa's e-invoicing is being developed by **SARS**, the South African Revenue Service, as
part of its VAT Modernisation Project. E-invoicing today is voluntary, subject to SARS's technical
requirements, with a Peppol-based model under consideration for the planned mandate.

## What supporting South Africa would involve

| | |
|---|---|
| **System** | SARS e-Invoice System (under development) |
| **Authority** | SARS — South African Revenue Service |
| **Format** | A national format, not yet fixed — draft plans point toward a Peppol-based UBL model. No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to SARS's planned e-invoice reporting system, possibly over the Peppol network. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- E-invoicing has been voluntary, subject to SARS technical requirements, since December 2021.
- Mandatory e-invoicing is expected from 2028, following draft legislation moving through 2025-2026.
- A clearance or continuous-transaction-control model, and a Peppol-based five-corner routing, are
  both described as under consideration rather than decided.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each section has to satisfy; this is only the shopping list of sections South Africa would need in
`countries/data/za.json`.

- `policy` - which document actions South Africa allows. Start here: without this
  section every action is refused with a 403, naming the country.
- `identifiers` - which national identifier a party must carry.
- `taxSystem` and `vatRates` - the tax kind, and the rate ladder
  offered on an invoice line.
- `correctionRoutes` - all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2gRouting` - the channel and format a South African public buyer requires.
- `channelPolicy` - whether a channel is legally required of a seller
  established in South Africa, and from what date.
- `retention` - how long an archived document is kept, and what the duration is
  counted from.

Add `mentions`, `contentRequirements`, `countryFields`, `reporting` and
`domesticReverseCharge` sections only where the law actually gives them content.

Data alone will not finish the job here: SARS's planned e-invoice reporting system is a transmission
channel this repository does not implement, and its format has not been fixed either. Both are code,
not a JSON file — see [When a country needs more than a file](../adding-a-country.md).

## Want South Africa supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for South Africa, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add South Africa".
