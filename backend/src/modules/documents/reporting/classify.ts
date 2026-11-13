/**
 * The ONE pure classifier every declarative-reporting trigger asks before it enqueues a job: does
 * this obligation cover this operation, and can that be established without guessing?
 *
 * It is deliberately pure and synchronous: the caller (`operation-context.ts`) reads the company,
 * the client, the lines and the company profile once, and this file only compares them against the
 * country data. That keeps every decision testable against the real country files with no database,
 * exactly the discipline `transports/channel-policy/mandate.ts` already holds for the seller-side
 * channel mandate.
 *
 * Three verdicts, never two:
 * - `in`: the obligation covers this operation, the trigger may enqueue.
 * - `out`: the law does not cover it (a B2B invoice against a B2C fact, a payment on a
 *   goods-only invoice, an operation before its own start date). Nothing is sent, and nothing is
 *   journaled: an absence of obligation is not a blocked declaration.
 * - `undetermined`: the facts needed to answer are missing (no client type, no buyer country, no
 *   company size category). The caller journals `report:blocked` with this reason and sends nothing.
 *   A guess here would either declare an operation the law excludes or hide a real obligation.
 */
import { PartyType } from '../country-identifiers/schema';
import { ReportingObligation } from './obligation-v2';
import { ReportingObligationFact, ReportingScopeEntry } from './schema';

export type LineNature = 'goods' | 'service';

export interface DeclarationOperation {
  /** Which declaration this operation asks about. A payment trigger must never re-fire the
   *  invoice-data fact, and a send trigger must never fire a payment fact. */
  kind: 'invoice' | 'payment';
  sellerCountryCode?: string;
  /** `Client.type` in this codebase's own vocabulary, undefined when the document has no client. */
  buyerType?: PartyType;
  buyerCountryCode?: string;
  /** ISO date-only (`yyyy-mm-dd`) of the document; an obligation's window is judged on it. */
  documentIssueDate: string;
  /** The seller's resolved company profile, derived values included. */
  companyProfile: Record<string, string>;
  /** True when the company has NOT opted for VAT on debits (the default for a French company). */
  vatOnCollection: boolean;
  /**
   * The nature of each invoice line. `undefined` when at least one line cannot be classified (no
   * article, or an article this company no longer owns): a payment declaration then stays
   * undetermined rather than treating a possibly-service line as goods.
   */
  lineNatures?: LineNature[];
  /** Present only for a payment declaration. */
  payment?: { amountMinor: number; paidAt: string };
}

export type DeclarationVerdict =
  | { status: 'in'; scope: ReportingScopeEntry | 'all' }
  | { status: 'out'; reason: string }
  | { status: 'undetermined'; reason: string };

function matchesProfileCondition(
  conditions: Record<string, string[]>,
  profile: Record<string, string>,
): { matches: boolean; missing?: string } {
  for (const [key, values] of Object.entries(conditions)) {
    const declared = profile[key];
    if (declared === undefined || declared.trim() === '') return { matches: false, missing: key };
    if (!values.includes(declared)) return { matches: false };
  }
  return { matches: true };
}

function establishmentOf(operation: DeclarationOperation): 'domestic' | 'foreign' | undefined {
  if (!operation.sellerCountryCode || !operation.buyerCountryCode) return undefined;
  return operation.sellerCountryCode.toUpperCase() === operation.buyerCountryCode.toUpperCase()
    ? 'domestic'
    : 'foreign';
}

/**
 * Why a fact cannot fire: the seller's own exemption (CGI art. 261 to 261 E carve these operations
 * out of art. 290's B2C data set) and, for payments, the option for VAT on debits (art. 290 A only
 * targets VAT exigible on collection). Checked before the scope entries so an exempt operation never
 * needs a buyer type to be classified as out.
 */
function outBecauseOfSellerRegime(
  scopeEntries: ReportingScopeEntry[] | undefined,
  operation: DeclarationOperation,
): string | undefined {
  const regime = operation.companyProfile?.vatRegime;
  if (regime === 'FRANCHISE') {
    return (
      'The company is under the VAT franchise (franchise en base): operations exempt under CGI ' +
      'art. 261 to 261 E are outside the e-reporting set.'
    );
  }
  for (const entry of scopeEntries ?? []) {
    if (entry.transactions === 'payments' && entry.vatOnCollection === true && !operation.vatOnCollection) {
      return (
        'The company opted for VAT on debits: payment data only covers VAT due on collection ' +
        '(CGI art. 290 A).'
      );
    }
  }
  return undefined;
}

