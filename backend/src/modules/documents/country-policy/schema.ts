/**
 * The country DOCUMENT-ACTION POLICY — the file format for "which country may run which document
 * action" (documents/, this branch's own concern — not the removed compliance engine, which used to
 * own tax/format/transmission rules under a similarly-shaped "a country is data" principle). See
 * data/fr.json and data/de.json for worked examples, and country-policy.ts for how a rule is read
 * back at request time.
 *
 * Every rule MUST carry its own PROVENANCE — nothing here is allowed to exist without saying where
 * it came from, enforced by `assertValidProvenance` below. That function is called at TWO
 * independent points (data/all.ts when a file is loaded, seed.ts again right before writing) so
 * that neither "a hand-built catalog that skipped the file loader" nor "a JSON file that skipped
 * this exact shape" can ever slip a bare, unsourced rule into the database.
 *
 *  - `legal`: sourced to an exact legal text, with the date it was last checked against that text.
 *  - `unverified`: not sourced to law — `resolutionNote` says PLAINLY what would have to be checked
 *    to turn this into a `legal` entry. An `unverified` entry is not a lesser citizen: a country file
 *    made mostly of honest `unverified` entries is the expected, acceptable state for a jurisdiction
 *    nobody has finished the legal research for — see this module's own fr.json/us.json for how far
 *    one real research pass got before hitting a real access limit (Légifrance blocks automated
 *    requests; this module says so rather than pretending a citation came from there when it didn't).
 */

export interface LegalProvenance {
  kind: 'legal';
  /** The exact text this rule is based on — quoted, not paraphrased. */
  sourceText: string;
  /** ISO date (yyyy-mm-dd) this text was last checked against its source. */
  sourceCheckedAt: string;
}

export interface UnverifiedProvenance {
  kind: 'unverified';
  /** What would have to be checked (which text, which register, which authority) to settle this
   *  rule — never left blank: an "unverified" entry with no resolution note is exactly the kind of
   *  "looks fine but isn't" state this format exists to make impossible. */
  resolutionNote: string;
}

export type PolicyProvenance = LegalProvenance | UnverifiedProvenance;

export interface DocumentActionRuleFact {
  /** A DocumentTypeDescriptor.id (documents/descriptors/types.ts) — e.g. "invoice". Deliberately NOT
   *  validated against the live DocumentTypeRegistry here: the policy file and the descriptor
   *  registry are two independently-maintained sources, the same shape of risk the (removed) VAT
   *  rate catalog and tax-engine.ts used to carry between them. */
  typeId: string;
  /** A DocumentActionDescriptor.id declared on that type — e.g. "send". */
  actionId: string;
  /** Whether this country permits the action. `false` is a genuine, sourced PROHIBITION — not the
   *  same thing as the action simply being absent from this file's `rules` (which also refuses it,
   *  but as "not yet declared" rather than "forbidden"; see country-policy.ts's
   *  evaluateCountryPolicy for the distinction the two refusal messages make). */
  allowed: boolean;
  provenance: PolicyProvenance;
  /**
   * Narrows an ALLOWED rule to specific document STATUSES (the type's own `DocumentTypeDescriptor`
   * lifecycle statuses — descriptors/lifecycle.ts) — e.g. a country permitting "invoice.save-draft"
   * only while the record is still "draft". Absent (or empty) means every status the TYPE's own
   * lifecycle allows the action to run at in the first place — no narrowing beyond what the
   * descriptor already declares, the same "absent = no extra restriction" convention `notes` below
   * already follows for a different fact.
   *
   * Meaningless, and IGNORED, when `allowed: false` — a forbidden action is already forbidden at
   * every status; there is nothing left to narrow. Declared flat, beside `allowed`, rather than
   * nested inside an "allowed-branch-only" shape, to keep this fact as plain as `notes` is.
   *
   * This is still a LEGAL/product claim about what the country's own rule covers, same as `allowed`
   * itself — it needs the same `provenance` this whole rule already carries, never a second one of
   * its own: a rule saying "allowed, but only from these statuses" is one fact, not two.
   */
  statuses?: string[];
  /** Free-form caveats — same convention as the (removed) VAT rate catalog's own VatRateFact.notes. */
  notes?: string;
}

