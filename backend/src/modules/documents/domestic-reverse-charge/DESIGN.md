# Domestic reverse charge — design note

Written 2026-09-13, alongside the catalog in this directory. This is Step 1 of the task brief
(`brief-autoliquidation-domestique.md`): a design, written down, before any code. Step 2 —
`schema.ts`, `data/all.ts`, `registry.ts` and the four sourced `data/<cc>.json` files in this same
directory — is the *only* implementation this wave carries out. **Nothing in `tax/tax-engine.ts`,
`tax/resolve-invoice-tax.ts`, `country-fields/`, or the frontend has been touched.** Every section
below describes a *next* wave's work, not this one's.

## The gap, restated from the current code (not the brief's own snapshot of it)

Two independent reasons a domestic reverse-charge invoice cannot be issued today:

1. `tax/resolve-invoice-tax.ts`'s domestic branch (`sellerCC === buyerCC`) only ever reaches the tax
   engine for a seller under a non-`STANDARD` `taxScheme` (`FRANCHISE_BASE`/`EXEMPT` — the small-business
   exemption fix landed 2026-09-13, see that file's own header). A `STANDARD` seller's domestic invoice
   takes the original, unconditional fast path: the user's own typed `vatRate` is trusted verbatim, no
   matter what the line is actually for.
2. `tax/tax-engine.ts#domesticVat` has exactly two special branches keyed off `supplier.taxScheme`
   (`FRANCHISE_BASE`, `EXEMPT`). There is no branch that asks "is the BUYER liable instead of the
   seller because of what this line IS" — the fact this whole feature is missing. `LOCALIZED_MENTION`
   (added 2026-09-13, see `tax-engine.ts`'s own header) already carries a `reverseCharge` situation key,
   but every entry under it is reached only from the CROSS-BORDER branch of `determineLineTax` — never
   from `domesticVat`.

So today, a French seller invoicing a French subcontractor client for construction work — CGI art. 283,
2 nonies, sourced below — goes out however the user typed the rate, with no "autoliquidation" mention
at all. Same story for the Italian, German and Portuguese categories this catalog sources.

## Where the per-country category list lives

**A new top-level catalog, `documents/domestic-reverse-charge/`** — a sibling of `country-policy/`,
`correction-routes/`, `b2g-routing/`, `country-fields/`, `mentions/`, not nested inside `tax/` the way
`tax/tax-systems/` is. Two reasons:

- `tax/tax-systems/` is nested specifically because *nothing but the pure engine* will ever read it —
  its own header says so. This catalog's eventual readers are NOT limited to the engine: the value a
  line actually needs to carry (a category key) is a `country-fields/` overlay concern, and the
  category *list* itself (labels, citations) is naturally something a `country-fields/`-built select
  field's `options` would be generated from. A catalog with more than one natural reader belongs at the
  same level as `country-policy/`/`country-fields/` themselves, not buried inside the one module that
  happens to be its first (future) consumer.
- The brief's own Step 1 pointed at `country-policy/schema.ts` and `channel-policy/schema.ts` — both
  top-level-family modules — for "the provenance discipline any such catalog must carry", which reads
  as guidance toward the same shelf, not merely the same shape.

**Provenance shape**: reuses `PolicyProvenance` (imported from `../country-policy/schema`) rather than
re-declaring an identical `LegalProvenance`/`UnverifiedProvenance` pair a third time. This mirrors
`transports/channel-policy/schema.ts`'s own precedent (it imports the same type from
`../../country-policy/schema`) rather than `tax/tax-systems/schema.ts`'s precedent (which duplicates
its own copy) — the deciding factor is that this catalog sits at `country-policy/`'s own level, where
the channel-policy precedent already applies, not one level further down inside `tax/`'s own narrower
namespace.

