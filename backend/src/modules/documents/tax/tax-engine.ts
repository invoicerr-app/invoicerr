/**
 * The Tax Determination Engine (cross-border tax). CARRIED OVER almost verbatim from
 * `compliance/engine/tax-engine.ts` (git tag `avant-refonte-documents`, `COMPLIANCE_ARCHITECTURE.md`
 * §9 in that lineage) — a pure, deterministic cascade over (supplier tax system, buyer, same
 * country?, same union?, role, supply type, VAT validity) producing a per-line `TaxTreatment`. This
 * is where FR→IT, US→FR, FR→US are actually decided — by *composition* of the two countries, never a
 * country-pair special case (`classification.ts#taxUnionOf`, a TABLE, never an N² map of pairs).
 *
 * ONLY the import paths changed (this module's own `./types`/`./classification` rather than the
 * removed `../canonical/canonical-document`/`../profiles/schema`) — every mention TEXT, every branch,
 * every comment below is the reference's own, unedited. `resolve-invoice-tax.ts` is the wiring that
 * calls this pure engine from the actual "send" flow, decides roles from a
 * REAL stored VAT-validation verdict, and adds the stricter no-silent-fallback guards (unresolved
 * buyer country, OSS with no destination rate table) the product's own history required — see that
 * file's own header. This file stays exactly what it was at the reference: a pure function of its
 * inputs, never aware of Prisma, of "sending", or of any HTTP call.
 *
 * THREE amendments, since the reference, all additive (every existing branch, mention and comment not
 * mentioned below is still the reference's own, unedited):
 *
 * 1. (2026-09-13) `domesticVat`'s FRANCHISE_BASE branch below used to pick between exactly two
 *    mentions (FR's own art. 293 B wording, or the generic small-business one for every other
 *    country). A THIRD, PT-specific wording was added the same day the wiring that actually calls
 *    this branch for a real domestic invoice was fixed (`resolve-invoice-tax.ts`'s own
 *    `applyDomesticTaxScheme`) — see that mention's own comment for its source.
 * 2. (2026-09-13) Some member states do not merely require "a mention" for one of the cross-border
 *    situations above — their statute NAMES the exact expression, and the generic Directive-citing
 *    text is not what discharges the obligation there. `LOCALIZED_MENTION` below is the per-(situation,
 *    country) table of those sourced overrides — see its own header for what it covers, what it
 *    deliberately does not, and why it is a plain TS table rather than a `data/*.json` catalog.
 * 3. (2026-09-21) The reference's "B2C across the union" branch taxed EVERY such sale of goods in the
 *    BUYER's country, from the first euro. That is only half of Directive 2006/112/EC: art. 59c(1)
 *    disapplies art. 33(a) below a EUR 10 000 per-seller, per-calendar-year, all-member-states-combined
 *    threshold, leaving art. 32 (the seller's own country) to govern. The branch now reads the seller's
 *    OWN DECLARED `PartyTaxProfile.distanceSalesRegime` — see `types.ts` for the articles quoted in
 *    full, the branch itself for what each value does, and `resolve-invoice-tax.ts` for the named block
 *    that refuses to run this branch at all on a seller who has declared nothing. `ossDestinationVat`
 *    below is untouched, including the rate it can and cannot resolve (see its own comment).
 */
import {
  DocumentLine,
  LegalMention,
  PartyTaxProfile,
  ReportingKind,
  TaxCategoryCode,
  TaxComponent,
  TaxTreatment,
  TransactionContext,
  CountryTaxSystemProfile,
  SalesTaxSystemSpec,
  VatSystemSpec,
} from './types';
import { TaxUnion, VatValidator, taxUnionOf } from './classification';