function scopeMatches(entry: ReportingScopeEntry, operation: DeclarationOperation): DeclarationVerdict {
  if (entry.transactions === 'payments' && operation.kind !== 'payment') {
    return { status: 'out', reason: 'This fact covers payment data, not the invoice itself.' };
  }
  if (entry.transactions !== 'payments' && operation.kind === 'payment') {
    return { status: 'out', reason: 'This fact covers invoice data, not payment data.' };
  }

  if (!operation.buyerType) {
    return {
      status: 'undetermined',
      reason: 'The client has no type recorded, so the operation cannot be classified as B2C or B2B.',
    };
  }

  const establishment = establishmentOf(operation);
  if (entry.buyerEstablishment !== undefined && establishment === undefined) {
    return {
      status: 'undetermined',
      reason:
        'The buyer country cannot be resolved, so the operation cannot be classified as domestic or foreign.',
    };
  }

  if (entry.buyerType && !entry.buyerType.includes(operation.buyerType)) {
    return {
      status: 'out',
      reason: `The buyer is ${operation.buyerType}, which this obligation does not cover.`,
    };
  }
  if (entry.buyerEstablishment !== undefined && entry.buyerEstablishment !== establishment) {
    return { status: 'out', reason: 'The buyer establishment does not match this obligation.' };
  }

  switch (entry.transactions) {
    case 'b2c':
      if (operation.buyerType !== 'INDIVIDUAL') {
        return { status: 'out', reason: 'B2C data covers private buyers only.' };
      }
      break;
    case 'b2b-domestic':
      if (operation.buyerType !== 'COMPANY') {
        return { status: 'out', reason: 'Domestic B2B data covers business buyers only.' };
      }
      if (establishment === undefined || establishment === 'foreign') {
        return { status: 'out', reason: 'The buyer is established outside the seller country.' };
      }
      break;
    case 'international':
      if (operation.buyerType !== 'COMPANY') {
        return { status: 'out', reason: 'International B2B data covers business buyers only.' };
      }
      if (establishment === undefined || establishment === 'domestic') {
        return { status: 'out', reason: 'The buyer is established in the seller country.' };
      }
      break;
    case 'payments':
      if (!operation.payment) {
        return { status: 'out', reason: 'This fact covers payment data, not the invoice itself.' };
      }
      if (operation.buyerType !== 'INDIVIDUAL') {
        return { status: 'out', reason: 'This payment fact covers private buyers only.' };
      }
      if (entry.vatOnCollection === true && !operation.vatOnCollection) {
        return { status: 'out', reason: 'VAT is not due on collection for this company.' };
      }
      if (operation.lineNatures === undefined) {
        return {
          status: 'undetermined',
          reason:
            'At least one invoice line has no article, so it cannot be classified as goods or services.',
        };
      }
      if (!operation.lineNatures.includes('service')) {
        return {
          status: 'out',
          reason: 'Payment data covers services only, and this invoice is goods-only.',
        };
      }
      break;
  }

  return { status: 'in', scope: entry };
}

/**
 * What the classifier reads of an obligation, whichever shape it comes from: the legacy fact and the
 * v2 obligation (issue #767) both reduce to this, so there is one decision procedure and never two
 * that could drift apart.
 */
interface ClassifiableRule {
  scope?: ReportingScopeEntry[];
  windows?: { from: string; until?: string; companyProfile?: Record<string, string[]> }[];
  sellerConditions?: Record<string, string[]>;
}

/**
 * The legacy entry point. Returns the FIRST matching scope entry (file order), the same "first match
 * wins, never merged" convention `channel-policy/mandate.ts` already holds.
 *
 * `applicableFrom` is deliberately not read here, exactly as before v2: no shipped fact carries one,
 * and `upgradeLegacyFacts` turns it into an applicability window that `classifyObligation` does judge.
 */
export function classifyDeclaration(
  fact: ReportingObligationFact,
  operation: DeclarationOperation | undefined,
): DeclarationVerdict {
  return classifyRule(
    {
      scope: fact.scope,
      windows: fact.applicability?.map((window) => ({
        from: window.from.date,
        companyProfile: window.when?.companyProfile,
      })),
    },
    operation,
  );
}