**Per-category, not per-file, provenance** — like `country-policy/schema.ts`'s own `rules[]` and
`channel-policy/schema.ts`'s own `facts[]`, unlike `tax/tax-systems/schema.ts`'s one-provenance-per-file
shape. A country's domestic reverse-charge scope is never one fact: Italy alone rests on ten
independent lettere of one comma, each with its own text and its own carve-outs. One shared
`sourceCheckedAt` for all of them would be false precision; one shared `kind` would force an
`unverified` category to borrow a `legal` file's own credibility.

## How a line says which category it is

**`country-fields/`, not the trunk descriptor** — a per-country `add` overlay on `invoice.lines`,
exactly the shape France's own `supplyType` overlay (`country-fields/data/fr.json`) already
establishes for the *identical* kind of problem (a fact only one country's law gives meaning to,
needed per line, not document-wide). Concretely, a future wave would add:

- one `country-fields/data/<cc>.json` overlay per country that ships a `data/<cc>.json` in THIS
  catalog, adding a `domesticReverseChargeCategory` (or similarly named) `'select'` field to
  `invoice.lines`, whose `options` are generated from `DomesticReverseChargeCatalog.categoriesFor(cc)`
  — `value: category.key`, `label: category.label`. This is a **generation step at country-fields
  build time**, not a hand-typed duplicate list: the whole point of sourcing the category list here is
  that nobody re-types it when Italy's sunset clause drops two categories on 2027-01-01.
- **not** a trunk field on `invoice.descriptor.ts`: asserting "which reverse-charge category is this"
  as a universal line concept would be the same "no business code names a country" violation
  `country-fields/schema.ts`'s own header already refuses for France's `supplyType` — most countries
  (today: Poland, and any country with no file in this catalog) have no such categories at all, and a
  field with no options is worse than no field.
- A country with no file in this catalog gets **no such field at all** — same "no entry = trunk fields
  unchanged" posture `country-fields/data/all.ts` already documents.

This is a NAME-ONLY design decision here — no `country-fields/` overlay ships this wave. Building it is
next-wave work, gated on this catalog actually existing (it now does).

## How `tax-engine.ts` learns the buyer is liable

`determineLineTax`'s only inputs are `PartyTaxProfile` (supplier/buyer) and `DocumentLine`. Neither
carries a country or a legal category today. The next wave needs:

- **`DocumentLine` grows one new optional field**, e.g. `domesticReverseChargeCategory?: string` —
  the `key` from this catalog, threaded from `data.lines[i].domesticReverseChargeCategory` (the
  `country-fields/` value above) through `resolve-invoice-tax.ts`'s existing `rows.map(...)` line-
  building loop, the same way `supplyType` already is for the cross-border branch.
- **`domesticVat` grows a THIRD branch**, checked before the `FRANCHISE_BASE`/`EXEMPT` scheme checks
  (a line can only be ONE of "seller is exempt" or "buyer is liable for this specific line" — they are
  mutually exclusive by construction, so ordering only matters for which error a nonsensical INPUT
  produces, not for correctness): if `line.domesticReverseChargeCategory` is set AND
  `DomesticReverseChargeCatalog.categoryFor(supplier.countryCode, line.domesticReverseChargeCategory)`
  resolves to a real fact, emit `rate: 0`, `category: 'AE'` (BT-151 — reverse charge, the SAME UNCL 5305
  code the cross-border branch already uses for its own reverse-charge case), and the mention this
  design's own next section names. A category key that does NOT resolve for that seller's own country
  (stale data, a country whose file was since narrowed) falls through to today's behaviour rather than
  silently charging 0% VAT on an unrecognised claim — the same "an unrecognised fact never wins by
  falling through to the permissive branch" posture `vat-rates/registry.ts`'s own header documents for
  a foreign rate.
