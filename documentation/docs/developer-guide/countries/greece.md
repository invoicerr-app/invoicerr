---
title: "myDATA — Greece e-invoicing"
description: "Greece's myDATA reporting and clearance system, run by AADE, and what adding Greece would involve. Invoicerr does not support Greece today."
sidebar_label: "Greece"
keywords: [myDATA, Greece e-invoicing, AADE, MARK Greece, Greece invoice XML]
---

# myDATA — Greece e-invoicing

:::warning[Invoicerr does not support Greece]
No Greece data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Greece support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Greece reports invoice data through **myDATA** (My Digital Accounting and Tax Application), run by
**AADE** (Independent Authority for Public Revenue). Every invoice is currently reported to myDATA
after issuance; from 2026 myDATA is expected to become a clearance step, returning a **MARK**
registration number before the invoice is valid.

## What supporting Greece would involve

| | |
|---|---|
| **System** | myDATA — AADE's Digital Accounting and Tax Application |
| **Authority** | AADE (Independent Authority for Public Revenue) |
| **Format** | A national XML schema submitted to myDATA. No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the myDATA API (AADE). No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Today's model is post-issuance reporting: every company reports invoice summaries to myDATA
  after the invoice is issued.
- Mandatory e-invoicing (a clearance step, returning a MARK before the invoice is valid) is due to
  phase in through 2026, starting with large enterprises.
- Invoices can be submitted either directly to AADE's API or through a certified provider that
  also offers Peppol connectivity for B2G.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Greece.

- `country-policy/data/gr.json` — which document actions Greece allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/gr.json` — which national identifier a party must carry.
- `tax/tax-systems/data/gr.json` and `vat-rates/data/gr.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/gr.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/gr.json` — the channel and format a Greek public buyer requires.
- `transports/channel-policy/data/gr.json` — whether a channel is legally required of a seller
  established in Greece, and from what date.
- `archive/retention/data/gr.json` — how long an archived document is kept, and what the duration
  is counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the myDATA platform is a transmission channel this
repository does not implement, and its XML schema has no format provider. Both are code, not a JSON
file — see [When a country needs more than a file](../adding-a-country.md).

## Want Greece supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Greece, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Greece".
