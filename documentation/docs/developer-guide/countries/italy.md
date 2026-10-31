---
title: "Italy e-invoicing in Invoicerr"
description: "Invoicerr ships Italy country data — policy, identifiers, tax, corrections, B2G routing and channel policy. Which mechanisms are covered, read from the application's own files."
sidebar_label: "Italy (supported)"
keywords: [Italy e-invoicing, FatturaPA, SdI]
---

# Italy e-invoicing in Invoicerr

:::tip[Invoicerr supports Italy]
Italy is one of five countries with data files in the per-country catalogues, so the application
runs for a company established there. Support is per mechanism, not a single yes or no.
:::

Italy's entries name SdI as its invoice transmission platform, and FatturaPA as the format it
carries. An Italian seller's foreign-currency invoice also states both its VAT and its taxable
amount in euros, at the ECB's rate, frozen at issue.

## Validate and the SdI mandate

Invoicerr's **Validate** action normally only assigns an invoice's legal number and locks it, with
no email or transmission of any kind (see the [user guide](../../user-guide/billing/invoices.md)).
Issue #581's first owner decision (2026-10-01) named France only - the only country whose own legal
question had been reviewed at that point - and flagged Italy as an unreviewed CONSEQUENCE: reusing
the existing, country-blind channel-mandate check `send` already runs
(`transports/channel-policy/`) meant a domestic Italian B2B invoice would also transmit through SdI
on Validate, without that being a deliberate legal finding about Italian law.