- This makes `determineLineTax` no longer a *pure* function of `(PartyTaxProfile, DocumentLine,
  CountryTaxSystemProfile, VatValidator)` in the sense of never touching a catalog — it would need
  either the catalog PASSED IN (a new parameter, threaded through `determineTax` and every call site,
  including every `.spec.ts` in `tax/`) or imported as a module-level constant the way `LOCALIZED_MENTION`
  already is. Given `LOCALIZED_MENTION` already sets the precedent of a module-level table read directly
  by `tax-engine.ts`, and this catalog is of the exact same size class ("four countries, at most a
  couple dozen rows total"), **importing `defaultDomesticReverseChargeCatalog` directly, the same way,
  is the lower-risk choice** — no signature change on `determineLineTax`/`determineTax`, no ripple
  through every existing call site and spec. This is the next wave's call to make, not this one's; it is
  named here because "how does the pure engine learn a country fact" is exactly the question
  `LOCALIZED_MENTION`'s own header already answered once, and re-answering it differently a few weeks
  later would need a strong reason.

## What changes in `resolve-invoice-tax.ts`'s domestic early return

Today (`resolveInvoiceCrossBorderTax`, the `sellerCC === buyerCC` branch):

```ts
if (sellerCC === buyerCC) {
  if (input.seller.taxScheme && input.seller.taxScheme !== 'STANDARD') {
    return applyDomesticTaxScheme(input, sellerCC, rows, taxSystemRegistry, vatValidator);
  }
  assertDomesticRatesKnown(sellerCC, rows, vatRateCatalog);
  return { data: input.data, crossBorder: false, warnings: [] };
}
```

The next wave adds a THIRD condition, checked alongside (not instead of) the existing `taxScheme`
check: **whether any line actually carries a resolvable `domesticReverseChargeCategory`.** Concretely,
something in the shape of:

```ts
const hasDomesticReverseCharge = rows.some((row) =>
  defaultDomesticReverseChargeCatalog.categoryFor(sellerCC, row.domesticReverseChargeCategory as string),
);
if ((input.seller.taxScheme && input.seller.taxScheme !== 'STANDARD') || hasDomesticReverseCharge) {
  return applyDomesticTaxScheme(/* ... */);
}
assertDomesticRatesKnown(sellerCC, rows, vatRateCatalog);
return { data: input.data, crossBorder: false, warnings: [] };
```

`applyDomesticTaxScheme` (already generic over "call `determineTax`, rewrite rows from the result")
needs no change in SHAPE — it already builds a `supplier`/`buyer`/`lines` context and calls
`determineTax`; it would just need `lines` to carry the real `domesticReverseChargeCategory` per row
instead of the placeholder `{ id, description: '', quantity: 1, unitNetMinor: 0, supplyType: 'SERVICES'
}` rows it builds today (that placeholder is fine for a scheme-wide check that ignores line content
entirely, but a reverse-charge check is BY DEFINITION about what one specific line is).

**A plain domestic invoice — no `taxScheme`, no line with a resolvable category — takes the EXACT SAME
path it does today**, including the `assertDomesticRatesKnown` call and the `{ data: input.data, ... }`
return with `input.data` as the SAME OBJECT REFERENCE, never a clone. `rows.some(...)` over an array
where no row has the new field, or where the field never resolves against the catalog, is `false` by
construction — the `hasDomesticReverseCharge` check adds a read, never a write, on that path. This is
exactly why `categoryFor` (this catalog's own lookup) returns `undefined` for an unresolved key rather
than throwing: an early, defensive, "did anyone build a matching country-fields overlay for this
value" check must be side-effect-free on a plain invoice's own hot path.

## Which mention each country needs, and how `LOCALIZED_MENTION` already generalises to this

`tax-engine.ts`'s own `LOCALIZED_MENTION` table (brief-mentions-fiscales-localisées's own deliverable,
already landed as of this wave — see that file's own header comment for the four wordings it already
carries) is keyed by `LocalizableSituation`. Adding domestic reverse charge means adding **one more
situation key**, e.g. `'domesticReverseCharge'`, to that union and that table — NOT reusing the
existing `'reverseCharge'` key, even where the wording is textually identical, for the exact reason
`tax-engine.ts`'s own header already states for `exportGoods`/`intraComm`: two situations that print
the same words but rest on different statutory provisions must stay two different, independently-cited
facts. Concretely, from this wave's own retrieval:

- **Italy — SAME wording as today's `reverseCharge.IT` ("inversione contabile"), DIFFERENT citation.**
  The cross-border entry already shipped cites DPR 633/1972 art. 21 comma 6-bis lett. a) (an invoicing
  ANNOTATION rule for a buyer liable in ANOTHER member state). This catalog's own retrieval of art. 17
  found that comma 5 ITSELF — the provision that actually creates the domestic reverse-charge liability
  this catalog's categories rest on — independently prescribes the SAME annotation: *"La fattura, emessa
  dal cedente senza addebito d'imposta, con l'osservanza delle disposizioni di cui agli articoli 21 e
  seguenti e con l'annotazione «inversione contabile»..."* (quoted in full in `data/it.json`'s own
  `investment-gold` provenance — comma 6 extends comma 5's own annotation requirement to every comma-6
  category via "Le disposizioni di cui al quinto comma si applicano anche"). So `domesticReverseCharge.IT`
  would be `{ code: 'IT_INVERSIONE_CONTABILE_DOMESTIC', text: 'inversione contabile' }`, cited to **DPR
  633/1972 art. 17 comma 5** — never reusing `reverseCharge.IT`'s own art. 21 comma 6-bis citation,
  even though the printed text is byte-identical.
