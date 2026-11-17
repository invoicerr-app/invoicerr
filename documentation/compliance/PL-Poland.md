---
region: Europe
status: phased
priority: high
formats:
  - FA(3)
scope:
  - B2B
  - B2G
progress: in-progress
---
# 🇵🇱 Poland

**Authority:** Ministry of Finance (KAS) · **Channel:** KSeF (Krajowy System e-Faktur).

KSeF is Poland's national clearance system, and this app builds and validates the national **FA(3)**
XML format against the official schema and submits it through a dedicated KSeF client. What follows
is how confident this app's own data is about the mandate, and how the channel is proven to work.

## The KSeF mandate is sourced to the law, and kept suggested on purpose

This app's `channelPolicy` section records the `ksef` channel as `requirement: "suggested"`, with
provenance `legal`: art. 106ga ust. 1 of the VAT act (ustawa o podatku od towarów i usług, consolidated
text Dz.U. 2025 poz. 775), quoted verbatim in `pl.json` and checked on 2026-10-24, obliges taxpayers
to issue structured invoices through KSeF. The rollout dates were re-verified on 2026-09-28 against the
Ministry of Finance's own tax explanatory note of 28 January 2026: taxpayers above 200 000 000 zł of
2024 sales have been bound since **2026-02-01**, every other taxpayer since **2026-04-01**.

The fact stays `suggested` rather than `mandated` because the law still allows a plain invoice in
some cases. Art. 145m ust. 1 lets every obligated taxpayer issue invoices outside KSeF for up to
10 000 zł of sales a month until **2026-12-31**; making the channel mandatory today would refuse those
lawful invoices.

Art. 106ga ust. 2 also lists six exemptions. The one this app models is pkt 4, an invoice to a natural
person not carrying on a business: the fact carries `scope.buyerType: ["COMPANY"]`, so a private
client stays outside KSeF once the fact is ever made `mandated`. While it is `suggested`, the scope has
no effect.

## Proven live, every day

`transports/ksef/ksef.live.spec.ts` is a real round-trip against `ksef-test.mf.gov.pl`: it builds an
FA(3) file through the real XSD gate, authenticates, opens an online session and polls until the
invoice is `CLEARED` with a genuine `ksefNumber`. It runs in the scheduled `compliance-live.yml`
workflow on `dev`, with the `KSEF_AUTH_TOKEN` and `KSEF_NIP` CI secrets, and also covers a buyer from
another EU member state (`KodUE` and `NrVatUE`). This proves the channel against the test
environment, not against production KSeF.

## Selling to a government client (B2G)

The routing rule sends a Polish government client's invoice through **KSeF**, in FA(3), and requires
the client's **NIP** on file, sourced (`legal`) to the European Commission's eInvoicing country
factsheet for Poland and the KSeF portal's own page for local government units (both read
2026-09-02). This is the same KSeF channel and format as ordinary B2B.

## Tax

VAT, standard rate **23%**, sourced (`legal`) to the VAT act itself, read on 2026-09-13 in the
consolidated text Dz.U. 2025 poz. 775. Art. 41 ust. 1 sets a base rate of 22%; art. 146ef ust. 1 pkt 1
raises it to 23% for as long as an annual test on defence spending as a share of GDP is met, which it
has been since 2024-01-01. `pl.json` quotes both provisions together for that reason.

The `vatRates` section of the same file lists the whole ladder, each rate quoted from the same text:

| Rate | Category | Source |
| --- | --- | --- |
| 23% | standard | art. 41 ust. 1 as raised by art. 146ef ust. 1 pkt 1 |
| 8% | reduced (annex 3) | art. 41 ust. 2 as raised by art. 146ef ust. 1 pkt 2 |
| 5% | super-reduced (annex 10) | art. 41 ust. 2a |
| 0% | zero (intra-Community supply, export) | art. 41 ust. 3 and 4 |
| exempt | small-business exemption | art. 113 ust. 1 |

Cross-border tax (OSS) reads only the standard rate.

## VAT in złoty, on a foreign-currency invoice

Ustawa o VAT art. 31a ust. 1 and art. 106e ust. 11 require the VAT amount to also be stated in PLN on
an invoice issued in another currency. This app resolves the conversion at the moment the invoice is
numbered, using the **NBP's own Table A**, never the ECB, for the last business day **strictly
before** the invoice's own date, per the statute's own "poprzedzający" (preceding). Both the rate and
the converted amount are then frozen onto the invoice; the PDF and the detail page print both. If no
NBP rate exists yet for the currency being invoiced, sending is refused by name rather than falling
back to any other source.

## Identifiers

`countries/data/pl.json` declares one scheme: **LEGAL_ID** (the NIP), sourced `legal` to art. 106e
ust. 1 pkt 4 and 5 of the VAT act, for a company only, with `required: true`. A Polish company's own
NIP must be filled in to save Settings or finish onboarding, and a Polish company client's NIP to save
the client. A private person has no NIP to give and is not offered the field; an individual seller
may legally use a PESEL instead, a scheme this catalog does not model.

## Correcting or cancelling an invoice

Poland is the most restrictive of the five countries on how a mistake gets fixed: a **credit note**,
a **debit note** and an **internal credit note** are all legally **forbidden** as ways to fix an
issued invoice; a **corrective invoice** and **cancel-and-replace** are, by contrast, legally
**required** for the situations they cover; an authority-side annulment is forbidden; resubmitting
under the same identity is allowed. All of this is sourced (`legal`); the remaining four routes are
unverified.

Even though the law requires `CANCEL_AND_REPLACE`, cancelling an invoice **locally, in this app, is
not implementable for Poland today**: that legal route is realized in practice through a corrective
invoice, a different mechanism this app has not wired as a status flip on the original record. A
cancellation attempt is refused, by name, rather than silently allowed or silently downgraded.

## VAT returns and the recapitulative statement

This app files neither the JPK_VAT nor the VAT-UE statement for a Polish company: `pl.json` has no
`reporting` section. See [Declarations](/docs/developer-guide/countries/poland#declarations) on the
country page for what Polish law asks and what the app keeps ready.

## Sources

`backend/src/modules/documents/countries/data/pl.json` (one file, all of this country's own
sections: action policy; correction routes; B2G routing; channel policy; the tax system;
identifiers; the VAT rate ladder; VAT-currency conversion, VAT stated in PLN, sourced to the NBP's
own Table A; the VAT-UE part code list; and archive retention, five years, counted not from the
invoice date but from the end of the calendar year the tax fell due in, ustawa o VAT art. 112
pointing at Ordynacja podatkowa art. 70 § 1), plus `correction-routes/cancel-policy.ts` and
`transports/ksef/ksef.live.spec.ts` for the live proof above.
