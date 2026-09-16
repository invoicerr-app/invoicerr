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

/**
 * The document TYPE this obligation applies to — a `descriptors/types.ts` id. A UNION, not a bare
 * `string`, even though only `'invoice'` is ever populated today: a declaration obligation can
 * legally extend to correction documents too (modifying/cancelling invoices — NAV's own obligation
 * did, back when this codebase shipped a Hungarian provider), which this codebase models as a
 * SEPARATE document type (`'credit-note'`) that a future pass could add here with zero schema change,
 * exactly the extensibility `channel-policy/schema.ts`'s own `scope` field affords for a different
 * axis.
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
 * automate for it — the same reasoning `b2g-routing/data/pt.json` already applies to a transport id
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
   * A scoped fact is deliberately excluded from `registry.ts#obligationFor`'s auto-trigger: this
   * codebase has no per-invoice classifier for "is this buyer domestic/foreign, B2B or B2C" at send
   * time, so firing on every invoice would over-report (a B2B-domestic French invoice is already
   * covered by the transport row) — a scoped fact is DATA for the settings screen and future wiring,
   * never silently fired regardless of who the buyer actually is. Same "read by nothing yet,
   * deliberately" posture `domestic-reverse-charge/DESIGN.md` documents for its own catalog.
   */
  scope?: { transactions: ReportableTransactionScope }[];
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
   * could not be read in brut text (see `data/fr.json`'s own facts for why 289 bis/290/290 A's own
   * size-tiered rollout, fixed by a décret this environment could not reach past Légifrance/JORF's
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
function assertValidProvenance(
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
      if (!entry || !VALID_TRANSACTION_SCOPES.includes(entry.transactions)) {
        throw new InvalidReportingObligationProvenanceError(
          `${context}: fact "${fact.providerId}" has an unknown scope transaction category ` +
            `"${entry?.transactions}" (must be one of ${VALID_TRANSACTION_SCOPES.join(', ')}).`,
        );
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
