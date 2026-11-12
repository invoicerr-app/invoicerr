import type { Mock } from 'vitest';

import * as persistence from '../persistence';

/** Fixtures shared by the quote -> invoice action specs ("convert-to-invoice", "request-deposit",
 *  "request-installments"), which all mock persistence wholesale and drive the handler straight off
 *  a bare `ActionRegistry`. The calling spec owns the `vi.mock(...)` declarations. */

/** The acted-upon quote row every one of those specs starts from. */
export function mockQuote(overrides: {
  id?: string;
  displayNumber?: string | null;
  currency?: string;
  lines: Array<Record<string, unknown>>;
  notes?: string;
}) {
  (persistence.findOwnedDocument as Mock).mockResolvedValue({
    id: overrides.id ?? 'quote-1',
    typeId: 'quote',
    status: 'sent',
    number: 1,
    displayNumber: overrides.displayNumber ?? 'QUOTE-2026-0001',
    data: {
      client: 'client-1',
      issueDate: '2026-01-01',
      currency: overrides.currency ?? 'EUR',
      notes: overrides.notes,
      lines: overrides.lines,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

/** An invoice row as the #953 double-invoicing guard (actions/quote-invoicing-guard.ts) reads it:
 *  whatever a quote->invoice action persisted earlier, linked back through `origin`. */
export function raisedInvoiceRow(overrides: {
  id?: string;
  displayNumber?: string | null;
  data: Record<string, unknown>;
}) {
  return {
    id: overrides.id ?? 'invoice-1',
    typeId: 'invoice',
    status: 'draft',
    displayNumber: overrides.displayNumber ?? 'INV-2026-0001',
    data: overrides.data,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/** What `persistence.findInvoicesRaisedFromQuote` answers for this quote - i.e. what has ALREADY
 *  been invoiced from it before the action under test runs. */
export function mockInvoicesRaisedFromQuote(rows: unknown[]) {
  (persistence.findInvoicesRaisedFromQuote as Mock).mockResolvedValue(rows);
}

/** The ordinary case: nothing has been invoiced from this quote yet. */
export function mockNoInvoiceRaisedYet() {
  mockInvoicesRaisedFromQuote([]);
}