const MENTION = {
  reverseCharge: {
    code: 'REVERSE_CHARGE',
    text: 'Autoliquidation / Reverse charge — Art. 196 Directive 2006/112/EC',
  },
  intraComm: {
    code: 'INTRA_COMMUNITY',
    text: 'Intra-Community supply — Art. 138 Directive 2006/112/EC',
  },
  exportGoods: { code: 'EXPORT', text: 'Export — zero-rated, Art. 146 Directive 2006/112/EC' },
  outOfScope: {
    code: 'OUT_OF_SCOPE',
    text: 'VAT not applicable — supply outside the scope of EU VAT',
  },
  fr293b: { code: 'FR_293B', text: 'TVA non applicable, art. 293 B du CGI' },
  // Código do IVA (CIVA) art. 57.º n.º 2 (redação do Decreto-Lei n.º 35/2025, de 24 de março) NAMES
  // this exact wording for the invoice a small-business-exempt taxpayer (CIVA art. 53.º n.º 1) must
  // issue — verbatim: "As faturas emitidas pelos sujeitos passivos referidos no número anterior no
  // exercício da sua atividade devem sempre conter a menção 'IVA - regime de isenção'." Read directly
  // from the Autoridade Tributária's own consolidated CIVA PDF (curl + pdftotext, 2026-09-13) — not
  // translated, not given an article-number suffix the statute's own printed wording does not carry
  // (unlike `fr293b` above, whose French text names its own article inline).
  ptRegimeIsencao: { code: 'PT_REGIME_ISENCAO', text: 'IVA - regime de isenção' },
  franchise: { code: 'FRANCHISE', text: 'VAT exempt — small business scheme' },
  importSelfAssess: {
    code: 'IMPORT_SELF_ASSESS',
    text: 'Buyer to self-assess VAT on import (reverse charge in destination country)',
  },
  noTaxSystem: {
    code: 'NO_TAX_SYSTEM',
    text: "No VAT or equivalent turnover tax exists in the supplier's country",
  },
  usNoNexus: {
    code: 'US_NO_NEXUS',
    text: 'No sales tax collected — no nexus in destination state (buyer may owe use tax)',
  },
} as const;

/** The four `MENTION` entries a member state's own statute can override with a prescribed wording —
 *  the other entries above (`outOfScope`, `importSelfAssess`, `noTaxSystem`, `usNoNexus`) are this
 *  engine's own descriptive text for a situation no state's invoicing law names a fixed expression
 *  for, so they are never looked up in `LOCALIZED_MENTION` below. */
type LocalizableSituation = 'reverseCharge' | 'intraComm' | 'exportGoods' | 'franchise';

