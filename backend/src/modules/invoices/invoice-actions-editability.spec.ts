/**
 * The edit flag and the country profile, which had never been introduced.
 *
 * `editInvoice` has always let a non-draft through when the profile says the document never
 * freezes — `invoices.service.ts` falls through for `immutableAfter === 'NEVER'`. The flag that
 * drives the button did not know: it read `isDraft` and nothing else. So a United States invoice
 * was editable through the API and frozen on the screen, and the profile's answer never arrived.
 *
 * Found by the country showcase, not by a unit test — which is the argument for the showcase.
 */
import { deriveInvoiceActions } from './invoices.helpers';

const issued = { status: 'ISSUED' as const };
const draft = { status: 'DRAFT' as const };

describe('deriveInvoiceActions — editability follows the country', () => {
  it('an issued invoice stays editable where the profile says NEVER (US, fallback)', () => {
    expect(deriveInvoiceActions(issued, null, 'CREDIT_NOTE', 'NEVER').edit).toBe(true);
  });

  it('and is frozen where the profile says ISSUE (France) or CLEARANCE (Italy, Poland)', () => {
    expect(deriveInvoiceActions(issued, null, 'CREDIT_NOTE', 'ISSUE').edit).toBe(false);
    expect(deriveInvoiceActions(issued, null, 'CREDIT_NOTE', 'CLEARANCE').edit).toBe(false);
  });

  it('an unknown immutability answer freezes it — absence is not permission', () => {
    // No plan resolved yet. Guessing "editable" here would let someone edit a document the country
    // may well have frozen, which is the expensive direction to be wrong in.
    expect(deriveInvoiceActions(issued, null).edit).toBe(false);
  });

  it('drafts stay editable everywhere, which is what the flag used to say on its own', () => {
    for (const rule of ['ISSUE', 'CLEARANCE', 'NEVER', undefined]) {
      expect(deriveInvoiceActions(draft, null, 'CREDIT_NOTE', rule).edit).toBe(true);
    }
  });

  it('a deposit is never editable, whatever the country says', () => {
    const deposit = { status: 'DRAFT' as const, kind: 'DEPOSIT' };
    expect(deriveInvoiceActions(deposit, null, 'CREDIT_NOTE', 'NEVER').edit).toBe(false);
  });

  it('a cancelled invoice is not offered an edit, even under NEVER', () => {
    // Deliberately stricter than the API, which permits any non-draft. A mismatch where the screen
    // offers less than the service is safe; the reverse is what produced this defect.
    expect(deriveInvoiceActions({ status: 'CANCELLED' }, null, 'CREDIT_NOTE', 'NEVER').edit).toBe(false);
  });
});
