/**
 * The country REPORTING-OBLIGATION file format — a NEW concept, not a rename of channel-policy
 * (`transports/channel-policy/schema.ts`). That mechanism answers "does this country force a
 * DELIVERY channel" (a TRANSPORT question — how the invoice physically reaches the buyer);
 * this one answers a completely different question: "does this country require the SELLER to
 * DECLARE the invoice's data to its own tax authority, after issuance, regardless of how the
 * invoice was delivered". Hungary (NAV Online Számla) and Greece (AADE myDATA) are the two shipped
 * examples: an invoice sent by plain e-mail (or PDP, or any other channel) still has to be reported
 * to NAV/myDATA in near-real-time — the delivery channel and the declarative obligation are
 * orthogonal facts about the same invoice, which is exactly why this lives in its own directory,
 * next to (never inside) `transports/channel-policy/`.
 *
 * Modeled directly on `transports/channel-policy/schema.ts` (same file shape: a per-country JSON
 * file, an array of `facts`, a `provenance` gate) because the RISK profile is identical — a wrongly
 * claimed obligation would either falsely force a company through a reporting flow it can ignore, or
 * (worse) let a genuinely-obligated company skip a country's legal reporting duty — so a fact here
 * carries the SAME `PolicyProvenance` (`country-policy/schema.ts`) two-shape discipline: `legal`
 * (a real citation) or `unverified` (named, with a resolution note), never asserted bare.
 *
 * Unlike `channel-policy/schema.ts`'s `requirement: 'suggested' | 'mandated'`, a reporting
 * obligation has no "advisory" tier: a row in a country's file IS the country's own reporting
 * mandate for that provider — the same "every row is inherently binding" posture
 * `b2g-routing/schema.ts` already holds for B2G routing rules, for the identical reason (there is no
 * such thing as an "optional" tax-authority declaration once a country actually requires one).
 *
 * ## `dischargedBy` / `scope` — added for France, without changing what Portugal already says
 *
 * The original shape (one `providerId` a fact fires on unconditionally) assumed every reporting
 * obligation looked like Hungary/Greece/Portugal: ONE seller-side declaration, covering every
 * invoice of a type, with nothing to say about WHICH invoices or WHO actually transmits. France's
 * own CGI broke both assumptions at once — art. 289 E puts the transmission duty on the PDP
 * TRANSPORT for B2B-domestic invoices (nothing for a "provider" to declare at all), while
 * art. 290/290 A impose a SEPARATE, periodic obligation on the seller itself, but only for B2C,
 * export/intra-EU, and payment data — never for the B2B-domestic slice the PDP already covers. Two
 * fields close that gap: `dischargedBy` (who/what actually carries the data to the authority) and
 * `scope` (which transaction categories a fact covers). Both are ADDITIVE: Portugal's own fact needs
 * only `dischargedBy: 'provider'` (its pre-existing, only-ever behaviour) and no `scope` at all,
 * because DL 198/2012 draws no category distinction — see `data/pt.json`'s own facts.
 */
import { PolicyProvenance } from '../country-policy/schema';
import { PartyType } from '../country-identifiers/schema';

/**
 * The document TYPE this obligation applies to — a `descriptors/types.ts` id. A UNION, not a bare
 * `string`: a declaration obligation can legally extend to correction documents too
 * (modifying/cancelling invoices: NAV's own obligation did, back when this codebase shipped a
 * Hungarian provider), which this codebase models as a SEPARATE document type (`'credit-note'`).
 * Portugal is the first country to populate it (issue #501, `data/pt.json`: Decreto-Lei n.º 198/2012
 * applies to "documentos retificativos de fatura" as well).
 */
export type ReportableDocumentType = 'invoice' | 'credit-note';

