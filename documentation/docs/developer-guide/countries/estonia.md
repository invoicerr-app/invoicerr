---
title: "Estonia e-invoicing"
description: "Estonia's e-Arveldus platform and private e-invoice provider network, and what adding Estonia would involve. Invoicerr does not support Estonia today."
sidebar_label: "Estonia"
keywords: [Estonia e-invoicing, e-Arveldus, X-Road, Estonia invoice XML, Peppol Estonia]
---

# Estonia e-invoicing

:::warning[Invoicerr does not support Estonia]
No Estonia data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Estonia support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Estonia has required B2G e-invoicing since 2019, delivered through **e-Arveldus** and the **X-Road**
secure data-exchange layer, under the **Tax and Customs Board** (Maksu- ja Tolliamet). For B2B,
Estonia has no single central platform — invoices move through a network of private e-invoice
providers with roaming agreements between them, some of which also connect to Peppol. From July
2025, a buyer can require its supplier to issue an e-invoice.

## What supporting Estonia would involve

| | |
|---|---|
| **System** | e-Arveldus — Estonia's B2G e-invoicing platform, alongside a decentralized network of private e-invoice providers for B2B |
| **Authority** | Tax and Customs Board (Maksu- ja Tolliamet) |
| **Format** | EN 16931 (Peppol BIS). This repository already builds and validates it (`formats/peppol-bis-provider.ts`, `formats/ubl-provider.ts`), so the format would not have to be written from scratch. |
| **Transmission** | e-Arveldus and the X-Road layer for B2G, and a network of private e-invoice providers for B2B. No transport in `backend/src/modules/documents/transports/` talks to either today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- B2G e-invoicing has been mandatory since 2019.
- From July 2025, a buyer can require its supplier to issue an e-invoice; a full B2B mandate is
  expected from 2027.
- The B2B market is decentralized — private providers interconnect through roaming agreements
  rather than one central platform.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Estonia.

- `country-policy/data/ee.json` — which document actions Estonia allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/ee.json` — which national identifier a party must carry.
- `tax/tax-systems/data/ee.json` and `vat-rates/data/ee.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/ee.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/ee.json` — the channel and format an Estonian public buyer requires.
- `transports/channel-policy/data/ee.json` — whether a channel is legally required of a seller
  established in Estonia, and from what date.
- `archive/retention/data/ee.json` — how long an archived document is kept, and what the duration
  is counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: e-Arveldus is a transmission channel this repository does
not implement, which is code, not a JSON file — see [When a country needs more than a
file](../adding-a-country.md).

## Want Estonia supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Estonia, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Estonia".
