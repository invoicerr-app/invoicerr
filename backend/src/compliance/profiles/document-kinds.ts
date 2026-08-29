/**
 * Which document kinds a country's businesses use — derived first, declared only where it matters.
 *
 * The point of this file is that almost nothing here needed to be typed in per country. The profile
 * already fixes `correctionModel`, so the correction document is known for all 108 jurisdictions
 * without anyone declaring it: a country that corrects with a credit note offers `CREDIT_NOTE`, one
 * that corrects with a corrective invoice offers `CORRECTIVE_INVOICE`, and one that cancels and
 * replaces offers neither — it issues a fresh `INVOICE`. Writing that out 108 times would have
 * invited 108 chances to get one wrong.
 *
 * What is NOT derivable is whether a country permits a proforma, or regulates it. Nobody has
 * sourced that for a single jurisdiction, so it comes back `UNVERIFIED` with the question attached
 * rather than a confident `AVAILABLE` that no primary source supports.
 */
import { CountryComplianceProfile, DocumentKindRule } from './schema';
import { pickByDate } from './temporal';
import { CorrectionModel, DocumentKind } from '../types';
import { statusOf } from '../lifecycle/correction-routes';

/** The correction document each model produces. Mirrors `lifecycle/corrections.ts`, deliberately. */
const CORRECTION_KIND: Record<CorrectionModel, DocumentKind | null> = {
  CREDIT_NOTE: 'CREDIT_NOTE',
  CORRECTIVE_INVOICE: 'CORRECTIVE_INVOICE',
  // Cancel-and-replace produces no correction document of its own: the original is cancelled and a
  // fresh invoice takes its place. Offering a "credit note" here would name a document the country
  // does not use.
  CANCEL_AND_REPLACE: null,
};

/**
 * Kinds this product's pipeline treats as legal documents — numbered from the gapless series,
 * issued, transmitted, archived. Universal, because it describes the pipeline and not a country.
 *
 * `PROFORMA` is the one kind on the other side of the line, and the code already enforces it:
 * `invoices.helpers.ts` refuses to issue one, so it never takes a number. This makes that fact
 * legible to an interface instead of leaving it implicit in a guard.
 */
const LEGAL_KINDS: ReadonlySet<DocumentKind> = new Set<DocumentKind>([
  'INVOICE',
  'CREDIT_NOTE',
  'DEBIT_NOTE',
  'CORRECTIVE_INVOICE',
  'DEPOSIT',
  'FINAL',
]);

const PROFORMA_QUESTION =
  'Is a pro forma invoice permitted, regulated or meaningless in this jurisdiction, and may it ' +
  'carry the same numbering as a real invoice? Not sourced for any country.';

/**
 * The kinds to offer for a country at a date, each with what is known about it.
 *
 * Ordered legal-first so a caller rendering them in sequence gets the invoices before the
 * commercial documents without having to know which is which.
 */
export function documentKindsFor(profile: CountryComplianceProfile, at: Date): DocumentKindRule[] {
  // A profile that declares its own list wins outright — that is the escape hatch for the day
  // someone sources a country properly.
  const declared = profile.documentKinds?.length
    ? profile.documentKinds
        .filter((t) => new Date(t.validFrom) <= at && (!t.validTo || new Date(t.validTo) > at))
        .map((t) => t.value)
    : [];
  if (declared.length) return declared;

  const lifecycle = pickByDate(profile.lifecycle, at);

  const kinds: DocumentKind[] = ['INVOICE', 'DEPOSIT', 'FINAL'];

  // P3-T02: where the country's routes are sourced, they decide — a single `correctionModel` cannot.
  // Mexico is why this branch exists. Deriving from the enum alone made it CANCEL_AND_REPLACE and
  // therefore offered NO correction document at all, while the SAT calls the CFDI tipo E a nota de
  // crédito in so many words. A country can require cancel-and-replace for a wrong document AND keep
  // a credit note for wrong amounts, and Mexico does exactly that.
  //
  // Only the three document-PRODUCING routes are consulted. The others correct without producing
  // anything to offer in a menu: cancel-and-replace issues a fresh INVOICE (already listed), the
  // internal credit note never leaves, and ledger annotation writes no document at all.
  const routes = lifecycle?.correctionRoutes;
  if (routes?.length) {
    for (const kind of ['CREDIT_NOTE', 'DEBIT_NOTE', 'CORRECTIVE_INVOICE'] as const) {
      // The FIRST entry is the general rule; later ones are case carve-outs, and a menu describes
      // the general case (France offers a credit note, and forbids it only for an unpaid invoice).
      const status = statusOf(routes, kind);
      if (status === 'REQUIRED' || status === 'OPEN') kinds.push(kind);
    }
  } else {
    const correction = lifecycle ? CORRECTION_KIND[lifecycle.correctionModel] : 'CREDIT_NOTE';
    if (correction) kinds.push(correction);
  }

  const rules: DocumentKindRule[] = kinds.map((kind) => ({
    kind,
    legalDocument: true,
    // Derived from a rule the profile already carries, so it is as established as that rule is.
    availability: 'AVAILABLE',
  }));

  rules.push({
    kind: 'PROFORMA',
    legalDocument: false,
    availability: 'UNVERIFIED',
    openQuestion: PROFORMA_QUESTION,
  });

  return rules;
}