/**
 * Per-(situation, country) overrides of the generic `MENTION` text above, for the member states whose
 * OWN statute names the exact expression an invoice must carry — see `localizedMention` below for how
 * this is consulted, and each entry's own comment for the primary-source citation it is read from.
 * `MENTION.xxx` (the generic Directive-citing wording) is what every country with NO entry here still
 * gets, byte for byte, exactly as before this table existed — `localizedMention` falls back to it,
 * never to `undefined`.
 *
 * Kept as a plain TS table here, deliberately NOT a `data/<country>.json` catalog the way
 * `tax-systems/` or `country-identifiers/` are (this module's own governing "a country is data"
 * principle notwithstanding) — three reasons specific to THIS fact, not a blanket exception:
 *
 * 1. The country axis is not open-ended. This product ships exactly five countries today
 *    (FR/DE/IT/PL/PT — `tax-engine.spec.ts`'s own header on the 2026-09-10 five-country prune), so
 *    this table is a hard ceiling of five rows, most of them empty. A `data/*.json`-per-country
 *    catalog earns its own loader/schema/discovery machinery when the country axis is genuinely
 *    open (any of ~195 countries might one day get a file, as for `tax-systems/`); here it cannot
 *    grow past what is already written below.
 * 2. The fact is not "one blob per country" the way `CountryTaxSystemFact` is (a handful of scalars
 *    and ONE `provenance` for the whole file) — it is one fact per (situation, country) PAIR, and
 *    Italy needs the SAME country to cite two DIFFERENT statutes for two situations that happen to
 *    share identical wording (`exportGoods` cites DPR 633/1972 art. 21 co. 6 lett. b; `intraComm`
 *    cites D.L. 331/1993 art. 46 co. 2 — see each entry below). Modeling that faithfully in a
 *    per-country JSON file means an array of situation-keyed facts anyway, which buys nothing over
 *    this table and loses TypeScript's compile-time exhaustiveness over `LocalizableSituation`.
 * 3. `determineLineTax` is documented above as "a pure function of its inputs, never aware of
 *    Prisma... or any HTTP call". Reading a `data/*.json` catalog through a loader would mean either
 *    threading a new parameter through this function and every call site (`resolve-invoice-tax.ts`
 *    and every `.spec.ts` in this directory), or importing the catalog as a module-level side effect
 *    — which is exactly what this table already is, just relocated for no behavioural gain. This
 *    round of work changes WORDING only, never the conditions a mention fires under; rewiring the
 *    engine's own input shape to satisfy an architectural preference nobody asked for would be its
 *    own, separate piece of work.
 *
 * If either axis grows past this — a sixth country, or Portugal's own domestic reverse-charge
 * categories (waste, construction subcontracting, greenhouse-gas allowances, mobile phones and
 * integrated circuits, cork and wood — a NAMED, deliberately unbuilt gap, see
 * `resolve-invoice-tax.ts`) ever get modeled as a second condition axis — this calculus should be
 * re-run: a `data/*.json` catalog with its own `schema.ts` (a `LegalProvenance`/`UnverifiedProvenance`
 * pair, exactly like `tax-systems/schema.ts`'s own), an `all.ts` loader (`readdirSync` +
 * `assertValid…` at load time, exactly like `mentions/data/all.ts`'s own), and a `registry.spec.ts`
 * proving discovery is the right shape once this table stops being "five rows, mostly empty".
 */
