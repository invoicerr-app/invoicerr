import { numberingDisplayState } from './display-state';

/**
 * PR #473 review point 3 - this table of cases is the canonical set: the frontend's own
 * `types.spec.ts` (frontend/src/components/documents/types.spec.ts) pins the IDENTICAL cases against
 * its own copy of the formula. A future edit that silently makes the two formulas disagree fails
 * exactly ONE of these two spec files, on whichever side changed - never a PDF a human has to notice
 * diverging from the screen days later.
 */
describe('numberingDisplayState', () => {
  it('is "numbered" whenever displayNumber is set, regardless of status', () => {
    expect(
      numberingDisplayState(
        { numbering: {}, initialStatus: 'draft' },
        { displayNumber: 'INV-2026-0001', status: 'sending' },
      ),
    ).toBe('numbered');
  });

  it('is "awaiting" for a plain draft (status === initialStatus), no `onlyFrom` declared', () => {
    expect(
      numberingDisplayState(
        { numbering: {}, initialStatus: 'draft' },
        { displayNumber: null, status: 'draft' },
      ),
    ).toBe('awaiting');
  });

  // THE EXACT BUG this PR's review point 3 closes: a quote/invoice (no `numbering.onlyFrom`) stuck in
  // "sending" without a number (PR #473 review point 1's own race, now closed) must show
  // "issuedWithoutNumber", never "awaiting" - `isNumberingAllowedFrom` (numbering/only-from.ts) would
  // have answered `true` here (no `onlyFrom` means "any status is allowed to number FROM"), which is
  // the wrong question for a DISPLAY decision.
  it('is "issuedWithoutNumber" for a numbered-type instance stuck in a NON-initial status with no number and no `onlyFrom` declared', () => {
    expect(
      numberingDisplayState(
        { numbering: {}, initialStatus: 'draft' },
        { displayNumber: null, status: 'sending' },
      ),
    ).toBe('issuedWithoutNumber');
  });

  it('is "awaiting" for a legacy credit note whose status is IN `numbering.onlyFrom`', () => {
    expect(
      numberingDisplayState(
        { numbering: { onlyFrom: ['draft'] }, initialStatus: 'draft' },
        { displayNumber: null, status: 'draft' },
      ),
    ).toBe('awaiting');
  });

  it('is "issuedWithoutNumber" for a legacy credit note whose status left `numbering.onlyFrom` (issued before #471, retried unnumbered)', () => {
    expect(
      numberingDisplayState(
        { numbering: { onlyFrom: ['draft'] }, initialStatus: 'draft' },
        { displayNumber: null, status: 'send_failed' },
      ),
    ).toBe('issuedWithoutNumber');
  });

  it('is "issuedWithoutNumber" for "sent" with no number and no `onlyFrom` - a document type numbered only after this record was issued', () => {
    expect(
      numberingDisplayState(
        { numbering: {}, initialStatus: 'draft' },
        { displayNumber: null, status: 'sent' },
      ),
    ).toBe('issuedWithoutNumber');
  });
});