The owner's revised decision, after reviewing that flag, makes it deliberate: Italy now declares its
own `invoiceValidation` fact in its own `policy` section (`countries/data/it.json`), carrying D.Lgs. 127/2015 art. 1 comma
6's own text as `provenance` - without the accredited channel, "la fattura si intende non emessa"
("the invoice is deemed not issued"), the same constitutive-of-issuance reasoning CGI art. 289 bis I
gives France (see [France](./france.md#validate-and-the-pdp-mandate) for the parallel), stronger
here than DPR 633/1972 art. 21's own general electronic-invoice validity clause. Like France's own
fact, it is validated at both load and seed time, and consulted the same way: Validate performs the
real SdI send only when this fact is declared for the seller country AND the operation is bound by
an active channel mandate right now (`activeChannelMandateForOperation`) - never a hand-written
"country is Italy" branch. See [Adding a
country](../adding-a-country.md#maintainer-note-invoicevalidation-whether-validate-also-transmits)
for the full mechanism.

Because the fact is now explicit, the confirmation dialog knows about it BEFORE anyone confirms:
validating a domestic Italian B2B invoice shows a dedicated alert naming SdI and stating the action
cannot be undone, a separate block from the generic "numbering and locking are final" warning every
other locking action already shows.

The SdI mandate binds a private buyer too. D.Lgs. 127/2015 art. 1 comma 3 covers supplies « tra
soggetti residenti o stabiliti nel territorio dello Stato », not only between taxable persons, and
the same comma provides for e-invoices issued to final consumers. The `sdi` fact therefore carries
no `scope.buyerType`: an Italian invoice to a client of type Individual still goes through SdI, and
Validate still transmits it.

## Partita IVA and codice fiscale

DPR 633/1972 art. 21, comma 2 asks every invoice for the seller's Partita IVA (lettera d) and, for
the buyer (lettera f), its Partita IVA, the VAT number of its own member state when it is established
elsewhere in the Union, or its codice fiscale when it is resident in Italy and does not act as a
business. The `identifiers` section of `countries/data/it.json` encodes it with the party's type
standing in for "acts as a business", which the app does not record:

| Party | Must be filled in to save | Scheme |
| --- | --- | --- |
| Your company (Settings, onboarding) | Partita IVA | `VAT`, `required: true` |
| Company client | Partita IVA | `VAT`, `required: true` |
| Individual client | Codice fiscale | `LEGAL_ID`, `requiredFor: ["INDIVIDUAL"]` |

A company client may leave the codice fiscale empty, and an individual client is not offered a
Partita IVA field. A sole trader entered as an individual is therefore asked for a codice fiscale,
not a Partita IVA.

:::info[Clients saved before]
An Italian client saved without the number keeps its record. The client form asks for it at the next
edit, and Validate and Send keep refusing an invoice to it until it is filled in.
:::

This page is a pointer by design. Everything Invoicerr knows about Italy lives in its own data
files, and two pages already say it without anyone retyping it:

- [Italy in the country compliance matrix](../country-support/it.md) — every mechanism, and the
  catalogue each answer comes from, regenerated from those files on every docs build.
- [Compliance — Italy](/compliance/it) — the same coverage, written for someone deciding whether
  to use Invoicerr in Italy.

To widen that coverage, or to add a country of your own, see [Adding a
country](../adding-a-country.md): the catalogue files listed on every other page in this directory
are the ones Italy already has.

## FatturaPA codes

The FatturaPA builder (`formats/national/fatturapa-provider.ts`) reads three kinds of code from the
`einvoiceCodes` section of `countries/data/it.json`, each entry quoting its source:

| FatturaPA element | Section key | What selects the value |
| --- | --- | --- |
| `Natura` and `RiferimentoNormativo` of a 0 % line | `exemptionCodes` | The exemption reason the tax engine resolved for the line (a VATEX code), then the seller's tax scheme, then the VAT rate entry picked on the line (`appliesTo`). |
| `RegimeFiscale` | `taxRegimeCodes` | The seller's tax scheme: `RF19` (regime forfettario) when the company has the VAT exemption toggle on in Settings, `RF01` otherwise. |
| `CodiceDestinatario` without an SdI code | `recipientCodes` | `0000000` for a buyer reached by PEC or through no known channel, `XXXXXXX` for a buyer established abroad. |

What a line gets today:

| Situation | Natura |
| --- | --- |
| Seller under the forfettario | `N2.2` |
| Service to an EU business (reverse charge) or to a buyer outside the EU | `N2.1` |
| Goods to an EU business (intra-Community supply) | `N3.2` |
| Goods to a buyer outside the EU, or the `it-non-imponibile` rate | `N3.1` |
| The `it-esente` rate | `N4` |

The other detailed codes the schema accepts (`N1`, `N3.3` to `N3.6`, `N5`, `N6.1` to `N6.9`, `N7`) are
listed with their source but carry no `appliesTo`: nothing on an invoice can select them yet. The N6
codes in particular wait for the `domesticReverseCharge` categories to reach the tax engine.

:::info[A 0 % line with no code is refused]
A line without VAT that no entry matches (a bare legacy `0` rate, for instance) makes the build
invalid with a message naming the line. The SdI has refused the generic codes `N2`, `N3` and `N6` since
2021-01-01 (error 00445 of its technical specifications), so there is no safe default to fall back on.
:::

The schema the builder validates against, `formats/vendored/it/Schema_VFPR12.xsd`, is the official
version 1.2.3 downloaded from fatturapa.gov.it (`Schema_VFPR12_v1.2.3.xsd`, identical to
`Schema_VFPA12_V1.2.3.xsd`). The only change is its `xmldsig` import, pointed at the local copy of the
W3C schema next to it. The schema does not carry the SdI's own controls: a generic Natura code or an
`XXXXXXX` sent to an Italian buyer (error 00313) pass the XSD and are refused by the SdI. The specs in
`fatturapa-provider.spec.ts` check those two controls on every case they build.

:::info[Not proven against the SdI]
These codes follow the SdI technical specifications 1.9.1 and the Agenzia delle Entrate's guide to
filling in electronic invoices (version 1.10). No invoice built with them has been submitted to the
SdI yet, in test or production.
:::

## Fallback payment term

The `paymentTerms.fallbackTerm` entry of `countries/data/it.json` is the 30 days an invoice's due
date falls back to when the company has no default term of its own (see [Payment
terms](../../user-guide/settings/payment-terms.md)). D.Lgs. 231/2002, art. 4, comma 2, lettera a)
caps the payment period at 30 days from the debtor's receipt of the invoice, unless the parties
agree otherwise (`basis: "maximumWhenNotAgreed"`). The application counts the 30 days from the
invoice date, not from receipt of the invoice.

## Company-law mentions

The `companyLaw` section of `countries/data/it.json` prints, under the seller's name on invoices,
quotes, credit notes and purchase orders (atti e corrispondenza), from codice civile art. 2250:

| Legal forms | Printed | Paragraph |
| --- | --- | --- |
| S.r.l., S.p.A., S.a.p.a., S.n.c., S.a.s. | "Registro delle imprese di Milano n. 01234567890" | first |
| S.r.l., S.p.A., S.a.p.a. | "Capitale sociale versato 10000.00 EUR" | second |
| S.r.l. and S.p.A. con unico socio | "Società con unico socio" | fourth |
| Ditta individuale, other forms | nothing | art. 2250 binds società |

The sede is the company address. Text read at normattiva.it on 2026-10-25 (in force since
29-7-2009).

## FatturaPA `IscrizioneREA`

The FatturaPA export fills `CedentePrestatore/IscrizioneREA` from the same `companyLaw` section. The
block is emitted only when every element the format makes mandatory is declared; otherwise it is
omitted (`IscrizioneREAType` is `minOccurs="0"`) rather than guessing a province or asserting that a
company is not in liquidation.

| Element | Source |
| --- | --- |
| `Ufficio` | `registerOfficeProvince`: the two-letter province of the registro delle imprese office |
| `NumeroREA` | `registerNumber`: the registration number codice civile art. 2250 already asks for |
| `CapitaleSociale` | `shareCapital`, when its currency is EUR |
| `SocioUnico` | `SU` or `SM` from the legal form's `singleMember`; omitted for forms the field does not cover |
| `StatoLiquidazione` | `liquidationStatus`, declared as `LN` or `LS` |

`registerOfficeProvince` and `liquidationStatus` are marked `asked` in `it.json`, so the company
settings collect them even though no printed mention quotes them.

**The `NumeroREA` decision.** The issue left open whether `NumeroREA` could carry the registro delle
imprese registration number or needed a second field. The specification settles it: Specifiche
tecniche del formato della FatturaPA v1.4 §3.3.4 defines `NumeroREA` as « il numero di repertorio con
il quale la società è iscritta nel Registro delle Imprese », which is the registration number art. 2250
names, not a distinct REA number. No second field is declared.

Text read on 2026-10-31 at fatturapa.gov.it,
https://www.fatturapa.gov.it/export/documenti/fatturapa/v1.4/Specifiche_tecniche_del_formato_FatturaPA_V1.4.pdf
(§3.3.4, pages 42-43).
