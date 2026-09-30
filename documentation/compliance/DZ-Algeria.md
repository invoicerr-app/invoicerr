---
region: Africa
status: voluntary
priority: medium
formats: []
scope:
  - B2B
  - B2C
progress: in-progress
---
# 🇩🇿 Algeria

**Authority:** DGI (Direction Générale des Impôts).

Algeria has no e-invoicing channel or format in this app, and, unlike the claim this repository's
own documentation used to carry, no primary source found by issue #558's research pass confirms one
is legally required at all. Read this page before invoicing in Algeria.

## No e-invoicing mandate found, in force or announced

Seven finance laws (2022-2026), three consolidated 2026 tax codes (CPF, CIDTA, CTCA), the DGI's own
official communiqué on the 2026 finance law, and the DGI's own internal search engine were all
checked for "facturation électronique", "e-facture", "clearance", "signature électronique" and "caisse
enregistreuse" tied to an obligation: none was found, in force or announced with a date. This
directly contradicts a "DGI e-Invoice System" claim this repository's own `documentation/docs/
developer-guide/countries/algeria.md` used to carry, itself inherited from an earlier, never-checked
research pass; that claim has been removed. `transports/channel-policy/data/dz.json` declares no
fact, the same "empty and documented" shape as Portugal's own file. Not a proof of absence:
mfdgi.gov.dz serves part of its own regulatory-text listing through client-side JavaScript this
research pass's tooling could not read.

The issue's native contributor, asked directly on 2026-09-30, confirmed: "There[']s nothing in
reality about e-invoicing for now. There is a digital platform to pay taxes called Jibayatic (SAP)
but none is forced to produce e-invoices (at least for now)."

## Numbering: an uninterrupted, chronological series

Décret exécutif n° 05-468 du 10 décembre 2005, art. 10, read in full: *"Le facturier est un carnet à
souches comprenant une série ininterrompue et chronologique de factures [...] Un facturier ne peut
être entamé sans que le précédent ne soit totalement épuisé."* No annual reset is permitted: the
continuity requirement runs the opposite way. The same article settles that an already-issued invoice
is never rewritten (only ever explicitly cancelled with a diagonal "facture annulée" mention on the
original) and that a dematerialized invoice is legally regular alongside a paper booklet.

## Tax

VAT, two general rates, both sourced to the Code des Taxes sur le Chiffre d'Affaires (CTCA) 2026 as
published by the DGI, read directly 2026-09-30:

| Rate | Category | Article |
| --- | --- | --- |
| 19% | Standard | art. 21 |
| 9% | Reduced | art. 23 |

An export rate (treated as zero-rated, "sous conditions formelles") is named by CTCA art. 13, but this
pass captured only a paraphrase, not a verbatim quote: kept `unverified` in `vat-rates/data/dz.json`
rather than invented as a sourced fact.

### The IFU regime: sourced as a fact, unmodeled as a mechanism

The IFU (Impôt Forfaitaire Unique) replaces VAT, personal income tax (IRG) and a local tax (TLS) with
one flat levy for a business under 8,000,000 DA annual turnover (CIDTA art. 282bis/282ter) and forbids
stating VAT on an invoice at all, on pain of the penalties at CTCA art. 114 (CTCA art. 64). The native
contributor described it as "the most used for freelancers and small businesses". This catalog's
`tax-systems` schema has no slot for a regime that *replaces* VAT with a different combined tax rather
than merely exempting it: `tax/tax-systems/data/dz.json` stays at the ordinary VAT regime
(`schemes: ["STANDARD"]`) and documents the gap in its own notes rather than forcing a misleading
`EXEMPT` label onto a mechanism that isn't one.

## Identifiers

- **RC (Registre du Commerce)** and **NIS (Numéro d'Identification Statistique)**, both required for
  the seller unconditionally and for the buyer only when the buyer is itself a business: décret
  05-468 art. 3, read in full: *"[...] numéro du registre du commerce ; numéro d'identification
  statistique. [...] Si l'acheteur est un consommateur, la facture doit mentionner ses nom,
  prénom(s) et adresse."*
- **NIF (Numéro d'Identification Fiscale)** and **AI (Article d'Imposition)**, both absent from
  decree 05-468's own full list of mandatory invoice mentions, but shown in practice per the native
  contributor's own answer on 2026-09-30: kept `unverified`, never promoted to a legal citation this
  pass does not hold.

## Domestic invoicing currency: DZD, enforced

Règlement de la Banque d'Algérie n° 07-01 du 3 février 2007, art. 5: *"Toute facturation ou vente de
biens et services sur le territoire douanier national s'effectue en dinars algériens sauf cas prévus
par la réglementation en vigueur."* Unlike every other fact on this page, this one is not merely
data: a new, cross-country `country-policy/schema.ts#domesticInvoiceCurrency` fact (issue #558) lets
this app preselect DZD when both the seller and the buyer are established in Algeria, and **refuses
to send** such an invoice in any other currency, naming the rule. Export invoicing in a foreign
currency is unaffected.

## Correcting or cancelling an invoice

None of the eleven correction routes this catalog tracks is sourced to Algerian law. Decree 05-468
defines exactly one mechanism: cancelling an invoice by writing "facture annulée" diagonally across
the original, kept in the booklet, and even that does not cleanly match `CANCEL_AND_REPLACE`'s own
definition (which presupposes reissuance under a new number, not described anywhere in the text). The
native contributor was unsure whether a credit note exists in practice at all ("I'm not sure but in
practice yes, there should be a credit note"). Every route stays honestly `unverified`; an attempt to
cancel an issued invoice locally is refused by name, exactly like Portugal's own `CANCEL_AND_REPLACE`
gap.

## Retention

Ten years from the document's own issue date: Code des Procédures Fiscales art. 64 (as amended by
the 2025 finance law): *"[...] doivent être conservés pendant le délai de dix (10) ans prévu par
l'article 12 du code du commerce, à compter [...] pour les pièces justificatives, de la date à
laquelle elles ont été établies."*, and Code de commerce art. 12: *"Les livres et documents [...]
doivent être conservés pendant dix ans."*

## Not modeled, on purpose

- **Invoice language.** No catalog in this app encodes a required invoicing language for any country.
  Loi n° 91-05 (the Arabic-language law) never names "facture"; the closest provision is a broad
  "financial management" clause. The native contributor described French, Arabic, Kabyle and even
  English invoices as all issued in practice, with no enforcement observed either way.
- **The "bon de transaction commerciale"** (décret 16-66, agriculture/fishing/crafts): the
  contributor said this can wait for a later pass.
- **Arabic / right-to-left layout**: tracked separately as issue #559.

## Sources

`backend/src/modules/documents/country-policy/data/dz.json` (action policy, numbering, and the new
`domesticInvoiceCurrency` fact), `country-identifiers/data/dz.json`, `correction-routes/data/dz.json`,
`tax/tax-systems/data/dz.json`, `vat-rates/data/dz.json`, `archive/retention/data/dz.json`, and
`transports/channel-policy/data/dz.json` (exists, declares no fact, for the sourced reason given
above). No `b2g-routing/data/dz.json` and no `reporting/data/dz.json` exist: nothing found by this
pass justifies either yet. See issue #558 and its own research file for the full citation list,
including what was checked and not found, and the native contributor's six practice answers
(2026-09-30).