export interface CountryDocumentPolicyFile {
  /** ISO 3166-1 alpha-2, uppercase — must match the file's own name (data/all.ts checks this). */
  countryCode: string;
  /**
   * Which document TYPES this country's Documents sidebar group shows at all — a NEW, separate
   * layer from `rules` below: `rules` says which ACTIONS a type already assumed to exist may run;
   * this says which types exist for this country in the first place. Not a legal claim (which is why
   * it carries no provenance, unlike a rule) — it is a product decision about what to show, the same
   * category of fact `DocumentTypeDescriptor.label` already is.
   *
   * Optional on this TYPE — some test fixtures (seed.spec.ts) build a bare `{ countryCode, rules }`
   * to exercise `rules`-only machinery and should not have to grow one just to keep compiling — but
   * data/all.ts's LOADER requires it non-empty for every SHIPPED file: a country file that declares
   * zero types would mean "this country has a policy file but nothing to show", which is never the
   * intended state (see country-policy.ts's own "no permissive fallback, no silent gap" discipline)
   * — a country with genuinely nothing to declare should have NO file at all, exactly like it has
   * none for `rules`.
   */
  documentTypes?: string[];
  rules: DocumentActionRuleFact[];
  /**
   * Whether this country requires a document TYPE to carry a sequential, legally-issued number  -
   * issue #471's own concern, and DELIBERATELY separate from `rules` above: `rules` says which
   * ACTIONS a type may run, this says whether the type must be NUMBERED once it is issued, a
   * different axis a country-action rule has no natural field for (a "sequential-number-required"
   * fact is not "is this action allowed", it is "what must this document carry"). File-only today  -
   * no DB mirror, no migration: `seed.ts` VALIDATES every entry the same way `rules` are (same
   * `assertValidProvenance` gate - see this file's own header) but never writes it anywhere, since
   * nothing outside the descriptor layer (`documents/descriptors/*.descriptor.ts`) reads country
   * numbering requirements at runtime today - the descriptor's own `numbering` field is what a
   * document type ACTUALLY gets numbered by; this array only documents, per country and with
   * provenance, WHY that descriptor choice is (or is not) legally required. Optional: a country with
   * nothing to say here (the original state, before issue #471) simply omits the field.
   */
  numbering?: DocumentNumberingFact[];
  /**
   * Issue #496 - the ONE document number format this country uses for each numbered document type,
   * and every rule (statute, e-invoicing format, clearance platform) that constrains what such a
   * number may look like. The owner's decision (2026-09-27): a number format is a compliance matter,
   * not a preference, so it is defined here, per (country, document type), with the same provenance
   * discipline as every other fact in this file - and never by the company. File-only, like
   * `numbering` above: read at request time from the in-memory catalog
   * (`registry.ts#numberFormatsFor`), never mirrored into a table. Validated by
   * `number-formats.ts#assertValidNumberFormats` at the same two points every other fact here is.
   */
  numberFormats?: CountryNumberFormats;
  /**
   * Issue #558 - whether this country requires an invoice to be issued in its OWN official currency
   * when BOTH the seller and the buyer are established there (a purely domestic operation) - Algeria's
   * own Banque d'Algerie reglement n. 07-01, art. 5, is the first sourced example
   * (`data/dz.json`). Deliberately a per-country, OPTIONAL fact, not a new top-level catalog: most
   * shipped countries (DE/FR/IT/PL/PT today) have no such obligation sourced and simply omit this
   * field - absence here means "no domestic-currency rule found", never "foreign currency forbidden"
   * by omission (the same "no permissive fallback, no invented block" discipline every other fact in
   * this file already holds). File-only, like `numberFormats` above: read at request time from the
   * in-memory catalog (`registry.ts#domesticInvoiceCurrencyFor`), never mirrored into a table, and
   * enforced at "send" by `domestic-currency-issuance.ts#runDomesticInvoiceCurrencyPreflight`, see
   * that file's own header for how "domestic" is decided (mirrors
   * `transports/channel-policy/mandate.ts`'s own `isDomestic`, the established precedent for exactly
   * this seller/buyer-country comparison).
   */
  domesticInvoiceCurrency?: DomesticInvoiceCurrencyFact;
  /**
   * Issue #581 (owner's decision, 2026-10-01, after PR #602's own review) - whether VALIDATING an
   * invoice in this country must itself transmit it through the country's own mandated channel,
   * rather than only numbering and locking it. Deliberately an EXPLICIT per-country fact, never
   * inferred from whether `transports/channel-policy/data/<cc>.json` happens to declare an active
   * mandate: the two questions are related but not the same one - a country could plausibly mandate a
   * channel for ordinary SENDING while still allowing VALIDATE to stop at numbering-and-locking (the
   * channel mandate alone says nothing about what "Validate" specifically must do), so inferring one
   * from the other would have been encoding a legal conclusion nobody actually read a text for. See
   * `invoice-validation-transmission.ts`'s own header for how this combines with the ACTIVE mandate
   * check (`channel-policy/mandate.ts`) at runtime: BOTH conditions must hold - this fact says the
   * country's law treats validation-without-transmission as not genuinely "issued" at all, the active
   * mandate check says THIS operation (today's date, this buyer) is actually bound by it.
   *
   * File-only, like `domesticInvoiceCurrency` above: read at request time from the in-memory catalog
   * (`registry.ts#invoiceValidationFor`), never mirrored into a table, enforced at "validate" by
   * `invoice-validation-transmission.ts#resolveInvoiceValidationTransmission`. Optional: a country with
   * no such fact declared (DE/PL/PT/DZ today) simply omits the field, meaning "Validate" always only
   * numbers and locks there, however this question might one day be answered for any one operation.
   */
  invoiceValidation?: InvoiceValidationFact;
  /** Free-form, file-level caveats — e.g. "this file deliberately does not cover X" — distinct from
   *  a per-rule `notes`, which explains ONE rule. */
  notes?: string;
}