- **Portugal — the EXISTING `reverseCharge.PT` entry may already legally cover this, with NO new
  citation needed.** CIVA art. 36.º n.º 13 (already the citation behind `reverseCharge.PT`) reads:
  *"Nas situações previstas nas alíneas i), j), l), m) e n) do n.º 1 do artigo 2.º, **bem como nas
  demais situações em que o destinatário ou adquirente for o devedor do imposto**, as faturas emitidas
  ... devem conter a expressão 'IVA - autoliquidação'."* The bolded clause is a general catch-all — "as
  well as any other situation where the recipient or buyer is the one who owes the tax" — and the five
  named alíneas are EXACTLY the five categories this catalog's own `data/pt.json` sources. A future
  wave should read this as: **no new `domesticReverseCharge.PT` entry — `localizedMention('reverseCharge',
  'PT', MENTION.reverseCharge)` already returns the right, already-cited text for this case.** This is
  worth flagging loudly precisely because it is the one country where "reuse the existing entry" is not
  a shortcut but the legally correct reading of the same sentence already quoted in the shipped code.
- **Germany — SAME wording as today's `reverseCharge.DE` ("Steuerschuldnerschaft des
  Leistungsempfängers"), DIFFERENT citation.** `tax-engine.ts`'s own comment on `reverseCharge.DE`
  already names the domestic case as a KNOWN, NAMED gap: *"NOT... the domestic § 13b/§ 14a Abs. 5 case
  ...which this engine does not model at all."* UStG § 14a Abs. 5 (quoted in the task brief, re-grepped
  against this wave's own retrieval of `gesetze-im-internet.de/ustg_1980/__14a.html` — not re-fetched
  this wave since the brief's own quote already carries a checked citation) prescribes the identical
  words for exactly the § 13b Abs. 2 categories this catalog sources. So `domesticReverseCharge.DE`
  would be `{ code: 'DE_STEUERSCHULDNERSCHAFT_DOMESTIC', text: 'Steuerschuldnerschaft des
  Leistungsempfängers' }`, cited to **UStG § 14a Abs. 5** — never reusing `reverseCharge.DE`'s own
  § 14a Abs. 1 citation.