/**
 * How a fact is actually DISCHARGED — the axis this schema was missing until France's own CGI
 * forced the question (see `data/fr.json`'s own facts for the concrete case this exists for):
 *
 *   - `'provider'` — the pre-existing shape (Portugal, ex-HU/GR): the SELLER owes the declaration,
 *     independent of delivery. `providerId` names a `DeclarationProviderRegistry` id, resolved by
 *     `reporting-runner.ts` and auto-triggered by `registry.ts#obligationFor` at "sent" time.
 *   - `'transport'` — the invoice's own DELIVERY channel already carries the data to the authority
 *     as a legal side effect of sending it (France's PDP for a B2B-domestic invoice, CGI art. 289 E:
 *     the platform, not the company, transmits) — there is nothing for THIS mechanism to enqueue.
 *
 * A `'transport'`-discharged fact is still recorded here (never omitted) because this catalog's own
 * purpose is to make a country's declarative posture DATA-visible even when this app has nothing to
 * automate for it — the same reasoning `countries/data/pt.json (section "b2gRouting")` already applies to a transport id
 * (`"fe-ap"`) this app does not wire either.
 */
export type ReportingDischargeMethod = 'transport' | 'provider';

/**
 * The transaction category a fact scopes to. CGI art. 289 E (B2B domestic, discharged by the PDP
 * transport) vs. art. 290 (B2C / export / intra-EU, the seller's own periodic declaration) vs.
 * art. 290 A (payment data) are three LEGALLY DIFFERENT obligations about the same invoice — a bare
 * "this country reports invoices" row could never say that only SOME of a seller's invoices are
 * covered by a given fact. Deliberately four values, no `'all'` catch-all: a country whose law draws
 * no such distinction (Portugal's DL 198/2012, "os elementos das faturas emitidas", no category
 * carve-out anywhere in the text) simply omits `scope` — see `ReportingObligationFact.scope`'s own
 * doc for what an absent `scope` means.
 */
export type ReportableTransactionScope = 'b2b-domestic' | 'b2c' | 'international' | 'payments';

const VALID_TRANSACTION_SCOPES: ReportableTransactionScope[] = [
  'b2b-domestic',
  'b2c',
  'international',
  'payments',
];

const VALID_PARTY_TYPES: PartyType[] = ['COMPANY', 'INDIVIDUAL'];

/**
 * Which invoices one `scope` entry covers, beyond the transaction category itself. Reuses the
 * `PartyType` vocabulary `transports/channel-policy/schema.ts` introduced for the seller-side channel
 * mandate, so a country file says "private buyer" the same way in both catalogs.
 *
 * Every field is optional and absent means "no restriction on this axis". This is deliberately not a
 * second, richer classifier: the seller's own signalling status (an exempt operation, an option for
 * VAT on debits, a company size category) lives in `ReportingApplicabilityWindow` and in the
 * classifier's own inputs, never duplicated per scope entry.
 */
export interface ReportingScopeEntry {
  transactions: ReportableTransactionScope;
  /** Which buyer types the entry covers, e.g. `["INDIVIDUAL"]` for a B2C declaration. */
  buyerType?: PartyType[];
  /** Whether the buyer must be established in the seller's own country or elsewhere. */
  buyerEstablishment?: 'domestic' | 'foreign';
  /**
   * Payment scope only: `true` means the declaration covers operations whose VAT is due on
   * collection, so it must not fire when the company opted for VAT on debits. Absent means the
   * legal text draws no condition on this axis.
   */
  vatOnCollection?: boolean;
}

/**
 * One dated applicability window, optionally conditioned on the seller's own declared company
 * profile (the same `companyProfile` section `countries/data/*.json` defines). France's e-reporting
 * obligation starts on different dates for different company size categories, so a single
 * `applicableFrom` could not express it without a country literal in code.
 *
 * A window whose `when` names an attribute the company has not declared does not match by default:
 * the classifier answers "undetermined" and the declaration is journaled `report:blocked`, never
 * fired on a guess.
 */
export interface ReportingApplicabilityWindow {
  when?: { companyProfile?: Record<string, string[]> };
  from: { date: string; provenance: PolicyProvenance };
}