/**
 * The v2 entry point (issue #767): the same verdict `classifyDeclaration` gives the legacy fact an
 * obligation was upgraded from (`classify.spec.ts` pins it on every shipped fact), plus what only v2
 * can say: a window's `until` day and the obligation's own `sellerConditions`. It does not look at the
 * obligation's `trigger` or channels: choosing which obligations a trigger asks about is the caller's job.
 */
export function classifyObligation(
  obligation: ReportingObligation,
  operation: DeclarationOperation | undefined,
): DeclarationVerdict {
  return classifyRule(
    {
      scope: obligation.scope.transactions,
      windows: obligation.applicability?.map((window) => ({
        from: window.from,
        until: window.until,
        companyProfile: window.when?.companyProfile,
      })),
      sellerConditions: obligation.sellerConditions?.companyProfile,
    },
    operation,
  );
}

function classifyRule(
  rule: ClassifiableRule,
  operation: DeclarationOperation | undefined,
): DeclarationVerdict {
  // The legacy shape  -  one unscoped, provider-discharged fact that covers every document of its type
  // (Portugal today)  -  needs no operation facts at all. Short-circuited first so that path never
  // reads the database and its behaviour stays byte-for-byte what it was before the classifier.
  if (!rule.scope && !rule.windows && !rule.sellerConditions) {
    return { status: 'in', scope: 'all' };
  }

  if (!operation) {
    return {
      status: 'undetermined',
      reason: 'The operation could not be read, so this obligation cannot be classified.',
    };
  }

  const regimeReason = outBecauseOfSellerRegime(rule.scope, operation);
  if (regimeReason) return { status: 'out', reason: regimeReason };

  // Scope before applicability: an operation this fact does not cover is out even when the seller's
  // profile is incomplete, so a B2B invoice never journals a blocked B2C declaration for a missing
  // size category.
  let scope: ReportingScopeEntry | 'all' = 'all';
  if (rule.scope && rule.scope.length > 0) {
    let matched: ReportingScopeEntry | undefined;
    for (const entry of rule.scope) {
      const verdict = scopeMatches(entry, operation);
      if (verdict.status === 'in') {
        matched = entry;
        break;
      }
      if (verdict.status === 'undetermined') return verdict;
    }
    if (!matched) return { status: 'out', reason: 'No scope entry covers this operation.' };
    scope = matched;
  }

  // v2 only (no legacy fact has one): a condition on the seller that holds for the whole obligation,
  // judged after the scope for the same reason as the windows below.
  if (rule.sellerConditions) {
    const matched = matchesProfileCondition(rule.sellerConditions, operation.companyProfile ?? {});
    if (matched.missing) {
      return {
        status: 'undetermined',
        reason: `The company has not declared "${matched.missing}", which decides whether this obligation applies.`,
      };
    }
    if (!matched.matches)
      return { status: 'out', reason: "The company does not meet this obligation's conditions." };
  }

  if (rule.windows && rule.windows.length > 0) {
    let sawMissing: string | undefined;
    let matchingWindow: (typeof rule.windows)[number] | undefined;

    for (const window of rule.windows) {
      const conditions = window.companyProfile;
      if (!conditions) {
        matchingWindow = window;
        break;
      }
      const matched = matchesProfileCondition(conditions, operation.companyProfile ?? {});
      if (matched.missing) {
        sawMissing = sawMissing ?? matched.missing;
        continue;
      }
      if (matched.matches) {
        matchingWindow = window;
        break;
      }
    }

    if (!matchingWindow) {
      if (sawMissing) {
        return {
          status: 'undetermined',
          reason: `The company has not declared "${sawMissing}", which decides when this obligation starts.`,
        };
      }
      return { status: 'out', reason: 'No applicability window matches this company.' };
    }

    if (operation.documentIssueDate < matchingWindow.from) {
      return {
        status: 'out',
        reason: `This obligation starts on ${matchingWindow.from} for this company.`,
      };
    }
    // `until` is exclusive (`obligation-v2.ts`), the same convention as every dated window in v2.
    if (matchingWindow.until !== undefined && operation.documentIssueDate >= matchingWindow.until) {
      return {
        status: 'out',
        reason: `This obligation ended on ${matchingWindow.until} for this company.`,
      };
    }
  }

  return { status: 'in', scope };
}