const LOCALIZED_MENTION: Partial<Record<LocalizableSituation, Partial<Record<string, LegalMention>>>> = {
  franchise: {
    // Kept as references to the SAME objects `MENTION.fr293b`/`MENTION.ptRegimeIsencao` already are
    // above, never retyped — see each constant's own comment for its citation. This table only makes
    // the lookup explicit; it changes no text `domesticVat` was already printing.
    FR: MENTION.fr293b,
    PT: MENTION.ptRegimeIsencao,
  },
  reverseCharge: {
    // CIVA art. 36.º n.º 13 (redação do Decreto-Lei n.º 85/2022, de 21 de dezembro — produz efeitos a
    // partir de 1 de janeiro de 2023) — verbatim: "Nas situações previstas nas alíneas i), j), l), m)
    // e n) do n.º 1 do artigo 2.º, bem como nas demais situações em que o destinatário ou adquirente
    // for o devedor do imposto, as faturas emitidas pelo transmitente dos bens ou prestador dos
    // serviços devem conter a expressão 'IVA - autoliquidação'." Read from the Autoridade
    // Tributária's own consolidated CIVA PDF (curl + pdftotext, 2026-09-13; re-checked against a
    // fresh retrieval the same day — the phrase is split across a `pdftotext -layout` line break,
    // 'IVA -\nautoliquidação', which is the PDF's own layout, not part of the expression). The ASCII
    // `'…'` is the statute's own punctuation (contrast art. 57.º's typographic `'…'` below), not part
    // of the expression either way.
    PT: { code: 'PT_IVA_AUTOLIQUIDACAO', text: 'IVA - autoliquidação' },
    // DPR 633/1972 (repealed 2027-01-01, renumbered into a new Testo Unico) art. 21 comma 6-bis lett.
    // a) — verbatim: "cessioni di beni e prestazioni di servizi, diverse da quelle di cui
    // all'articolo 10, nn. da 1) a 4) e 9), effettuate nei confronti di un soggetto passivo che è
    // debitore dell'imposta in un altro Stato membro dell'Unione europea, con l'annotazione
    // «inversione contabile»" — an Italian-established supplier's cross-border B2B reverse-charge
    // supply (of goods OR services) to a taxable person liable in another member state, exactly the
    // situation this engine's `reverseCharge` mention already fires on. Read from normattiva.it's own
    // consolidated text (curl, 2026-09-13) — this article comes down as raw text (no JS wall). The
    // guillemets «…» are the statute's own punctuation, not part of the expression.
    IT: { code: 'IT_INVERSIONE_CONTABILE', text: 'inversione contabile' },
    // ustawa o VAT art. 106e ust. 1 pkt 18 — verbatim: "w przypadku dostawy towarów lub wykonania
    // usługi, dla których obowiązanym do rozliczenia podatku od wartości dodanej lub podatku o
    // podobnym charakterze jest nabywca towaru lub usługi – wyrazy „odwrotne obciążenie”" — "the
    // buyer is the one liable to account for the tax" is exactly this engine's `reverseCharge`
    // trigger. Read from the gazetted consolidated text, Dz.U. 2024 poz. 361
    // (dziennikustaw.gov.pl — isap.sejm.gov.pl is behind Incapsula and does not serve over plain
    // curl), curl + pdftotext, 2026-09-13. The „…” are Polish typographic quotes (U+201E/U+201D,
    // confirmed on the retrieved text), the statute's own punctuation, not part of the expression.
    PL: { code: 'PL_ODWROTNE_OBCIAZENIE', text: 'odwrotne obciążenie' },
    // UStG § 14a Abs. 1 (gesetze-im-internet.de, curl, 2026-09-13) — verbatim: "...so ist er zur
    // Ausstellung einer Rechnung mit der Angabe „Steuerschuldnerschaft des Leistungsempfängers“
    // verpflichtet, wenn die Steuer in dem anderen Mitgliedstaat von dem Leistungsempfänger [...]" —
    // a German-established trader performing a transaction in another member state where the
    // recipient owes the tax, exactly this engine's cross-border B2B `reverseCharge` branch. NOT §
    // 14 (the string does not occur there at all — checked) and NOT the domestic § 13b/§ 14a Abs. 5
    // case ("...ist er zur Ausstellung einer Rechnung mit der Angabe „Steuerschuldnerschaft des
    // Leistungsempfängers“ verpflichtet; Absatz 1 bleibt unberührt"), which this engine does not
    // model at all — see `resolve-invoice-tax.ts` for that named gap. The „…“ are the statute's own
    // (German-convention, opening-low/closing-high) typographic quotes, not part of the expression.
    // Contrast the FRANCHISE situation above: UStG § 14 Abs. 4 Nr. 8 requires only a generic
    // reference for an exemption ("...einen Hinweis darauf, dass für die Lieferung oder sonstige
    // Leistung eine Steuerbefreiung gilt"), no fixed wording — which is why Germany has NO entry
    // under `franchise` above and correctly still gets the generic `MENTION.franchise` text.
    DE: { code: 'DE_STEUERSCHULDNERSCHAFT', text: 'Steuerschuldnerschaft des Leistungsempfängers' },
  },
  exportGoods: {
    // DPR 633/1972 art. 21 comma 6 lett. b) — verbatim: "operazioni non imponibili di cui agli
    // articoli 8, 8-bis, 9 e 38-quater, con l'annotazione «operazione non imponibile»" — art. 8 is
    // the export-of-goods case, exactly this engine's `exportGoods` branch (supplier in the EU,
    // buyer outside it, goods). Read from normattiva.it (curl, 2026-09-13). Distinct CODE from
    // `intraComm`'s Italian entry below even though the wording happens to coincide — the two rest
    // on different statutes (this one on DPR 633/1972 itself; intra-Community supplies on D.L.
    // 331/1993, which does not enumerate through DPR 633 art. 21 comma 6 at all) and must never be
    // collapsed into one citation just because the printed text matches.
    IT: { code: 'IT_OPERAZIONE_NON_IMPONIBILE_EXPORT', text: 'operazione non imponibile' },
  },
  intraComm: {
    // D.L. 331/1993 art. 46 comma 2 (normattiva.it, curl, 2026-09-13) — verbatim: "Per le cessioni
    // intracomunitarie di cui all'articolo 41, è emessa fattura a norma dell'articolo 21 del decreto
    // del Presidente della Repubblica 26 ottobre 1972, n. 633, entro il giorno 15 del mese successivo
    // a quello di effettuazione dell'operazione, con l'indicazione, in luogo dell'ammontare
    // dell'imposta, che si tratta di operazione non imponibile e con l'eventuale specificazione della
    // relativa norma comunitaria o nazionale." Italian intra-Community supplies of GOODS are governed
    // by art. 41 of D.L. 331/1993, NOT by the arts. 8/8-bis/9/38-quater DPR 633/1972 art. 21 comma 6
    // lett. b) enumerates (that comma is `exportGoods`'s own citation above, a different statute
    // entirely) — this comma is what actually names the invoicing rule for them, and it prescribes
    // the SAME words, "operazione non imponibile", under a DIFFERENT citation. Comma 2 also requires
    // the buyer's own member-state VAT identification number on the invoice (BT-48) — already carried
    // whenever `build-semantic-invoice.ts` has one on file for the buyer, untouched here.
    IT: { code: 'IT_OPERAZIONE_NON_IMPONIBILE_ICS', text: 'operazione non imponibile' },
  },
};