export interface ReportingObligationFact {
  /**
   * The id of whatever mechanism actually discharges this obligation — resolved against a
   * DIFFERENT registry depending on `dischargedBy`:
   *   - `dischargedBy: 'provider'`: a `reporting/declaration-provider.ts`
   *     `DeclarationProviderRegistry` id — e.g. "pt-at", "nav", "mydata".
   *   - `dischargedBy: 'transport'`: a `transports/transport-registry.ts` TRANSPORT id — e.g.
   *     "pdp".
   *
   * Reusing this ONE field for both, rather than adding a second `transportId` field, is deliberate:
   * `company/channels/channels.service.ts#reportingObligations` reads `fact.providerId` as a single
   * required scalar, and this task's own boundary was `documents/reporting/**` only — a second field
   * would have meant touching a consumer file outside it for no functional gain. The reinterpretation
   * is load-bearing in exactly ONE place: `list-declarations.ts#declarationProviderIds` filters to
   * `dischargedBy === 'provider'` before treating a fact's `providerId` as a `DocumentAuthorityEvent`
   * key — never conflating a transport's OWN conformity-poll `providerId` (PDP's poll events already
   * use `"pdp"`, see `conformity/pollers/`) with a genuine tax-authority declaration. Any NEW read of
   * `providerId` added later must apply the same filter, or risk the identical conflation.
   *
   * Deliberately NOT validated against either live registry here — the same "two independently
   * maintained sources" risk `channel-policy/schema.ts`'s own `providerId` already accepts.
   */
  providerId: string;
  appliesTo: ReportableDocumentType;
  dischargedBy: ReportingDischargeMethod;
  /**
   * Which transaction categories this fact covers. OPTIONAL, and deliberately so: ABSENT means the
   * underlying legal text draws no distinction at all — the obligation covers every transaction of
   * `appliesTo`'s document type, exactly the behaviour this catalog held before this field existed
   * (Portugal today). PRESENT means this is one of SEVERAL rows for the same country/type, each
   * covering a distinct slice of the law (France: one row per CGI article family).
   *
   * A scoped fact is resolved by `classify.ts` against the operation's own facts (buyer type, buyer
   * establishment, seller profile, VAT-on-collection option), never fired unconditionally: reading
   * only the country+document type would over-report a B2B-domestic French invoice that the PDP
   * transport row already covers.
   */
  scope?: ReportingScopeEntry[];
  /**
   * Dated windows for a fact whose start depends on the seller's own company profile (France's
   * size-tiered e-reporting calendar, CGI art. 290/290 A applied by loi n° 2022-1157 art. 26 III B).
   * ABSENT means the fact has no computable start date here  -  the behaviour every other shipped fact
   * holds, and `applicableFrom` remains the single-date form for a fact that needs no condition.
   * PRESENT means the classifier must find a matching window before the fact may fire.
   */
  applicability?: ReportingApplicabilityWindow[];

  /**
   * Free-form, human-read only — e.g. "periodic aggregate declaration, never triggered per invoice".
   * Never parsed by any scheduler: `reporting-runner.ts` is a ONE-SHOT, per-document job (see that
   * file's own header) — this catalog has no periodic/aggregate job mechanism at all yet. Recorded
   * here so a fact is honest about its own real-world mechanic even when nothing acts on it, rather
   * than silently implying a per-invoice trigger it cannot actually honor.
   */
  periodicity?: string;
  /**
   * When THIS specific fact starts applying — omitted, never guessed, when the calendar itself
   * could not be read in raw text (see `data/fr.json`'s own facts for why 289 bis/290/290 A's own
   * size-tiered rollout, fixed by a decree this environment could not reach past Légifrance/JORF's
   * own blocking, stays unset rather than asserted from secondary commentary). Carries its OWN
   * provenance, independent of the fact's own `provenance`: the underlying obligation can be `legal`
   * while its start date stays `unverified`, or vice versa.
   */
  applicableFrom?: { date: string; provenance: PolicyProvenance };
  provenance: PolicyProvenance;
  /** Free-form caveats — same convention as every sibling country-fact file's own `notes`. */
  notes?: string;
}