/**
 * ONE country's answer to "does Validate itself transmit the invoice" - see
 * `CountryDocumentPolicyFile.invoiceValidation`'s own header for the full design and why this is
 * deliberately separate from the channel-mandate catalog.
 */
export interface InvoiceValidationFact {
  /** `true`: once an operation is ALSO covered by this country's own active channel mandate
   *  (`channel-policy/mandate.ts#activeChannelMandateForOperation`), validating performs the real
   *  transmission through that channel - see `invoice-validation-transmission.ts`. `false` (the same
   *  as omitting the whole fact) would be a pointless, always-inert entry; this field only exists to
   *  be `true` - declaring it `false` is refused at load time, the same "do not encode a fact that
   *  changes nothing" discipline this catalog already holds for other always-true-or-absent flags. */
  transmitsThroughMandatedChannel: true;
  /**
   * Plain-English name of the channel this transmits through once the condition above fires - e.g.
   * "the accredited platform (PDP)" for France, "SdI" for Italy. Shown verbatim in the Validate
   * confirmation dialog's own transmission alert (document-form.tsx) - plain data, not an i18n key,
   * the same convention `DocumentTypeDescriptor.label`/`DocumentActionDescriptor.label` already hold.
   * Required whenever `transmitsThroughMandatedChannel` is `true`: a warning that something will be
   * transmitted "somewhere" unnamed would be worse than not showing one at all.
   */
  channelLabel: string;
  provenance: PolicyProvenance;
  notes?: string;
}