/** Looks up a country's own prescribed wording for one situation, falling back to the generic
 *  `MENTION` entry byte for byte when the country (or the situation) has no override — see
 *  `LOCALIZED_MENTION`'s own header for what is and is not covered. */
function localizedMention(
  situation: LocalizableSituation,
  countryCode: string,
  generic: LegalMention,
): LegalMention {
  return LOCALIZED_MENTION[situation]?.[countryCode.toUpperCase()] ?? generic;
}

function treatment(
  component: TaxComponent,
  buyerSelfAssess: boolean,
  reportingFlags: ReportingKind[],
  mentions: LegalMention[],
): TaxTreatment {
  return { components: [component], buyerSelfAssess, reportingFlags, mentions };
}

export function determineLineTax(
  supplier: PartyTaxProfile,
  buyer: PartyTaxProfile,
  line: DocumentLine,
  supplierProfile: CountryTaxSystemProfile,
  vat: VatValidator,
  buyerProfile?: CountryTaxSystemProfile,
): TaxTreatment {
  const sys = supplierProfile.taxSystem;
  const sCountry = supplier.countryCode.toUpperCase();
  const bCountry = buyer.countryCode.toUpperCase();
  const sameCountry = sCountry === bCountry;
  const sUnion = taxUnionOf(sCountry);
  const inSameUnion = !!sUnion && sUnion === taxUnionOf(bCountry);

  // 0. Supplier has no VAT system.
  if (sys.kind === 'SALES_TAX') return salesTax(supplier, buyer, sys, buyerProfile);
  if (sys.kind === 'NONE') {
    return treatment(
      {
        taxSystem: 'NONE',
        name: 'None',
        category: 'O',
        rate: 0,
        jurisdiction: sCountry,
        reason: MENTION.noTaxSystem.text,
      },
      false,
      [],
      [MENTION.noTaxSystem],
    );
  }

  // --- VAT / GST world ---
  // 1. Domestic.
  if (sameCountry) return domesticVat(line, sys, supplier);

  // 2. Cross-border within the same tax union (EU↔EU, GCC↔GCC).
  if (inSameUnion) {
    if (buyer.role === 'B2B' && vat.hasValidVat(buyer)) {
      if (line.supplyType === 'GOODS') {
        return treatment(
          {
            taxSystem: sys.kind,
            name: 'VAT',
            category: 'K',
            rate: 0,
            reason: 'VATEX-EU-IC',
            jurisdiction: sCountry,
          },
          false,
          ['EC_SALES_LIST', 'INTRASTAT'],
          [localizedMention('intraComm', sCountry, MENTION.intraComm)],
        );
      }
      // Services (and digital) B2B → reverse charge in the buyer's country.
      return treatment(
        {
          taxSystem: sys.kind,
          name: 'VAT',
          category: 'AE',
          rate: 0,
          reason: 'VATEX-EU-AE',
          jurisdiction: bCountry,
        },
        true,
        ['EC_SALES_LIST'],
        [localizedMention('reverseCharge', sCountry, MENTION.reverseCharge)],
      );
    }
    // B2C across the union (distance sales of goods, and the telecommunications/broadcasting/
    // electronic services art. 58 groups with them) → the SELLER's OWN DECLARED regime decides which
    // member state taxes this, because the two countries alone cannot: see
    // `types.ts#DistanceSalesRegime` for Directive 2006/112/EC arts. 32, 33(a) and 59c quoted in full,
    // and for why the EUR 10 000 threshold behind them is a per-seller running total this engine must
    // never compute or guess.
    //   - ORIGIN — art. 59c(1) disapplies art. 33(a)/art. 58, so art. 32's general rule governs and the
    //     supply is taxed in the SELLER's own member state at the SELLER's own rate. That is exactly
    //     `domesticVat`, the same branch a domestic sale of the same goods takes — `taxRateHint`
    //     included, so a reduced rate the seller is genuinely entitled to at home survives instead of
    //     being flattened to a standard rate. No 'OSS' reporting flag either: an origin-taxed supply is
    //     declared on the seller's ordinary domestic VAT return, not through the One-Stop-Shop.
    //   - DESTINATION — art. 33(a) (goods) or art. 58 (TBE services): the buyer's member state, whether
    //     because the threshold was crossed (art. 59c(2)) or because the seller opted in (art. 59c(3)).
    //   - UNDECLARED — kept on the DESTINATION branch, deliberately, as this PURE engine's own historic
    //     behaviour (byte-identical to what it did before this field existed), exactly like
    //     `ossDestinationVat`'s own seller-rate fallback below: a property of this function, not a
    //     posture the product ships. `resolve-invoice-tax.ts` refuses an undeclared regime by name
    //     (`UndeclaredDistanceSalesRegimeError`) BEFORE calling this engine, so no real send can reach
    //     it — see that file's own header, "the hard blocks this product's own history required".
    if (line.supplyType === 'GOODS' || line.supplyType === 'DIGITAL') {
      if (supplier.distanceSalesRegime === 'ORIGIN') return domesticVat(line, sys, supplier);
      return ossDestinationVat(sys, bCountry, buyerProfile);
    }
    // Other B2C services across the union → default to taxing where the supplier is.
    return domesticVat(line, sys, supplier);
  }

  // 3. Supplier in a VAT union, buyer OUTSIDE it.
  if (line.supplyType === 'GOODS') {
    return treatment(
      {
        taxSystem: sys.kind,
        name: 'VAT',
        category: 'G',
        rate: 0,
        reason: 'VATEX-EU-G',
        jurisdiction: sCountry,
      },
      false,
      ['CUSTOMS_EXPORT'],
      [localizedMention('exportGoods', sCountry, MENTION.exportGoods)],
    );
  }
  // Services to a non-union country: place of supply is the customer → outside scope for supplier.
  return treatment(
    {
      taxSystem: sys.kind,
      name: 'VAT',
      category: 'O',
      rate: 0,
      reason: 'VATEX-EU-O',
      jurisdiction: bCountry,
    },
    true,
    [],
    [MENTION.outOfScope],
  );
}

