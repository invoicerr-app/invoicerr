import { CsvColumnMapping } from './csv-mapping';
import { detectCsvDelimiter, parseBankStatementCsv } from './parse-csv';

const FR_MAPPING: CsvColumnMapping = {
  dateColumn: 'Date',
  amountColumn: 'Montant',
  labelColumn: 'Libellé',
  dateFormat: 'DD/MM/YYYY',
  decimalSeparator: ',',
};

const US_MAPPING: CsvColumnMapping = {
  dateColumn: 'Date',
  amountColumn: 'Amount',
  labelColumn: 'Description',
  dateFormat: 'MM/DD/YYYY',
  decimalSeparator: '.',
};

describe('detectCsvDelimiter', () => {
  it('picks the delimiter the header row actually uses more often', () => {
    expect(detectCsvDelimiter('Date,Montant,Libellé')).toBe(',');
    expect(detectCsvDelimiter('Date;Montant;Libellé')).toBe(';');
  });
});

describe('parseBankStatementCsv — a French export (`;`, DD/MM/YYYY, comma decimal)', () => {
  const text = [
    'Date;Montant;Libellé',
    '15/08/2026;1200,00;VIR INV-2026-0001',
    '16/08/2026;-45,90;FRAIS TENUE COMPTE',
  ].join('\n');

  it('parses both lines, signed amounts kept as-is', () => {
    const result = parseBankStatementCsv(text, FR_MAPPING, 'EUR');
    expect(result.errors).toEqual([]);
    expect(result.lines).toHaveLength(2);

    expect(result.lines[0]).toMatchObject({
      amountMinor: 120000,
      label: 'VIR INV-2026-0001',
      reference: null,
    });
    expect(result.lines[0].date.toISOString()).toBe('2026-08-15T00:00:00.000Z');

    // A debit line (money OUT) is imported too, never dropped — see this module's own header.
    expect(result.lines[1].amountMinor).toBe(-4590);
  });

  it('handles a thousands-grouped amount ("1 234,56")', () => {
    const grouped = ['Date;Montant;Libellé', '01/01/2026;1 234,56;Test'].join('\n');
    const result = parseBankStatementCsv(grouped, FR_MAPPING, 'EUR');
    expect(result.errors).toEqual([]);
    expect(result.lines[0].amountMinor).toBe(123456);
  });

  it('honors an explicit reference column when mapped', () => {
    const withRef = ['Date;Montant;Libellé;Réf', '15/08/2026;1200,00;Virement;CHK-42'].join('\n');
    const result = parseBankStatementCsv(withRef, { ...FR_MAPPING, referenceColumn: 'Réf' }, 'EUR');
    expect(result.lines[0].reference).toBe('CHK-42');
  });

  it('splits a quoted field embedding the delimiter itself (RFC 4180)', () => {
    const quoted = ['Date;Montant;Libellé', '15/08/2026;1200,00;"Virement; réf INV-42"'].join('\n');
    const result = parseBankStatementCsv(quoted, FR_MAPPING, 'EUR');
    expect(result.errors).toEqual([]);
    expect(result.lines[0].label).toBe('Virement; réf INV-42');
  });
});

describe('parseBankStatementCsv — a US-style export (`,`, MM/DD/YYYY, period decimal)', () => {
  it('reads the SAME calendar day differently under a different dateFormat mapping', () => {
    const text = ['Date,Amount,Description', '08/15/2026,1200.00,Wire INV-1'].join('\n');
    const result = parseBankStatementCsv(text, US_MAPPING, 'USD');
    expect(result.errors).toEqual([]);
    expect(result.lines[0].date.toISOString()).toBe('2026-08-15T00:00:00.000Z');
    expect(result.lines[0].amountMinor).toBe(120000);
  });
});

describe('parseBankStatementCsv — honest, row-numbered degrade', () => {
  it('skips an unparseable row and names it, without failing the whole import', () => {
    const text = [
      'Date;Montant;Libellé',
      '15/08/2026;1200,00;Bon',
      'pas-une-date;100,00;Mauvaise ligne',
      '17/08/2026;abc;Montant invalide',
    ].join('\n');
    const result = parseBankStatementCsv(text, FR_MAPPING, 'EUR');
    expect(result.lines).toHaveLength(1);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toMatch(/^Row 3:/);
    expect(result.errors[1]).toMatch(/^Row 4:/);
  });

  it('throws when the mapping itself names a column absent from the header', () => {
    const text = ['Date;Montant;Libellé', '15/08/2026;1200,00;Bon'].join('\n');
    expect(() => parseBankStatementCsv(text, { ...FR_MAPPING, amountColumn: 'Nope' }, 'EUR')).toThrow(
      /"Nope"/,
    );
  });

  it('an empty file parses to zero lines, zero errors', () => {
    expect(parseBankStatementCsv('', FR_MAPPING, 'EUR')).toEqual({ lines: [], errors: [] });
  });
});
