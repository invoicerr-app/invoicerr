---
title: "TEIF — Tunisia e-invoicing"
description: "Tunisia's TEIF e-invoicing format, run by the DGI, and what adding Tunisia to Invoicerr would involve. Invoicerr does not support Tunisia today."
sidebar_label: "Tunisia"
keywords: [TEIF, DGI, Tunisia e-invoicing, Tunisia invoice XML]
---

# TEIF — Tunisia e-invoicing

:::warning[Invoicerr does not support Tunisia]
No Tunisia data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Tunisia support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Tunisia's e-invoicing uses **TEIF**, administered by the **DGI**, the Direction Générale des Impôts,
through its e-Invoice System.

## What supporting Tunisia would involve

| | |
|---|---|
| **System** | DGI e-Invoice System (TEIF) |
| **Authority** | DGI — Direction Générale des Impôts |
| **Format** | A national format (TEIF). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the DGI e-Invoice System. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Described as a clearance model requiring tax-authority authorization before an invoice is valid.
- Digital signature named as a requirement.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each section has to satisfy; this is only the shopping list of sections Tunisia would need in
`countries/data/tn.json`.

- `policy` - which document actions Tunisia allows. Start here: without this
  section every action is refused with a 403, naming the country.
- `identifiers` - which national identifier a party must carry.
- `taxSystem` and `vatRates` - the tax kind, and the rate ladder
  offered on an invoice line.
- `correctionRoutes` - all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2gRouting` - the channel and format a Tunisian public buyer requires.
- `channelPolicy` - whether a channel is legally required of a seller
  established in Tunisia, and from what date.
- `retention` - how long an archived document is kept, and what the duration is
  counted from.

Add `mentions`, `contentRequirements`, `countryFields`, `reporting` and
`domesticReverseCharge` sections only where the law actually gives them content.

Data alone will not finish the job here: the DGI e-Invoice System is a transmission channel this
repository does not implement, and the TEIF format has no format provider. Both are code, not a JSON
file — see [When a country needs more than a file](../adding-a-country.md).

## Want Tunisia supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Tunisia, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Tunisia".