/**
 * ONE country's domestic-invoicing-currency obligation - see `CountryDocumentPolicyFile
 * .domesticInvoiceCurrency`'s own header for the full "why" and for why this is deliberately NOT a
 * boolean or a bare string: the currency itself is the fact, and it needs the same provenance every
 * other legal claim in this catalog already carries.
 */
export interface DomesticInvoiceCurrencyFact {
  /** ISO 4217 code, e.g. "DZD" - the country's own official currency, mandatory for an invoice whose
   *  seller AND buyer are both established in this country. Never a company preference: like
   *  `numberFormats` above, this is a compliance matter the country file states once, not something a
   *  company configures for itself. */
  currency: string;
  provenance: PolicyProvenance;
  notes?: string;
}

/**
 * ONE country's numbering requirement for ONE document type - issue #471. Two possible
 * `requirement`s, deliberately not a boolean: `'sequential-number-required'` says the type itself
 * must carry a continuous, sequential number once issued (what CGI ann. II art. 242 nonies A, I, 7°
 * asks of a French credit note, `country-policy/data/fr.json`'s own fact); `'type-not-issuable'`
 * says the question does not even arise for this type in this country because the type itself has
 * no legal existence here (Poland's own credit-note fact: a Polish credit note IS an invoice, a KOR,
 * numbered by the invoice's own numbering - see `correction-routes/data/pl.json`'s CREDIT_NOTE
 * `'forbidden'` route, which this fact deliberately does not duplicate, only cross-references).
 */
export interface DocumentNumberingFact {
  /** A DocumentTypeDescriptor.id - e.g. "credit-note". Same "not validated against the live
   *  registry here" posture as `DocumentActionRuleFact.typeId` above, for the identical reason. */
  typeId: string;
  /** `'atcud-required'` (issue #497): the type must carry Portugal's ATCUD once numbered. Unlike the
   *  other two, this one IS read at runtime, indirectly: `numbering/atcud.ts#SAFT_PT_DOCUMENT_TYPE_BY_TYPE_ID`
   *  is the set of types `actions/atcud-issuance.ts` produces an ATCUD for, and `data/numbering.spec.ts`
   *  fails if that set and the PT facts carrying this requirement ever differ. */
  requirement: 'sequential-number-required' | 'type-not-issuable' | 'atcud-required';
  provenance: PolicyProvenance;
  notes?: string;
}

/**
 * One rule that constrains the SHAPE of a document number in a country - a statute ("a unique,
 * continuous sequence"), an e-invoicing format ("at most 20 Basic Latin characters"), or a clearance
 * platform's own business rule. Every limit field is optional: a statutory rule often constrains the
 * sequence without constraining a single character, and says so in `summary` alone.
 */
export interface NumberFormatConstraintFact {
  /** Unique within its file - what `DocumentNumberFormatFact.constrainedBy` refers to. */
  id: string;
  /** The document type ids this rule binds (e.g. ["invoice", "credit-note"]). */
  appliesTo: string[];
  /** Plain English, one or two sentences - shown verbatim on the settings screen as "why". */
  summary: string;
  /** The longest number this rule accepts, in characters. */
  maxLength?: number;
  /** The body of a regular-expression character class every character must belong to - e.g.
   *  "A-Za-z0-9 +_/-" for the French platforms' rule G1.05. */
  allowedCharacters?: string;
  /** The number must contain at least one digit (SdI check 00425). */
  requiresDigit?: boolean;
  /** No space at the start or the end, and never two in a row (French rule G1.05). */
  forbidsEdgeOrDoubleSpaces?: boolean;
  /** A regular expression the WHOLE number must match - e.g. SAF-T (PT)'s `InvoiceNo` pattern. */
  mustMatch?: string;
  provenance: PolicyProvenance;
  notes?: string;
}