function domesticVat(line: DocumentLine, sys: VatSystemSpec, supplier: PartyTaxProfile): TaxTreatment {
  // Small-business exemption schemes (FR 293 B, PT's own CIVA wording, and generic franchise /
  // exempt for every other country — see `LOCALIZED_MENTION.franchise` above for sourcing; a country
  // with no dedicated entry there falls back to the generic mention rather than an invented wording).
  if (supplier.taxScheme === 'FRANCHISE_BASE') {
    const mention = localizedMention('franchise', supplier.countryCode, MENTION.franchise);
    return treatment(
      {
        taxSystem: sys.kind,
        name: 'VAT',
        category: 'E',
        rate: 0,
        jurisdiction: supplier.countryCode,
        reason: mention.text,
      },
      false,
      [],
      [mention],
    );
  }
  if (supplier.taxScheme === 'EXEMPT') {
    return treatment(
      {
        taxSystem: sys.kind,
        name: 'VAT',
        category: 'E',
        rate: 0,
        jurisdiction: supplier.countryCode,
        reason: MENTION.franchise.text,
      },
      false,
      [],
      [],
    );
  }
  const rate = zeroByHint(line) ? 0 : (line.taxRateHint ?? sys.standardRate);
  const category = line.taxCategoryHint ?? domesticCategoryFor(rate, sys);
  return treatment(
    {
      taxSystem: sys.kind,
      name: 'VAT',
      category,
      rate,
      jurisdiction: supplier.countryCode,
      reason: NEEDS_EXEMPTION_REASON.has(category) ? line.taxExemptionReasonHint : undefined,
    },
    false,
    [],
    [],
  );
}

