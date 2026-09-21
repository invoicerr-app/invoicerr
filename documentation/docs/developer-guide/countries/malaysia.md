---
title: "MyInvois — Malaysia e-invoicing"
description: "Malaysia's MyInvois clearance system run by LHDNM, and what adding Malaysia to Invoicerr would involve. Invoicerr does not support Malaysia today."
sidebar_label: "Malaysia"
keywords: [MyInvois, Malaysia e-invoicing, LHDNM, IRBM, Malaysia invoice XML]
---

# MyInvois — Malaysia e-invoicing

:::warning[Invoicerr does not support Malaysia]
No Malaysia data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Malaysia support knows what adding it would involve. The countries Invoicerr does cover
are listed in the [country directory](./index.md).
:::

Malaysia clears every invoice through **MyInvois**, the Inland Revenue Board's own validation
platform: an invoice is not legal until MyInvois returns a Unique Identifier Number and a validation
link, which the seller embeds as a QR code on the document shown to the buyer.

## What supporting Malaysia would involve

| | |
|---|---|
| **System** | MyInvois |
| **Authority** | LHDNM — Inland Revenue Board of Malaysia (IRBM) |
| **Format** | A national schema (UBL 2.1, XML or JSON, as used by MyInvois). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the MyInvois API. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Phased mandatory rollout by business size, reaching all businesses from mid-2025.
- Clearance model: MyInvois validates and assigns the Unique Identifier Number before an invoice is
  legal.
- Consolidated monthly e-Invoices are permitted for most business-to-consumer transactions.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Malaysia.

- `country-policy/data/my.json` — which document actions Malaysia allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/my.json` — which national identifier a party must carry.
- `tax/tax-systems/data/my.json` and `vat-rates/data/my.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/my.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/my.json` — the channel and format a Malaysian public buyer requires.
- `transports/channel-policy/data/my.json` — whether a channel is legally required of a seller
  established in Malaysia, and from what date.
- `archive/retention/data/my.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the MyInvois platform is a transmission channel this
repository does not implement, and its schema has no format provider. Both are code, not a JSON file
— see [When a country needs more than a file](../adding-a-country.md).

## Want Malaysia supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Malaysia, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Malaysia".