export interface CountryReportingObligationFile {
  /** ISO 3166-1 alpha-2, uppercase — must match the file's own name (data/all.ts checks this). */
  countryCode: string;
  facts: ReportingObligationFact[];
}

export class InvalidReportingObligationProvenanceError extends Error {}

/**
 * `PolicyProvenance`'s own two-shape discipline (`legal` needs a citation, `unverified` needs a
 * resolution note, nothing else is valid) — factored out so it can gate BOTH a fact's own
 * `provenance` and its optional `applicableFrom.provenance` identically, rather than duplicating the
 * same three checks twice inline.
 */
export function assertValidProvenance(
  provenance: PolicyProvenance | null | undefined,
  context: string,
  label: string,
): void {
  const p = provenance as { kind?: unknown } | null | undefined;
  if (!p || (p.kind !== 'legal' && p.kind !== 'unverified')) {
    throw new InvalidReportingObligationProvenanceError(
      `${context}: ${label} has no valid provenance (kind must be "legal" or "unverified") — a ` +
        'reporting obligation may never exist without saying where it came from.',
    );
  }
  if (p.kind === 'legal') {
    const legal = provenance as Extract<PolicyProvenance, { kind: 'legal' }>;
    if (!legal.sourceText?.trim() || !legal.sourceCheckedAt?.trim()) {
      throw new InvalidReportingObligationProvenanceError(
        `${context}: ${label} claims "legal" provenance but is missing sourceText and/or ` +
          'sourceCheckedAt.',
      );
    }
  } else {
    const unverified = provenance as Extract<PolicyProvenance, { kind: 'unverified' }>;
    if (!unverified.resolutionNote?.trim()) {
      throw new InvalidReportingObligationProvenanceError(
        `${context}: ${label} is "unverified" but has no resolutionNote — an unverified fact must ` +
          'say what would settle it.',
      );
    }
  }
}

/**
 * One `scope` entry's own rules, shared by the legacy fact validator below and the v2 obligation
 * validator (`obligation-v2.ts`) so both formats refuse the same entry with the same message.
 * `label` names the carrier in the message, e.g. `fact "pt-at"` or `obligation "pt-at:invoice"`.
 */
export function assertValidReportingScopeEntry(
  entry: ReportingScopeEntry,
  context: string,
  label: string,
): void {
  if (!entry || !VALID_TRANSACTION_SCOPES.includes(entry.transactions)) {
    throw new InvalidReportingObligationProvenanceError(
      `${context}: ${label} has an unknown scope transaction category ` +
        `"${entry?.transactions}" (must be one of ${VALID_TRANSACTION_SCOPES.join(', ')}).`,
    );
  }
  if (entry.buyerType !== undefined) {
    if (!Array.isArray(entry.buyerType) || entry.buyerType.length === 0) {
      throw new InvalidReportingObligationProvenanceError(
        `${context}: ${label} declares an empty "scope.buyerType" - omit it to ` +
          'leave the buyer type unrestricted.',
      );
    }
    const unknownType = entry.buyerType.find((type) => !VALID_PARTY_TYPES.includes(type));
    if (unknownType) {
      throw new InvalidReportingObligationProvenanceError(
        `${context}: ${label} declares an unknown "scope.buyerType" party type ` +
          `"${unknownType}" (must be one of ${VALID_PARTY_TYPES.join(', ')}).`,
      );
    }
  }
  if (
    entry.buyerEstablishment !== undefined &&
    entry.buyerEstablishment !== 'domestic' &&
    entry.buyerEstablishment !== 'foreign'
  ) {
    throw new InvalidReportingObligationProvenanceError(
      `${context}: ${label} has an unknown "scope.buyerEstablishment" ` +
        `"${String(entry.buyerEstablishment)}" (must be "domestic" or "foreign").`,
    );
  }
  if (entry.vatOnCollection !== undefined && typeof entry.vatOnCollection !== 'boolean') {
    throw new InvalidReportingObligationProvenanceError(
      `${context}: ${label} declares a non-boolean "scope.vatOnCollection".`,
    );
  }
}