/** Categories that mean "no VAT is charged on this line". They all imply a 0 rate. */
const UNTAXED_HINTS: ReadonlySet<TaxCategoryCode> = new Set(['Z', 'E', 'O']);

/** Which declared categories carry an exemption reason through to the document. */
const NEEDS_EXEMPTION_REASON: ReadonlySet<TaxCategoryCode> = new Set(['E', 'O']);

function zeroByHint(line: DocumentLine): boolean {
  return !!line.taxCategoryHint && UNTAXED_HINTS.has(line.taxCategoryHint);
}

/** The category of a DOMESTIC line, when nobody has declared one — see the reference's own, much
 *  longer comment here (git tag `avant-refonte-documents:backend/src/compliance/engine/
 *  classification.ts`) for the full reasoning on why a bare 0 rate cannot pick between Z/E/O on its
 *  own, and why `hasDomesticZeroRate === false` answers `E` (fails loud) rather than `O` (sails
 *  through silently wrong). */
function domesticCategoryFor(rate: number, sys: VatSystemSpec): TaxCategoryCode {
  if (rate > 0) return 'S';
  return sys.hasDomesticZeroRate === false ? 'E' : 'Z';
}

function ossDestinationVat(
  sys: VatSystemSpec,
  destination: string,
  buyerProfile?: CountryTaxSystemProfile,
): TaxTreatment {
  // Charge the destination country's standard rate when we know it; otherwise fall back to the
  // supplier's standard rate (placeholder) — see this reference-ported branch's OWN limitation, and
  // `resolve-invoice-tax.ts`'s header for why the WIRING never lets an invoice reach this fallback in
  // production: it blocks, named, before ever calling this function without a real `buyerProfile`.
  //
  // THE STANDARD RATE IS THE ONLY RATE THIS BRANCH CAN RESOLVE, and that is a KNOWN, UNCLOSED gap, not
  // an oversight: a destination member state's own reduced rate (a book at 7% in Germany rather than
  // 19%) depends on WHAT is being sold, and neither half of the input exists — `CountryTaxSystemFact`
  // carries no sourced `reducedRates` for DE/IT/PL/PT (each `tax-systems/data/*.json` says so in its
  // own notes) and `DocumentLine` carries no product classification (a CN/CPA code, an Annex III
  // category) a reduced rate could be selected against even if it did. Applying the destination's
  // standard rate to a reduced-rated product OVER-charges the consumer. `resolve-invoice-tax.ts`
  // states that, per invoice, as a named non-fatal warning rather than leaving it silent — closing it
  // for real needs a per-line product classification the invoice does not have today.
  const dest = buyerProfile?.taxSystem;
  const rate =
    dest && dest.kind !== 'SALES_TAX' && dest.kind !== 'NONE' ? dest.standardRate : sys.standardRate;
  return treatment(
    { taxSystem: sys.kind, name: 'VAT (OSS)', category: 'S', rate, jurisdiction: destination },
    false,
    ['OSS'],
    [],
  );
}

