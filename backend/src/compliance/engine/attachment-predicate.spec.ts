/**
 * P2-V02 — play the predicate against the six pivots on hand-built cases.
 *
 * Not an implementation: the predicate function and six sets of inputs. The point is to find out
 * whether the SHAPE survives before anything depends on it. Two questions were to be settled by
 * running it rather than by intuition:
 *
 *   - does EITHER_ATTACHED_TO give Italy the right verdict?
 *   - does Spain need two rules?
 *
 * Both are answered below, in the tests named after them.
 */
import {
  type AttachmentPredicate,
  type OperationNature,
  type OperationParties,
  evaluate,
  evaluateAll,
} from './attachment-predicate';

const parties = (supplier: string | null, buyer: string | null): OperationParties =>
  ({ supplier, buyer }) as OperationParties;

describe('France — art. 289 bis I: bilateral, and art. 289 bis V: an independent exclusion', () => {
  const bilateral: AttachmentPredicate = { kind: 'BOTH_ATTACHED_TO', country: 'FR' };
  const notIntraEu: AttachmentPredicate = { kind: 'NOT_OF_NATURE', nature: 'intraCommunitySupply' };
  /** The e-invoicing rule as the source actually states it: BOTH predicates, not one. */
  const eInvoicing = [bilateral, notIntraEu];

  it('FR->FR B2B domestic: e-invoicing applies', () => {
    expect(evaluateAll(eInvoicing, parties('FR', 'FR'))).toBe(true);
  });

  it('FR->IT B2B: excluded — and by BOTH routes independently', () => {
    const intraEu: OperationNature = { intraCommunitySupply: true };
    expect(evaluate(bilateral, parties('FR', 'IT'))).toBe(false);
    expect(evaluate(notIntraEu, parties('FR', 'FR'), intraEu)).toBe(false);
    expect(evaluateAll(eInvoicing, parties('FR', 'IT'), intraEu)).toBe(false);
  });

  /**
   * The case proving the second rule is not redundant. P2-V01: art. 289 bis V excludes operations
   * under art. 262 ter I 1° WHATEVER the parties' attachment. A predicate carrying only the
   * bilateral test answers "applies" here — wrongly — and would have given FR->IT the right answer
   * by accident.
   */
  it('an intra-EU supply between two FR-attached parties is still excluded — the bilateral test alone would say it applies', () => {
    const intraEu: OperationNature = { intraCommunitySupply: true };
    expect(evaluate(bilateral, parties('FR', 'FR'), intraEu)).toBe(true);
    expect(evaluateAll(eInvoicing, parties('FR', 'FR'), intraEu)).toBe(false);
  });

  it('FR->US B2B: excluded by the bilateral test; e-reporting is its complement', () => {
    expect(evaluateAll(eInvoicing, parties('FR', 'US'))).toBe(false);
    const eReporting: AttachmentPredicate[] = [
      { kind: 'SUPPLIER_ATTACHED_TO', country: 'FR' },
      { kind: 'NOT_BOTH_ATTACHED_TO', country: 'FR' },
    ];
    expect(evaluateAll(eReporting, parties('FR', 'US'))).toBe(true);
    expect(evaluateAll(eReporting, parties('FR', 'FR'))).toBe(false);
  });
});

