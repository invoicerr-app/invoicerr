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
  fact: ReportingObligationFact,
  operation: DeclarationOperation,
): string | undefined {
  const regime = operation.companyProfile?.vatRegime;
  if (regime === 'FRANCHISE') {
    return (
      'The company is under the VAT franchise (franchise en base): operations exempt under CGI ' +
      'art. 261 to 261 E are outside the e-reporting set.'
    );
  }
  for (const entry of fact.scope ?? []) {
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
 * The one entry point. Returns the FIRST matching scope entry (file order), the same "first match
 * wins, never merged" convention `channel-policy/mandate.ts` already holds.
 */
export function classifyDeclaration(
  fact: ReportingObligationFact,
  operation: DeclarationOperation | undefined,
): DeclarationVerdict {
  // The legacy shape  -  one unscoped, provider-discharged fact that covers every document of its type
  // (Portugal today)  -  needs no operation facts at all. Short-circuited first so that path never
  // reads the database and its behaviour stays byte-for-byte what it was before the classifier.
  if (!fact.scope && !fact.applicability) {
    return { status: 'in', scope: 'all' };
  }

  if (!operation) {
    return {
      status: 'undetermined',
      reason: 'The operation could not be read, so this obligation cannot be classified.',
    };
  }

  const regimeReason = outBecauseOfSellerRegime(fact, operation);
  if (regimeReason) return { status: 'out', reason: regimeReason };

  if (fact.applicability && fact.applicability.length > 0) {
    let sawMissing: string | undefined;
    let matchingWindow: (typeof fact.applicability)[number] | undefined;

    for (const window of fact.applicability) {
      const conditions = window.when?.companyProfile;
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

    if (operation.documentIssueDate < matchingWindow.from.date) {
      return {
        status: 'out',
        reason: `This obligation starts on ${matchingWindow.from.date} for this company.`,
      };
    }
  }

  if (!fact.scope || fact.scope.length === 0) {
    return { status: 'in', scope: 'all' };
  }

  for (const entry of fact.scope) {
    const verdict = scopeMatches(entry, operation);
    if (verdict.status === 'in') return verdict;
    if (verdict.status === 'undetermined') return verdict;
  }

  return { status: 'out', reason: 'No scope entry covers this operation.' };
}
