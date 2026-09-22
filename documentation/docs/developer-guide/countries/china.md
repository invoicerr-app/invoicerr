---
title: "e-Fapiao — China e-invoicing"
description: "China's fully digitalized e-Fapiao clearance system, and what adding China to Invoicerr would involve. Invoicerr does not support China today."
sidebar_label: "China"
keywords: [e-Fapiao, China e-invoicing, Golden Tax System, Leqi Platform, China invoice XML]
---

# e-Fapiao — China e-invoicing

:::warning[Invoicerr does not support China]
No China data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants China support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

China's e-invoicing runs on the fully digitalized **e-Fapiao**, issued and cleared through the State
Taxation Administration's **Leqi Platform** under the Golden Tax System. The invoice is a
structured, digitally signed file rather than a printed document carrying a physical seal.

## What supporting China would involve

| | |
|---|---|
| **System** | e-Fapiao, cleared through the STA's Leqi Platform (Golden Tax System) |
| **Authority** | STA — State Taxation Administration |
| **Format** | A national schema (e-Fapiao), signed with China's own SM-series cryptography rather than RSA/SHA. No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the Leqi Platform. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Clearance model: the Leqi Platform validates, numbers and signs each invoice before delivery.
- National rollout of fully digitalized e-Fapiao is targeted for January 2026, after a regional
  pilot.
- A visual counterpart, OFD, is issued alongside the XML for human reading.
- Archive retention is 30 years.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for China.

- `country-policy/data/cn.json` — which document actions China allows. Start here: without this file
  every action is refused with a 403, naming the country.
- `country-identifiers/data/cn.json` — which national identifier a party must carry.
- `tax/tax-systems/data/cn.json` and `vat-rates/data/cn.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/cn.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/cn.json` — the channel and format a Chinese public buyer requires.
- `transports/channel-policy/data/cn.json` — whether a channel is legally required of a seller
  established in China, and from what date.
- `archive/retention/data/cn.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the Leqi Platform is a transmission channel this repository
does not implement, and its XML schema has no format provider. Both are code, not a JSON file — see
[When a country needs more than a file](../adding-a-country.md).

## Want China supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for China, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add China".
