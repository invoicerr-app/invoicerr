import { BankLineForMatching, MatchCandidateInvoice, suggestMatches } from './matching';

function candidate(overrides: Partial<MatchCandidateInvoice> = {}): MatchCandidateInvoice {
  return {
    documentId: 'inv-1',
    displayNumber: 'INV-2026-0001',
    clientLabel: 'ACME SARL',
    currency: 'EUR',
    outstandingMinor: 120000,
    issueDate: '2026-08-01',
    dueDate: '2026-08-31',
    ...overrides,
  };
}

function line(overrides: Partial<BankLineForMatching> = {}): BankLineForMatching {
  return {
    amountMinor: 120000,
    currency: 'EUR',
    date: new Date('2026-08-15T00:00:00.000Z'),
    label: 'VIR CLIENT',
    reference: null,
    ...overrides,
  };
}

describe('suggestMatches — amount alone is never enough', () => {
  it('two invoices for the same amount, neither dated nor referenced: NEITHER is suggested', () => {
    const candidates = [
      candidate({ documentId: 'inv-1', displayNumber: 'INV-1', issueDate: null, dueDate: null }),
      candidate({ documentId: 'inv-2', displayNumber: 'INV-2', issueDate: null, dueDate: null }),
    ];
    expect(suggestMatches(line(), candidates)).toEqual([]);
  });

  it('a matching amount in a DIFFERENT currency is never suggested — no FX guess', () => {
    const candidates = [candidate({ currency: 'USD' })];
    expect(suggestMatches(line({ currency: 'EUR' }), candidates)).toEqual([]);
  });

  it('a close-but-not-exact amount is never suggested — no fuzzy/partial match', () => {
    const candidates = [candidate({ outstandingMinor: 120001 })];
    expect(suggestMatches(line({ amountMinor: 120000 }), candidates)).toEqual([]);
  });

  it('a debit (money-out) line is never a matching candidate, even if the amount lines up', () => {
    const candidates = [candidate({ outstandingMinor: 4590 })];
    expect(suggestMatches(line({ amountMinor: -4590 }), candidates)).toEqual([]);
  });
});

describe('suggestMatches — the two qualifying signals', () => {
  it('the invoice number appearing in the label qualifies a match', () => {
    const candidates = [candidate({ displayNumber: 'INV-2026-0001', issueDate: null, dueDate: null })];
    const result = suggestMatches(line({ label: 'VIR FACTURE INV-2026-0001' }), candidates);
    expect(result).toHaveLength(1);
    expect(result[0].reasons).toEqual(['reference']);
  });

  it('the invoice number appearing in a separate structured reference also qualifies', () => {
    const candidates = [candidate({ displayNumber: 'INV-42', issueDate: null, dueDate: null })];
    const result = suggestMatches(line({ label: 'Wire transfer', reference: 'INV-42' }), candidates);
    expect(result[0].reasons).toEqual(['reference']);
  });

  it('reference matching is alphanumeric-only and case-insensitive', () => {
    const candidates = [candidate({ displayNumber: 'INV-2026/0001', issueDate: null, dueDate: null })];
    const result = suggestMatches(line({ label: 'paiement inv20260001 merci' }), candidates);
    expect(result).toHaveLength(1);
  });

  it('a date within the window (anchored on dueDate) qualifies, with no reference at all', () => {
    const candidates = [
      candidate({ displayNumber: 'INV-1', issueDate: '2026-08-01', dueDate: '2026-08-31' }),
    ];
    const result = suggestMatches(line({ date: new Date('2026-09-20T00:00:00.000Z') }), candidates);
    expect(result).toHaveLength(1);
    expect(result[0].reasons).toEqual(['date-window']);
  });

  it('a date more than 90 days after the due date is OUT of the window', () => {
    const candidates = [
      candidate({ displayNumber: 'INV-1', issueDate: '2026-08-01', dueDate: '2026-08-31' }),
    ];
    const result = suggestMatches(line({ date: new Date('2026-12-15T00:00:00.000Z') }), candidates);
    expect(result).toEqual([]);
  });

  it('a date up to 30 days BEFORE issueDate qualifies (an advance payment)', () => {
    const candidates = [
      candidate({ displayNumber: 'INV-1', issueDate: '2026-08-15', dueDate: '2026-09-15' }),
    ];
    const result = suggestMatches(line({ date: new Date('2026-07-20T00:00:00.000Z') }), candidates);
    expect(result).toHaveLength(1);
  });

  it('more than 30 days before issueDate is OUT of the window', () => {
    const candidates = [
      candidate({ displayNumber: 'INV-1', issueDate: '2026-08-15', dueDate: '2026-09-15' }),
    ];
    const result = suggestMatches(line({ date: new Date('2026-07-01T00:00:00.000Z') }), candidates);
    expect(result).toEqual([]);
  });
});

describe('suggestMatches — several qualifying candidates is the ORDINARY case', () => {
  it('returns every qualifying candidate, reference-matches ranked first', () => {
    const dateOnly = candidate({
      documentId: 'inv-date',
      displayNumber: 'INV-OTHER',
      issueDate: '2026-08-01',
      dueDate: '2026-08-31',
    });
    const referenceMatch = candidate({
      documentId: 'inv-ref',
      displayNumber: 'INV-2026-0001',
      issueDate: null,
      dueDate: null,
    });
    const result = suggestMatches(line({ label: 'Réf INV-2026-0001', date: new Date('2026-08-15') }), [
      dateOnly,
      referenceMatch,
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].documentId).toBe('inv-ref');
    expect(result[1].documentId).toBe('inv-date');
  });

  it('a line matching nothing returns an empty array, not an error', () => {
    expect(suggestMatches(line({ amountMinor: 999 }), [candidate()])).toEqual([]);
  });
});