/** The one number format of one document type in one country - see `CountryNumberFormats`. */
export interface DocumentNumberFormatFact {
  /** A DocumentTypeDescriptor.id that declares `numbering` - e.g. "credit-note". */
  typeId: string;
  /** A `numbering/format-number.ts` pattern - `{year}`, `{month}`, `{day}`, `{number}`/`{number:N}`. */
  pattern: string;
  /** The ids of every `constraints` entry binding this type. Empty only with `unconstrained`. */
  constrainedBy: string[];
  /** Required when `constrainedBy` is empty: says, plainly, that no source read constrains the
   *  shape of this number in this country, and what was checked to say so. */
  unconstrained?: string;
  /** Why THIS pattern, among all those the constraints allow - a product decision, stated. */
  rationale: string;
  /**
   * Issue #515 - whether this type's counter may restart at 1 on every 1 January, in this country.
   * `'yearly'` only when a primary source, read first-hand, was found to actually PERMIT a
   * year-bounded numbering series (never inferred from silence - the same "no permissive fallback"
   * discipline every other fact in this catalog holds); `'never'` otherwise, including for a type no
   * source constrains at all (an unconstrained type carries no legal numbering-continuity obligation
   * either way, so there is nothing to read a permission FROM - it stays `'never'`, the safe
   * default, and says so in `resetProvenance`). `numbering/company-number-format.ts#periodKeyFor` is
   * the only reader: a `'yearly'` format keys its counter by the document's own issue year, a
   * `'never'` one keeps the single continuous counter every type used before this feature.
   *
   * A `'yearly'` format whose `pattern` carries no `{year}` token refuses to load
   * (`number-formats.ts#assertValidNumberFormats`): two different years would otherwise render the
   * identical number, defeating the one thing a restart exists to make visible.
   */
  reset: 'yearly' | 'never';
  /** Why THIS reset rule - sourced INDEPENDENTLY of `rationale` above, which explains the pattern's
   *  shape (its tokens, its length), never whether its counter may restart. Shown on the settings
   *  screen next to the format, the same convention every other provenance in this catalog follows. */
  resetProvenance: PolicyProvenance;
}

/**
 * What happens to a company that already issued numbers of a type under another format before
 * issue #496 (a custom one, or the old shared default), in this country. Continuity of an issued
 * series is a legal obligation everywhere this catalog covers, so the rule is the same shape in every
 * country - the running series is kept - and only its justification is per country.
 */
export interface RunningSeriesPolicy {
  /** Plain English, shown on the settings screen next to a kept running series. */
  summary: string;
  provenance: PolicyProvenance;
  /** What happens when the running series itself breaks one of this country's constraints. */
  onViolation: string;
  notes?: string;
}

export interface CountryNumberFormats {
  constraints: NumberFormatConstraintFact[];
  formats: DocumentNumberFormatFact[];
  runningSeries: RunningSeriesPolicy;
}

export class InvalidPolicyProvenanceError extends Error {}

/**
 * The one gate a rule cannot get past without a real provenance — see this file's header for why it
 * is called from two independent places rather than trusted to only ever run once.
 */
export function assertValidProvenance(rule: DocumentActionRuleFact, context: string): void {
  assertValidPolicyProvenance(
    rule.provenance,
    `${context}: rule "${rule.typeId}.${rule.actionId}"`,
    'a document-action rule',
  );
}

/**
 * The `numbering` (issue #471) analogue of `assertValidProvenance` above - same gate, called from the
 * same two independent points (data/all.ts at load, seed.ts before writing), on `DocumentNumberingFact`
 * instead of `DocumentActionRuleFact`: a numbering fact has no `actionId` to name in its error message
 * (it is not an action rule), which is the one reason this is a second, thin function rather than
 * widening `assertValidProvenance`'s own signature to accept either shape.
 */
export function assertValidNumberingProvenance(fact: DocumentNumberingFact, context: string): void {
  assertValidPolicyProvenance(
    fact.provenance,
    `${context}: numbering fact "${fact.typeId}"`,
    'a numbering fact',
  );
}

