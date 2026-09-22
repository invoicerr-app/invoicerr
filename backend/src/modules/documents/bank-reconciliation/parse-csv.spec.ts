import { CsvColumnMapping } from './csv-mapping';
import {
  detectCsvDelimiter,
  MAX_STATEMENT_LINE_LENGTH,
  MAX_STATEMENT_ROWS,
  parseBankStatementCsv,
} from './parse-csv';

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

  it('an out-of-range amount is a skipped ROW, never a failed import — the Int column cannot hold it', () => {
    // Without the bound this parses to a finite number, passes every check, and only fails at the
    // INSERT, outside the per-row try/catch — taking a whole good statement down with it.
    const result = parseBankStatementCsv(
      'Date;Montant;Libellé\n01/02/2026;99999999999,99;Huge\n02/02/2026;120,00;Fine\n',
      FR_MAPPING,
      'EUR',
    );
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].label).toBe('Fine');
    expect(result.errors.join(' ')).toMatch(/out of the range/);
  });
});

describe('parseBankStatementCsv — explicit row/line caps (the two loop bounds this file takes from the upload)', () => {
  it('throws — a whole-file fact — for a data-row count over MAX_STATEMENT_ROWS', () => {
    const header = 'Date;Montant;Libellé';
    const row = '15/08/2026;1,00;x';
    const text = [header, ...Array(MAX_STATEMENT_ROWS + 1).fill(row)].join('\n');

    expect(() => parseBankStatementCsv(text, FR_MAPPING, 'EUR')).toThrow(
      new RegExp(`${MAX_STATEMENT_ROWS}-row limit`),
    );
  });

  it('accepts a file at exactly MAX_STATEMENT_ROWS data rows — the cap is inclusive, not off-by-one', () => {
    const header = 'Date;Montant;Libellé';
    const row = '15/08/2026;1,00;x';
    const text = [header, ...Array(MAX_STATEMENT_ROWS).fill(row)].join('\n');

    const result = parseBankStatementCsv(text, FR_MAPPING, 'EUR');
    expect(result.lines).toHaveLength(MAX_STATEMENT_ROWS);
  });

  it('throws — a whole-file fact — for a header row over MAX_STATEMENT_LINE_LENGTH characters', () => {
    const hugeHeader = `Date;Montant;${'x'.repeat(MAX_STATEMENT_LINE_LENGTH)}`;
    const text = [hugeHeader, '15/08/2026;1,00;x'].join('\n');

    expect(() => parseBankStatementCsv(text, FR_MAPPING, 'EUR')).toThrow(
      new RegExp(`${MAX_STATEMENT_LINE_LENGTH}-character limit`),
    );
  });

  it('skips — a per-ROW fact — a single data line over MAX_STATEMENT_LINE_LENGTH characters, keeps the rest', () => {
    const hugeRow = `01/02/2026;1,00;${'x'.repeat(MAX_STATEMENT_LINE_LENGTH)}`;
    const text = ['Date;Montant;Libellé', hugeRow, '02/02/2026;2,00;Fine'].join('\n');

    const result = parseBankStatementCsv(text, FR_MAPPING, 'EUR');
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].label).toBe('Fine');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^Row 2:.*character limit/);
  });

  // Regression for the loop bound itself: `splitCsvLine`'s own per-character loop must never run on
  // more than MAX_STATEMENT_LINE_LENGTH characters, whatever the file contains — this is the actual
  // bound the huge-row cap above exists to put in place.
  //
  // A fixed absolute-ms budget doesn't actually prove that bound holds: it only proves "fast enough on
  // today's runner", which a shared CI box can miss on a noisy day despite the loop being correctly
  // bounded (a tight ms figure is what turned this suite flaky in the first place). What the bound
  // itself guarantees, independent of any one machine's speed, is COST PER ROW staying capped: quadruple
  // the row count and the total time should roughly quadruple (linear in row count), never grow far
  // past that. So this times the same parse at two row counts and checks the ratio — generous slack
  // above the expected ~4×, but well short of what an unbounded per-row cost (or a reintroduced
  // per-character regression) would produce — plus a wide absolute cap as a hung-process filet only.
  it('parses a file at the row/line caps without a runaway cost', () => {
    const header = 'Date;Montant;Libellé';
    const prefix = '15/08/2026;1,00;';
    const row = `${prefix}${'x'.repeat(MAX_STATEMENT_LINE_LENGTH - prefix.length)}`;
    const buildText = (rowCount: number) => [header, ...Array(rowCount).fill(row)].join('\n');

    const SMALL = 250;
    const LARGE = SMALL * 4;

    const start1 = performance.now();
    const resultSmall = parseBankStatementCsv(buildText(SMALL), FR_MAPPING, 'EUR');
    const elapsedSmall = performance.now() - start1;

    const start2 = performance.now();
    const resultLarge = parseBankStatementCsv(buildText(LARGE), FR_MAPPING, 'EUR');
    const elapsedLarge = performance.now() - start2;

    expect(resultSmall.lines).toHaveLength(SMALL);
    expect(resultLarge.lines).toHaveLength(LARGE);

    const factor = LARGE / SMALL;
    const absoluteCapMs = 2000; // filet against a genuinely hung process, not ordinary runner slowness.
    expect(elapsedLarge).toBeLessThan(absoluteCapMs);
    expect(elapsedLarge / Math.max(elapsedSmall, 1)).toBeLessThan(factor * 3);
  });
});
