---
title: "Austria e-invoicing"
description: "Austria's e-Rechnung.gv.at hub for B2G e-invoicing, and what adding Austria to Invoicerr would involve. Invoicerr does not support Austria today."
sidebar_label: "Austria"
keywords: [Austria e-invoicing, e-Rechnung.gv.at, ebInterface, Peppol Austria, USP portal]
---

# Austria e-invoicing

:::warning[Invoicerr does not support Austria]
No Austria data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Austria support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Austria has run mandatory B2G e-invoicing since 2014 through **e-Rechnung.gv.at**, the federal hub
operated by the **BMF** (Federal Ministry of Finance) and **BRZ** (Federal Computing Center).
Invoices reach the hub either through the **USP** (Business Service Portal) or a Peppol Access
Point, built either as **Peppol BIS** UBL or Austria's own **ebInterface** XML format. B2B invoicing
remains voluntary, outside this mandate.

## What supporting Austria would involve

| | |
|---|---|
| **System** | e-Rechnung.gv.at — Austria's federal B2G e-invoicing hub |
| **Authority** | BMF (Federal Ministry of Finance), operated by BRZ (Federal Computing Center) |
| **Format** | EN 16931 (Peppol BIS). This repository already builds and validates it (`formats/peppol-bis-provider.ts`, `formats/ubl-provider.ts`), so the format would not have to be written from scratch. |
| **Transmission** | The federal e-Rechnung.gv.at hub, reachable via the USP portal or a Peppol Access Point. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- B2G e-invoicing has been mandatory at federal level since 2014, and for state (Länder) government
  buyers since April 2020.
- ebInterface, Austria's own XML format, is flatter than Peppol BIS/UBL and mostly used by local
  SMEs through the USP portal.
- B2B e-invoicing is voluntary, following ordinary post-audit rules.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Austria.

- `country-policy/data/at.json` — which document actions Austria allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/at.json` — which national identifier a party must carry.
- `tax/tax-systems/data/at.json` and `vat-rates/data/at.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/at.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/at.json` — the channel and format an Austrian public buyer requires.
- `transports/channel-policy/data/at.json` — whether a channel is legally required of a seller
  established in Austria, and from what date.
- `archive/retention/data/at.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the e-Rechnung.gv.at hub is a transmission channel this
repository does not implement, which is code, not a JSON file — see [When a country needs more than
a file](../adding-a-country.md).

## Want Austria supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Austria, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Austria".
