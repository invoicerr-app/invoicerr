---
title: "France e-invoicing in Invoicerr"
description: "Invoicerr ships France country data — policy, identifiers, tax, corrections, B2G routing and channel policy. Which mechanisms are covered, read from the application's own files."
sidebar_label: "France (supported)"
keywords: [France e-invoicing, Factur-X, Chorus Pro, PDP]
---

# France e-invoicing in Invoicerr

:::tip[Invoicerr supports France]
France is one of five countries with data files in the per-country catalogues, so the application
runs for a company established there. Support is per mechanism, not a single yes or no.
:::

France's entries name Chorus Pro and Factur-X for public buyers, and a PDP channel for sellers
established there. A French seller's foreign-currency invoice also states its VAT in euros, at the
ECB's rate, frozen at issue; and its late-payment mention falls back to the statutory rule's own
wording once the twice-yearly rate table runs out, rather than blocking the send.

## Payment term cap

France's `paymentTerms` section (`countries/data/fr.json`) holds the longest payment term two
businesses may agree on, from Code de commerce art. L. 441-10, I: 60 days net after the invoice's
issue date (`maxNetDays`), or 45 days end of month (`maxEndOfMonthDays`), the latter only when the
contract states it expressly. The [payment terms setting](../../user-guide/settings/payment-terms.md)
reads these two numbers to warn, without blocking, when a company's default term goes beyond them.
Periodic invoices have a shorter cap (45 days net, CGI art. 289, I, 3) that this section does not
model.

## Fallback payment term

The `paymentTerms.fallbackTerm` entry of `countries/data/fr.json` is the 30 days an invoice's due
date falls back to when the company has no default term of its own (see [Payment
terms](../../user-guide/settings/payment-terms.md)). Code de commerce art. L. 441-10, I, first
paragraph caps the payment period, when the terms of sale and the parties set nothing else, at 30
days after receipt of the goods or performance of the service (`basis: "maximumWhenNotAgreed"`). The
application counts the 30 days from the invoice date, not from receipt of the goods or performance
of the service.

## Private clients and the SIREN

The SIREN / SIRET scheme (`LEGAL_ID` in the `identifiers` section of `countries/data/fr.json`) is
required of a company and optional for an individual (`requiredFor: ["COMPANY"]`). Code de commerce
art. R.123-237 binds a registered person, and art. R.123-220 lists a natural person in the SIRENE
register only when it trades, employs staff or is otherwise named there: a private person has no
number to give. On the invoice, CGI annexe II art. 242 nonies A, I, 1° asks for the client's number,
which `invoiceRequirements` requires of a domestic business client only. A private client can
therefore be saved, and invoiced, without a SIREN. A sole trader entered as an individual may still
enter one, and it is printed.

## Private clients and the PDP mandate

CGI art. 289 bis, I binds emission through an accredited platform only « lorsque l'émetteur de la
facture et son destinataire sont des assujettis ». A private person is not an assujetti, so an
invoice to a client of type Individual is outside the PDP mandate. The `pdp` fact in the
`channelPolicy` section of `countries/data/fr.json` says so with `scope.buyerType: ["COMPANY"]`,
next to `scope.parties: "domestic"`. Such an invoice is validated and sent like an invoice from a
country with no mandate: no PDP is needed, and Validate only numbers and locks it.

Ordonnance n° 2026-671 renumbers these provisions in the CIBS book II, with effect from 2027-01-01: the successor of
CGI art. 289 bis is L. 215-39 together with the first paragraph of L. 216-36 (formerly L. 216-44),
and the successor of art. 290 is L. 215-39 with the second paragraph of L. 216-48 (formerly
L. 216-56) and the last paragraph of L. 216-47 (formerly L. 216-55). The CGI articles themselves
stay in force until 2026-12-31, so the citations above remain the ones in force today.

## E-reporting (CGI art. 290 and 290 A)

E-reporting is the seller's own declaration of data to the tax administration, separate from
e-invoicing: it is transmitted through the accredited platform the company chose (CGI art. 290, I
and III, « transmises [...] par la plateforme agréée choisie par la personne assujettie »).
`countries/data/fr.json` carries two `reporting` facts with `providerId: "fr-pa"`, the legal channel,
never an operator name:

- **Operation data** (CGI art. 290): domestic B2C sales (`scope.transactions: "b2c"`,
  `buyerType: ["INDIVIDUAL"]`, `buyerEstablishment: "domestic"`). The international B2B flows the
  article also lists (10.1 and 10.2) are a follow-up slice and stay out of this fact, so they are
  never pushed through the B2C transaction route. Operations exempt under CGI art. 261 to 261 E,
  including a seller under the franchise en base, are outside the fact.