/**
 * The one gate a fact cannot get past without a real provenance — called from two independent
 * places (`data/all.ts` when a file loads; this module's own specs), the same "never trust a single
 * call site" discipline `channel-policy/schema.ts`'s own `assertValidChannelPolicyFact` documents.
 */
export function assertValidReportingObligationFact(fact: ReportingObligationFact, context: string): void {
  if (!fact.providerId?.trim()) {
    throw new InvalidReportingObligationProvenanceError(
      `${context}: a reporting-obligation fact is missing its "providerId".`,
    );
  }
  if (fact.appliesTo !== 'invoice' && fact.appliesTo !== 'credit-note') {
    throw new InvalidReportingObligationProvenanceError(
      `${context}: fact "${fact.providerId}" has no valid "appliesTo" (must be "invoice" or ` +
        '"credit-note").',
    );
  }
  if (fact.dischargedBy !== 'transport' && fact.dischargedBy !== 'provider') {
    throw new InvalidReportingObligationProvenanceError(
      `${context}: fact "${fact.providerId}" has no valid "dischargedBy" (must be "transport" or ` +
        '"provider").',
    );
  }

  if (fact.scope !== undefined) {
    if (!Array.isArray(fact.scope) || fact.scope.length === 0) {
      throw new InvalidReportingObligationProvenanceError(
        `${context}: fact "${fact.providerId}" declares a "scope" that is not a non-empty array.`,
      );
    }
    for (const entry of fact.scope) {
      assertValidReportingScopeEntry(entry, context, `fact "${fact.providerId}"`);
    }
  }

  if (fact.applicability !== undefined) {
    if (!Array.isArray(fact.applicability) || fact.applicability.length === 0) {
      throw new InvalidReportingObligationProvenanceError(
        `${context}: fact "${fact.providerId}" declares an "applicability" that is not a non-empty array.`,
      );
    }
    for (const window of fact.applicability) {
      if (!window?.from?.date?.trim()) {
        throw new InvalidReportingObligationProvenanceError(
          `${context}: fact "${fact.providerId}" declares an applicability window with no "from.date".`,
        );
      }
      assertValidProvenance(
        window.from.provenance,
        context,
        `fact "${fact.providerId}"'s applicability window (${window.from.date})`,
      );
      const conditions = window.when?.companyProfile;
      if (conditions !== undefined) {
        if (typeof conditions !== 'object' || Array.isArray(conditions)) {
          throw new InvalidReportingObligationProvenanceError(
            `${context}: fact "${fact.providerId}" declares "when.companyProfile" that is not an object.`,
          );
        }
        for (const [key, values] of Object.entries(conditions)) {
          if (!key.trim() || !Array.isArray(values) || values.length === 0) {
            throw new InvalidReportingObligationProvenanceError(
              `${context}: fact "${fact.providerId}" declares an applicability condition ` +
                `"${key || '(empty)'}" with no non-empty value list.`,
            );
          }
        }
      }
    }
  }

  if (fact.applicableFrom !== undefined) {
    if (!fact.applicableFrom.date?.trim()) {
      throw new InvalidReportingObligationProvenanceError(
        `${context}: fact "${fact.providerId}" declares "applicableFrom" with no "date".`,
      );
    }
    assertValidProvenance(
      fact.applicableFrom.provenance,
      context,
      `fact "${fact.providerId}"'s applicableFrom`,
    );
  }

  assertValidProvenance(fact.provenance, context, `fact "${fact.providerId}"`);
}