function salesTax(
  supplier: PartyTaxProfile,
  buyer: PartyTaxProfile,
  sys: SalesTaxSystemSpec,
  buyerProfile?: CountryTaxSystemProfile,
): TaxTreatment {
  const sCountry = supplier.countryCode.toUpperCase();
  const bCountry = buyer.countryCode.toUpperCase();

  // Cross-border: the US levies no sales tax on exports; the destination handles import taxation.
  if (sCountry !== bCountry) {
    const destUnion: TaxUnion | null = taxUnionOf(bCountry);
    const destIsVat =
      !!destUnion || buyerProfile?.taxSystem.kind === 'VAT' || buyerProfile?.taxSystem.kind === 'GST';
    return treatment(
      {
        taxSystem: 'SALES_TAX',
        name: 'Sales Tax',
        category: 'O',
        rate: 0,
        jurisdiction: sCountry,
        reason: MENTION.outOfScope.text,
      },
      destIsVat,
      [],
      destIsVat ? [MENTION.importSelfAssess] : [],
    );
  }

  // Domestic US: destination-based; collect only where the seller has nexus.
  const state = (buyer.address?.subdivision ?? '').toUpperCase();
  const hasNexus = !!sys.nexusSubdivisions?.map((s) => s.toUpperCase()).includes(state);
  if (!state || !hasNexus) {
    return treatment(
      {
        taxSystem: 'SALES_TAX',
        name: 'Sales Tax',
        category: 'O',
        rate: 0,
        jurisdiction: bCountry,
        subdivision: state || undefined,
        reason: MENTION.usNoNexus.text,
      },
      false,
      [],
      [MENTION.usNoNexus],
    );
  }
  const rate = sys.stateRates[state] ?? 0;
  return treatment(
    {
      taxSystem: 'SALES_TAX',
      name: `Sales Tax (${state})`,
      category: rate > 0 ? 'S' : 'O',
      rate,
      jurisdiction: bCountry,
      subdivision: state,
    },
    false,
    [],
    [],
  );
}

export interface DocumentTaxResult {
  lines: { lineId: string; treatment: TaxTreatment }[];
  reportingFlags: ReportingKind[];
  mentions: LegalMention[];
  buyerSelfAssess: boolean;
}

/** Determine tax for every line and aggregate document-level flags and mentions. */
export function determineTax(
  ctx: TransactionContext,
  supplierProfile: CountryTaxSystemProfile,
  vat: VatValidator,
  buyerProfile?: CountryTaxSystemProfile,
): DocumentTaxResult {
  const lines = ctx.lines.map((line) => ({
    lineId: line.id,
    treatment: determineLineTax(ctx.supplier, ctx.buyer, line, supplierProfile, vat, buyerProfile),
  }));

  const flags = new Set<ReportingKind>();
  const mentions: LegalMention[] = [];
  const seen = new Set<string>();
  let buyerSelfAssess = false;

  for (const { treatment: t } of lines) {
    for (const f of t.reportingFlags) flags.add(f);
    t.mentions.forEach((m) => {
      if (!seen.has(m.code)) {
        seen.add(m.code);
        mentions.push(m);
      }
    });
    if (t.buyerSelfAssess) buyerSelfAssess = true;
  }

  return { lines, reportingFlags: [...flags], mentions, buyerSelfAssess };
}