- **Payment data** (CGI art. 290 A): `transactions: "payments"`, `vatOnCollection: true`. Only a
  domestic B2C service invoice whose VAT is due on collection is declared. The option for VAT on
  debits, or a goods-only invoice, is out of scope. The amount actually received is split by VAT rate
  from the invoice's own lines, never recomputed from the invoice total.

The start date is data too. `applicability` holds one window per company profile answer: a LARGE or
MID company and any member of an assujetti unique start on 2026-09-01; an SME or micro-enterprise
that declared `NOT_MEMBER` starts on 2027-09-01 (loi n° 2022-1157 art. 26, III, B, applied to art. 290
and 290 A by LOI n° 2026-103 art. 123, V, B). A company with no size category, or an SME whose
VAT-group membership is undeclared, is journaled `report:blocked` with that reason, never bound on a
guess. The classifier judges the window against the invoice's own issue date, never the server clock
(`reporting/classify.ts`).

The frequency is the platform's own: three transmissions per month for the réel normal mensuel
regime, one per month for the réel normal trimestriel and réel simplifié regimes, and one per two
calendar months under the franchise en base (CGI ann. II art. 242 nonies O and P, created by décret
n° 2026-677 du 27 juillet 2026). The company settings therefore ask the VAT regime and the option for
VAT on debits. A change to either answer is pushed to the platform when the settings are saved, and
`reporting/providers/superpdp-ereporting-adapter.ts` syncs both again before every declaration.

Happy path: a French company issues an invoice to a private client, the invoice is sent, and the
`fr-pa` provider resolves its connected accredited platform from `operators/`
(`capabilities.eReporting`) and calls that adapter. SuperPDP is the first adapter. The record id the
platform returns is journaled on the Declarations screen and labelled as the platform's own record,
not a tax-administration reference: the platform aggregates and transmits later. Recording a payment
on a service invoice taxed on collection enqueues its own payment declaration.

"Never silent": no connected channel, no adapter for the connected operator, no usable credential,
or an operation the classifier cannot establish all end in `report:blocked` with a readable reason.
Nothing is declared on a guess, and a missing declaration never disappears from the timeline.

A client recorded as a company is treated as an assujetti. An association or a public body outside
the scope of VAT may not be one; the data cannot tell them apart today.

## Seller size and the PDP mandate

The obligation to issue through an accredited platform does not start on the same day for every
seller. Loi n° 2022-1157 art. 26, III, A (version in force since 2026-02-21) applies it to invoices
issued from 2026-09-01, « Toutefois, pour les factures émises par les assujettis relevant des
catégories des microentreprises et des petites et moyennes entreprises qui ne sont pas membres d'un
assujetti unique [...], les 2° et 4° du I et le II du présent article s'appliquent à compter du 1er
septembre 2027 ». The categories are those of LME art. 51, assessed on 2025-01-01.

`countries/data/fr.json` carries this as data in two places:

- the `companyProfile` section declares two attributes. `sizeCategory` takes `LARGE`, `MID`, `SME`
  and `MICRO`. `vatGroupMember` takes `MEMBER` and `NOT_MEMBER` and records membership of an
  assujetti unique (CGI art. 256 C). A company declares both in the company settings
  (`Company.reportingProfile`, see [Company settings](../../user-guide/settings/company-branding.md#company-profile));
- the `channelPolicy` section holds three `pdp` facts. Two start on 2026-09-01: one with
  `scope.seller: { "sizeCategory": ["LARGE", "MID"] }`, one with
  `scope.seller: { "vatGroupMember": ["MEMBER"] }` at any size. The third starts on 2027-09-01 with
  `scope.seller: { "sizeCategory": ["SME", "MICRO"], "vatGroupMember": ["NOT_MEMBER"] }`. All three
  keep `parties: "domestic"` and `buyerType: ["COMPANY"]`.

A company that has not declared its size category is in scope of the LARGE/MID fact, so it is bound
from 2026-09-01. A company that has not answered the VAT-group question is in scope of the MEMBER
fact as well, because an undeclared attribute matches every seller condition, so it is bound from
2026-09-01 too: issuing outside an accredited platform when bound costs a fine per invoice (CGI art.
1737) and an issued invoice cannot be taken back, whereas the refusal is visible and lifted by one
choice in the settings. Only a seller that declared both `SME` or `MICRO` and `NOT_MEMBER` reads the
2027-09-01 fact.

The channels settings screen reads the same facts for the company's own answers: a PME that declared
it is not a member sees the PDP mandated from 2027-09-01, not yet in force, while a member or an
unanswered PME sees 2026-09-01.

:::info[What the data cannot express]
Membership of an assujetti unique is self-declared and is not checked against the tax
administration's register: an unanswered question stays bound from 2026-09-01, but a wrong answer is
not detected. Each paragraph also lets a decree set a later date (at the latest 2026-12-01 and
2027-12-01); none was found. Reception is not modelled and is required of every company from
2026-09-01.
:::

## Validate and the PDP mandate

Invoicerr's **Validate** action normally only assigns an invoice's legal number and locks it, with
no email or transmission of any kind (see the [user guide](../../user-guide/billing/invoices.md)).
For a domestic French invoice to a business client, that is not enough: CGI art. 289 bis I requires emission,
transmission and reception to go through an accredited platform, so a numbered-and-locked invoice
that never went through one is not yet lawfully issued. The owner's decision (2026-10-01, issue
#581, revised after the pull request's own review) is that validating one of these invoices performs
the real PDP transmission as part of validating, rather than leaving the invoice in a
numbered-but-not-yet-issued limbo someone has to remember to complete.

This is now an EXPLICIT per-country fact, not an inferred side-effect of reusing the mandate check:
France's own `policy` section (`countries/data/fr.json`) declares its own `invoiceValidation` field, carrying CGI art. 289 bis
I's own text as `provenance`, validated at both load and seed time like every other fact here (see
[Adding a country](../adding-a-country.md#maintainer-note-invoicevalidation-whether-validate-also-transmits)
for the full mechanism). "Validate" only performs the real send when BOTH this fact is declared for
the invoice's own seller country AND the operation is bound by an active channel mandate right now
(the same country-blind `transports/channel-policy/` check `send` itself already consults, scoped to
a domestic operation) - never a hand-written "country is France" branch. Concretely, when it fires,
the same preflight and delivery `invoice.descriptor.ts`'s "send" uses run unchanged, so the PDP
mandate is never bypassed by choosing Validate instead of Send.

Because the fact is now explicit, the confirmation dialog knows about it BEFORE anyone confirms:
validating a domestic French B2B invoice shows a dedicated alert naming the accredited platform
(PDP) and stating the action cannot be undone, a separate block from the generic "numbering and
locking are final" warning every other locking action already shows. Today the only other country
with the same fact declared is Italy (SdI) - see
[Italy](./italy.md#validate-and-the-sdi-mandate), now reviewed and declared the same deliberate way,
no longer merely an unreviewed consequence of the mandate check.

This page is a pointer by design. Everything Invoicerr knows about France lives in its own data
files, and two pages already say it without anyone retyping it:

- [France in the country compliance matrix](../country-support/fr.md) — every mechanism, and the
  catalogue each answer comes from, regenerated from those files on every docs build.
- [Compliance — France](/compliance/fr) — the same coverage, written for someone deciding whether
  to use Invoicerr in France.

To widen that coverage, or to add a country of your own, see [Adding a
country](../adding-a-country.md): the catalogue files listed on every other page in this directory
are the ones France already has.

## Company-law mentions

The `companyLaw` section of `countries/data/fr.json` prints, under the seller's name on invoices,
quotes, credit notes and purchase orders:

| Legal forms | Printed | Source |
| --- | --- | --- |
| SAS, SARL, SA, SCA, SE | "SAS au capital de 1000.00 EUR" | Code de commerce art. R. 123-238, 3° and 4° |
| SNC, SCS | the legal form alone | R. 123-238, 1° and 2° |
| EI | "EI" | R. 526-27 and R. 123-237, 9° |
| every company above | "RCS Lyon" | R. 123-237, 2° |
| EI, other forms | "RCS Lyon", only when the city is filled in | R. 123-237, 2° binds a person registered at the RCS |

An SASU and an EURL are the SAS and SARL forms with one partner, and print as such. The SIREN of
R. 123-237, 1° is the `LEGAL_ID` identifier, already printed with the identifiers; the registered
office of 3° is the company address. Not modelled: liquidation (4°), foreign companies (5°),
locataire-gérant (6°), contrat d'appui (7°), EIRL (8°), and the SA "à directoire et conseil de
surveillance" wording. All texts were read at codes.droit.org, edition of 2026-10-01.
