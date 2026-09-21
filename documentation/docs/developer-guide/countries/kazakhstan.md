---
title: "ESF — Kazakhstan e-invoicing"
description: "Kazakhstan's electronic invoice (ESF) system, and what adding Kazakhstan to Invoicerr would involve. Invoicerr does not support Kazakhstan today."
sidebar_label: "Kazakhstan"
keywords: [ESF, Kazakhstan e-invoicing, KKM, BIN, Kazakhstan invoice XML]
---

# ESF — Kazakhstan e-invoicing

:::warning[Invoicerr does not support Kazakhstan]
No Kazakhstan data file exists anywhere in this repository — no country policy, no identifiers, no
tax system, no transmission channel. **Nothing on this page is implemented.** It is here so that
someone who wants Kazakhstan support knows what adding it would involve. The countries Invoicerr
does cover are listed in the [country directory](./index.md).
:::

Kazakhstan requires businesses to issue electronic invoices, known locally as **ESF**, authorised
through the treasury committee's own electronic system before reaching the buyer. Every invoice is
tied to the issuer's Business Identification Number (BIN) and carries a digital signature.

## What supporting Kazakhstan would involve

| | |
|---|---|
| **System** | ESF, issued through the treasury committee's electronic invoice system |
| **Authority** | KKM — Committee for Treasury |
| **Format** | A national schema (ESF). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the treasury committee's electronic system. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Clearance model: the treasury committee validates and authorises each invoice before delivery.
- Standard VAT rate is 12 percent.
- Archive retention is 5 years.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Kazakhstan.

- `country-policy/data/kz.json` — which document actions Kazakhstan allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/kz.json` — which national identifier a party must carry.
- `tax/tax-systems/data/kz.json` and `vat-rates/data/kz.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/kz.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/kz.json` — the channel and format a Kazakh public buyer requires.
- `transports/channel-policy/data/kz.json` — whether a channel is legally required of a seller
  established in Kazakhstan, and from what date.
- `archive/retention/data/kz.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the treasury committee's electronic system is a
transmission channel this repository does not implement, and its XML schema has no format provider.
Both are code, not a JSON file — see [When a country needs more than a
file](../adding-a-country.md).

## Want Kazakhstan supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Kazakhstan, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Kazakhstan".