- **France — NOT established.** The generic `MENTION.reverseCharge` text ("Autoliquidation / Reverse
  charge — Art. 196 Directive 2006/112/EC") is what a French domestic reverse-charge invoice would get
  by default (no `LOCALIZED_MENTION.reverseCharge.FR`/`domesticReverseCharge.FR` entry exists). Whether
  French law itself NAMES a required wording (the way IT/PT/PL/DE's does) for a CGI art. 283 domestic
  case is a DIFFERENT question from "which categories exist" (this catalog's own scope) — it would need
  its own retrieval of CGI's own invoice-content-mentions provision (CGI ann. II art. 242 nonies A is
  the most likely candidate, by analogy with the mentions catalog's own French sourcing precedent in
  `mentions/data/fr.json`, but this is a NAMED HYPOTHESIS, not a checked fact — do not encode it without
  reading the actual text). Left generic until that retrieval happens.

**Which of the two pieces of work should land first, and why**: `brief-mentions-fiscales-localisées`'s
own deliverable (the `LOCALIZED_MENTION` table and its four existing entries) already landed BEFORE this
wave, so the historical ordering question the brief asked about is moot. What remains is a forward
ordering question for the *next* wave, and the answer is: **the `LOCALIZED_MENTION` extension
(`domesticReverseCharge` key, three new entries, one country left generic) is small enough — an
afternoon, not a wave — that it should land TOGETHER WITH the tax-engine wiring in the same change,
never split into its own prior step.** A domestic reverse-charge branch that charges 0% VAT but prints
the WRONG mention (or the generic Directive-citing one, on a country whose law names a specific phrase)
would repeat, in miniature, the exact defect this whole effort exists to close — "the rate is right but
the paperwork is not". Unlike the mentions brief's own four SITUATIONS (which pre-existed the localised
wording and could be improved independently, one call site at a time, with the engine's existing tests
as a safety net), a `domesticReverseCharge` situation has NO existing call site to retrofit — its
mention and its tax treatment are being introduced in the same commit by construction, so there is no
honest way to sequence them into two waves without one of them being temporarily wrong.

## What this catalog does NOT model, and what would settle each gap

Named per-country in each `data/<cc>.json`'s own `notes` (both file-level and per-category); collected
here for one read:

- **Buyer-status/registration tests** — "the buyer must be an assujetti/soggetto passivo/Unternehmer
  holding a VAT number", "the buyer must itself sustainably perform this kind of work (Germany's own
  tax-office certificate)", the reseller tests on gas/electricity (all four countries). Settled by:
  giving `DomesticReverseChargeCategoryFact` (or `PartyTaxProfile`) a condition axis evaluated against
  real buyer facts this product does not capture today (a VAT-registration flag beyond the existing
  cross-border `validationStatus`, a "performs this trade" flag) — its own piece of work, not a
  catalog-shape problem.
- **Numeric thresholds** — Germany's EUR 5 000 floor on mobile devices/Anlage-4 goods, Portugal's
  ≤ 1 MW electricity-capacity ceiling. Settled by: adding an amount/capacity field to
  `DomesticReverseChargeCategoryFact` and a comparison in the next wave's `domesticVat` branch — not
  attempted here per the brief's own explicit instruction not to model thresholds this wave.
- **Buyer-role carve-outs** — Italy's "contraente generale" exclusion (a general contractor entrusted
  with the WHOLE of the works is NOT covered by the construction-subcontracting category, even though
  every other subcontractor is). Settled by: the same condition axis as buyer-status tests above; this
  is a genuinely relational fact (buyer's role relative to OTHER parties on the same job), not a
  property of the buyer alone, and needs its own modelling thought, not a quick field.
- **EU Council derogation windows** — Italy's own comma 6 lett. a-quater) (consortium public works) is
  textually conditioned on an EU Council authorisation under Directive 2006/112/EC art. 395 that this
  wave did not check is currently in force. Settled by: reading the Council's own implementing decision,
  a different research task from reading DPR 633/1972 itself.
- **Sunset/effective dates** — Italy's own comma 6 lett. b)/c)/d-bis)/d-ter)/d-quater) expire
  2026-12-31 (already in the retrieved text, quoted in `data/it.json`'s own file-level `notes`);
  Portugal's own alínea j) took effect 2026-07-01 (optionally 2026-01-01). This schema has NO temporal-
  validity field (contrast `mentions/schema.ts`'s own `Temporal<T>`) — a category past its own sunset
  is currently indistinguishable, TO CODE, from one still in force. Settled by: either a `validFrom`/
  `validTo` pair on `DomesticReverseChargeCategoryFact` (the `mentions/` precedent already exists to
  copy), or — cheaper, given today's actual expiry list is short — a calendar reminder to re-check
  Italy's five sunset-bound categories before 2027-01-01. Named here so it is not forgotten silently.
- **Annex/list contents** — Germany's own Anlage 3 (Nr. 7, scrap/waste) and Anlage 4 (Nr. 11, base
  metals), Portugal's own Anexo E (alínea i, waste/scrap/recyclables). This catalog sources the
  TRIGGERING provision (the fact that "goods in Anlage 3" is a category), never the annex's own item
  list. Settled by: a dedicated retrieval of each annex, only worth doing once a caller actually needs
  to check a specific good against the list rather than merely accept the user's own category choice.
- **Poland** — no category data ships at all (see `data/all.ts`'s own header). The already-landed
  `LOCALIZED_MENTION.reverseCharge.PL` sources only the WORDING a reverse-charge invoice must carry
  (ustawa o VAT art. 106e ust. 1 pkt 18), not WHICH transactions trigger one. Settled by: reading
  ustawa o VAT's own current substantive reverse-charge provisions (NOT the repealed za łącznik 14
  construction mechanism, which is exactly the kind of "recalled from training data" fact this
  catalog's own discipline refuses to encode without a fresh primary-source check).
- **France's cross-border-flavoured paragraphs** — CGI art. 283, 1/2/2 bis (explicitly conditioned on
  a supplier "établi hors de France")/2 ter (not retrieved, character unknown)/2 decies (a ministerial
  POWER to add categories, not itself one)/3/4/4 bis/4 ter/5 (VAT wrongly invoiced or fraud liability —
  a different legal concept entirely). None of these is a domestic reverse-charge category; see
  `data/fr.json`'s own file-level `notes` for the full reasoning per paragraph.
- **Germany's own cross-border-flavoured Nummern** — § 13b Abs. 2 Nr. 1 and Nr. 5 Buchst. a), both
  explicitly conditioned on the SUPPLIER being established abroad — excluded from this DOMESTIC catalog
  for the same reason as France's own art. 283, 1/2/2 bis.
- **Italy's own scrap-metal reverse charge** — DPR 633/1972 art. 74 commi 7-8, a DIFFERENT article from
  art. 17 (the one every Italian category in this catalog is drawn from). Not retrieved this wave;
  France/Germany/Portugal each have a `waste-and-scrap-materials` category, Italy does not, and that
  asymmetry is a recorded gap, not an oversight to paper over by forcing an Italian entry under the
  shared key without having read the actual statute that would source it.

## Key-sharing policy (a note on `schema.ts`'s own `key` field)

A `key` shared across two countries' JSON files (e.g. `construction-subcontracting`,
`investment-gold`, `waste-and-scrap-materials`, `greenhouse-gas-and-energy-certificates`,
`gas-and-electricity-to-reseller`, `telecommunications-services`, `consumer-electronics-preretail`) is
a **labelling convenience for a future picker or report, never a legal-equivalence claim**. Every
category's own `legalRef`/`sourceText` is what actually governs; a shared key's own per-country `notes`
says explicitly where the scopes diverge (e.g. Germany's Nr. 10 includes mobile phones, Italy's lett.
c) does not; Portugal's own alínea l) covers only GHG allowances, not the broader gas/electricity
certificates Italy/Germany/France's own texts also name). A country-specific key (prefixed `it-`, `de-`,
`pt-`) is used wherever no other retrieved text names a comparable category, rather than forcing a
generic name that implies a comparison this wave never checked.