export class InvalidDomesticInvoiceCurrencyError extends Error {}

/**
 * The `domesticInvoiceCurrency` (issue #558) analogue of `assertValidProvenance` above - same
 * provenance gate, called from the same load-time point (data/all.ts) every other fact here already
 * is, plus the one extra check this fact needs and the others don't: a real 3-letter ISO 4217 code,
 * never a blank or placeholder string a downstream currency lookup would fail on silently.
 */
export function assertValidDomesticInvoiceCurrencyFact(
  fact: DomesticInvoiceCurrencyFact,
  context: string,
): void {
  if (fact.currency?.trim()?.length !== 3) {
    throw new InvalidDomesticInvoiceCurrencyError(
      `${context}: "domesticInvoiceCurrency.currency" must be a real 3-letter ISO 4217 code, got ` +
        `${JSON.stringify(fact.currency)}.`,
    );
  }
  assertValidPolicyProvenance(
    fact.provenance,
    `${context}: domestic-invoice-currency fact`,
    'a domestic-invoice-currency fact',
  );
}

export class InvalidInvoiceValidationFactError extends Error {}

/**
 * The `invoiceValidation` (issue #581, owner's decision 2026-10-01) analogue of
 * `assertValidDomesticInvoiceCurrencyFact` above - same provenance gate, plus the two checks this
 * fact needs and the others do not: `transmitsThroughMandatedChannel` must be the literal `true` (a
 * country file declaring it `false` is encoding a no-op as if it were a real fact - omitting the
 * whole field already means exactly that), and `channelLabel` must be a real, non-blank name (a
 * warning that something transmits "somewhere" unnamed is worse than no warning).
 */
export function assertValidInvoiceValidationFact(fact: InvoiceValidationFact, context: string): void {
  if ((fact as { transmitsThroughMandatedChannel?: unknown }).transmitsThroughMandatedChannel !== true) {
    throw new InvalidInvoiceValidationFactError(
      `${context}: "invoiceValidation.transmitsThroughMandatedChannel" must be the literal ` +
        `true - omit the whole "invoiceValidation" field instead of declaring it false.`,
    );
  }
  if (!fact.channelLabel?.trim()) {
    throw new InvalidInvoiceValidationFactError(
      `${context}: "invoiceValidation.channelLabel" must be a real, non-blank channel name.`,
    );
  }
  assertValidPolicyProvenance(
    fact.provenance,
    `${context}: invoice-validation fact`,
    'an invoice-validation fact',
  );
}

/** The actual check, shared by both provenance gates above - see each one's own header for why there
 *  are two thin callers rather than one function with two possible input shapes. */
export function assertValidPolicyProvenance(
  provenance: PolicyProvenance | null | undefined,
  factLabel: string,
  kindLabel: string,
): void {
  const candidate = provenance as { kind?: unknown } | null | undefined;
  if (!candidate || (candidate.kind !== 'legal' && candidate.kind !== 'unverified')) {
    throw new InvalidPolicyProvenanceError(
      `${factLabel} has no valid provenance (kind must be "legal" or "unverified") - ${kindLabel} may ` +
        'never exist without saying where it came from.',
    );
  }

  if (candidate.kind === 'legal') {
    const legal = provenance as LegalProvenance;
    if (!legal.sourceText?.trim() || !legal.sourceCheckedAt?.trim()) {
      throw new InvalidPolicyProvenanceError(
        `${factLabel} claims "legal" provenance but is missing sourceText and/or sourceCheckedAt.`,
      );
    }
    return;
  }

  const unverified = provenance as UnverifiedProvenance;
  if (!unverified.resolutionNote?.trim()) {
    throw new InvalidPolicyProvenanceError(
      `${factLabel} is "unverified" but has no resolutionNote - an unverified fact must say what ` +
        'would settle it.',
    );
  }
}
