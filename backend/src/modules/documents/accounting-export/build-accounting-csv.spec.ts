import { AccountingLedgerRow, buildAccountingCsv } from './build-accounting-csv';

/**
 * PURE — no mocking needed anywhere in this file (this module's own header). Every row below is a
 * plain fixture object; `buildAccountingCsv` never reaches Prisma or `@/utils/financial`.
 */

const HEADER = 'type,reference,date,client,currency,net,vat,gross,paid,method,status';

function invoiceRow(overrides: Partial<AccountingLedgerRow> = {}): AccountingLedgerRow {
  return {
    type: 'invoice',
    reference: 'INV-2026-0001',
    date: '2026-03-01',
    client: 'Acme Corp',
    currency: 'EUR',
    net: '100.00',
    vat: '20.00',
    gross: '120.00',
    paid: '',
    method: '',
    status: 'outstanding',
    ...overrides,
  };
}

function creditNoteRow(overrides: Partial<AccountingLedgerRow> = {}): AccountingLedgerRow {
  return {
    type: 'credit-note',
    reference: 'cn-1',
    date: '2026-03-05',
    client: 'Acme Corp',
    currency: 'EUR',
    net: '',
    vat: '',
    gross: '60.00',
    paid: '',
    method: '',
    status: 'settled',
    ...overrides,
  };
}

function paymentRow(overrides: Partial<AccountingLedgerRow> = {}): AccountingLedgerRow {
  return {
    type: 'payment',
    reference: 'INV-2026-0001',
    date: '2026-03-10',
    client: 'Acme Corp',
    currency: 'EUR',
    net: '',
    vat: '',
    gross: '',
    paid: '50.00',
    method: 'bank_transfer',
    status: '',
    ...overrides,
  };
}

describe('buildAccountingCsv', () => {
  it('a stable header row, even for zero rows — an empty period is a valid, header-only CSV', () => {
    expect(buildAccountingCsv([])).toBe(HEADER);
  });

  it('the header names exactly the eleven documented columns, in the documented order', () => {
    expect(HEADER.split(',')).toEqual([
      'type',
      'reference',
      'date',
      'client',
      'currency',
      'net',
      'vat',
      'gross',
      'paid',
      'method',
      'status',
    ]);
  });

  it('renders one plain line per row, comma-joined, in the same column order as the header', () => {
    const csv = buildAccountingCsv([invoiceRow()]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(HEADER);
    expect(lines[1]).toBe('invoice,INV-2026-0001,2026-03-01,Acme Corp,EUR,100.00,20.00,120.00,,,outstanding');
  });

  it('a field containing a comma is wrapped in double quotes', () => {
    const csv = buildAccountingCsv([invoiceRow({ client: 'Acme Corp, Ltd' })]);
    expect(csv.split('\n')[1]).toContain('"Acme Corp, Ltd"');
  });

  it('a field containing a double quote is wrapped in quotes, with the interior quote doubled', () => {
    const csv = buildAccountingCsv([invoiceRow({ client: 'The "Acme" Corp' })]);
    expect(csv.split('\n')[1]).toContain('"The ""Acme"" Corp"');
  });

  it('a field containing a line break is wrapped in quotes, and the embedded newline survives verbatim', () => {
    const csv = buildAccountingCsv([invoiceRow({ client: 'Acme\nCorp' })]);
    // The embedded \n must NOT be mistaken for a row separator — the whole quoted field, newline
    // included, is one CSV field, so a naive `.split("\n")` sees it as two physical lines.
    expect(csv).toContain('"Acme\nCorp"');
    const physicalLines = csv.split('\n');
    expect(physicalLines).toHaveLength(3); // header + the field's own embedded newline + the rest
  });

  it('a field with none of those characters is left bare — no quotes cluttering the common case', () => {
    const csv = buildAccountingCsv([invoiceRow()]);
    expect(csv.split('\n')[1]).not.toContain('"');
  });

  it('a mixed invoice/credit-note/payment set fills exactly the documented columns per type', () => {
    const csv = buildAccountingCsv([invoiceRow(), creditNoteRow(), paymentRow()]);
    const [, invoiceLine, creditLine, paymentLine] = csv.split('\n');

    // invoice: net/vat/gross filled, paid/method blank.
    expect(invoiceLine).toBe(
      'invoice,INV-2026-0001,2026-03-01,Acme Corp,EUR,100.00,20.00,120.00,,,outstanding',
    );

    // credit-note: gross filled (no independent net/vat), paid/method blank, always "settled".
    expect(creditLine).toBe('credit-note,cn-1,2026-03-05,Acme Corp,EUR,,,60.00,,,settled');

    // payment: paid/method filled, net/vat/gross AND status all blank.
    expect(paymentLine).toBe('payment,INV-2026-0001,2026-03-10,Acme Corp,EUR,,,,50.00,bank_transfer,');
  });
});
