---
title: "Bosnia and Herzegovina e-invoicing"
description: "Bosnia and Herzegovina's e-fiscalization system is still under development. Invoicerr does not support Bosnia and Herzegovina today."
sidebar_label: "Bosnia and Herzegovina"
keywords: [Bosnia and Herzegovina e-invoicing, e-fiscalization Bosnia, ITA Bosnia, Bosnia invoice XML]
---

# Bosnia and Herzegovina e-invoicing

:::warning[Invoicerr does not support Bosnia and Herzegovina]
No Bosnia and Herzegovina data file exists anywhere in this repository — no country policy, no
identifiers, no tax system, no transmission channel. **Nothing on this page is implemented.** It is
here so that someone who wants Bosnia and Herzegovina support knows what adding it would involve.
The countries Invoicerr does cover are listed in the [country directory](./index.md).
:::

Bosnia and Herzegovina is developing an e-fiscalization system under the **ITA** (Indirect Taxation
Authority), aimed at modernizing tax administration. No platform, timeline, or invoice format has
been finalized yet — what follows is what the country has signalled it intends to build, not
something that exists today.

## What supporting Bosnia and Herzegovina would involve

| | |
|---|---|
| **System** | Not established here. |
| **Authority** | Indirect Taxation Authority (ITA) |
| **Format** | Not established here. |
| **Transmission** | Not established here. |

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each section has to satisfy; this is only the shopping list of sections Bosnia and Herzegovina would need in
`countries/data/ba.json`.

- `policy` - which document actions Bosnia and Herzegovina allows. Start here: without this
  section every action is refused with a 403, naming the country.
- `identifiers` - which national identifier a party must carry.
- `taxSystem` and `vatRates` - the tax kind, and the rate ladder
  offered on an invoice line.
- `correctionRoutes` - all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2gRouting` - the channel and format a Bosnian public buyer requires.
- `channelPolicy` - whether a channel is legally required of a seller
  established in Bosnia and Herzegovina, and from what date.
- `retention` - how long an archived document is kept, and what the duration is
  counted from.

Add `mentions`, `contentRequirements`, `countryFields`, `reporting` and
`domesticReverseCharge` sections only where the law actually gives them content.

Beyond those files, the work here is mostly research: this page names no national platform a
transport would have to be built for.

## Want Bosnia and Herzegovina supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Bosnia and Herzegovina, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Bosnia and
Herzegovina".