describe('the five other pivots', () => {
  it('Germany — bilateral, like France', () => {
    const de: AttachmentPredicate = { kind: 'BOTH_ATTACHED_TO', country: 'DE' };
    expect(evaluate(de, parties('DE', 'DE'))).toBe(true);
    expect(evaluate(de, parties('DE', 'FR'))).toBe(false);
  });

  it('Poland — the seller suffices: a foreign buyer does not take the operation out of KSeF', () => {
    const pl: AttachmentPredicate = { kind: 'SUPPLIER_ATTACHED_TO', country: 'PL' };
    expect(evaluate(pl, parties('PL', 'PL'))).toBe(true);
    expect(evaluate(pl, parties('PL', 'DE'))).toBe(true);
    expect(evaluate(pl, parties('DE', 'PL'))).toBe(false);
  });

  /**
   * QUESTION 1, settled by running it. EITHER_ATTACHED_TO gives Italy the right verdict on the
   * three cases that matter — and the wrong shape would have been visible: a bilateral predicate
   * refuses IT->FR, which SdI does route.
   */
  it('Italy — EITHER is the right shape: a bilateral predicate would wrongly refuse IT->FR', () => {
    const either: AttachmentPredicate = { kind: 'EITHER_ATTACHED_TO', country: 'IT' };
    expect(evaluate(either, parties('IT', 'IT'))).toBe(true);
    expect(evaluate(either, parties('IT', 'FR'))).toBe(true);
    expect(evaluate(either, parties('FR', 'IT'))).toBe(true);
    expect(evaluate(either, parties('FR', 'DE'))).toBe(false);

    const bilateralIt: AttachmentPredicate = { kind: 'BOTH_ATTACHED_TO', country: 'IT' };
    expect(evaluate(bilateralIt, parties('IT', 'FR'))).toBe(false);
  });

  /**
   * QUESTION 2, settled by running it. Spain does NOT need two rules for the attachment itself —
   * one BUYER_ATTACHED_TO expresses the recipient-driven mandate. What Spain needs a second rule
   * for is the SII / Veri*Factu exclusivity (RD 1007/2023 art. 3.3), which is a regime choice and
   * not an attachment question. It does not belong in this type.
   */
  it('Spain — one attachment rule suffices; its second rule is a regime choice, not an attachment', () => {
    const es: AttachmentPredicate = { kind: 'BUYER_ATTACHED_TO', country: 'ES' };
    expect(evaluate(es, parties('FR', 'ES'))).toBe(true);
    expect(evaluate(es, parties('ES', 'FR'))).toBe(false);
    expect(evaluate(es, parties('ES', 'ES'))).toBe(true);
  });

  it('Mexico — the seller suffices, like Poland', () => {
    const mx: AttachmentPredicate = { kind: 'SUPPLIER_ATTACHED_TO', country: 'MX' };
    expect(evaluate(mx, parties('MX', 'US'))).toBe(true);
    expect(evaluate(mx, parties('US', 'MX'))).toBe(false);
  });
});

describe('an unresolved attachment is undecidable, never false', () => {
  it('BOTH with an unknown buyer cannot be decided', () => {
    expect(evaluate({ kind: 'BOTH_ATTACHED_TO', country: 'FR' }, parties('FR', null))).toBeNull();
  });

  it('EITHER already matched on the supplier is decidable despite an unknown buyer', () => {
    expect(evaluate({ kind: 'EITHER_ATTACHED_TO', country: 'IT' }, parties('IT', null))).toBe(true);
  });

  it('EITHER matching neither, with an unknown party, is undecidable — resolving it could flip', () => {
    expect(evaluate({ kind: 'EITHER_ATTACHED_TO', country: 'IT' }, parties('FR', null))).toBeNull();
  });

  it('a rule with one undecidable and one false predicate is FALSE — false is already conclusive', () => {
    const rule: AttachmentPredicate[] = [
      { kind: 'BOTH_ATTACHED_TO', country: 'FR' },
      { kind: 'SUPPLIER_ATTACHED_TO', country: 'DE' },
    ];
    expect(evaluateAll(rule, parties('FR', null))).toBe(false);
  });

  it('a rule with one undecidable and the rest true is UNDECIDABLE, not true', () => {
    const rule: AttachmentPredicate[] = [
      { kind: 'SUPPLIER_ATTACHED_TO', country: 'FR' },
      { kind: 'BOTH_ATTACHED_TO', country: 'FR' },
    ];
    expect(evaluateAll(rule, parties('FR', null))).toBeNull();
  });
});
