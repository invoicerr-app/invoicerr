import { parseBankStatementOfx } from './parse-ofx';

describe('parseBankStatementOfx — OFX 1.x (SGML, unclosed leaf tags)', () => {
  const sgml = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260815120000
<TRNAMT>1200.00
<FITID>2026081500001
<NAME>VIR CLIENT SARL
<MEMO>FACTURE INV-2026-0001
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260816
<TRNAMT>-45.90
<FITID>2026081600002
<MEMO>FRAIS
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;

  it('reads both transactions, MEMO preferred over NAME for the label', () => {
    const result = parseBankStatementOfx(sgml, 'EUR');
    expect(result.errors).toEqual([]);
    expect(result.lines).toHaveLength(2);

    expect(result.lines[0].amountMinor).toBe(120000);
    expect(result.lines[0].label).toBe('FACTURE INV-2026-0001');
    expect(result.lines[0].reference).toBe('2026081500001');
    // Time-of-day is ignored — only the calendar day matters.
    expect(result.lines[0].date.toISOString()).toBe('2026-08-15T00:00:00.000Z');

    expect(result.lines[1].amountMinor).toBe(-4590);
    expect(result.lines[1].date.toISOString()).toBe('2026-08-16T00:00:00.000Z');
  });
});

describe('parseBankStatementOfx — OFX 2.x (real, closed XML tags)', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>CREDIT</TRNTYPE>
<DTPOSTED>20260901</DTPOSTED>
<TRNAMT>500.00</TRNAMT>
<FITID>xml-1</FITID>
<NAME>Client XML</NAME>
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;

  it('falls back to NAME when MEMO is absent', () => {
    const result = parseBankStatementOfx(xml, 'EUR');
    expect(result.errors).toEqual([]);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].label).toBe('Client XML');
    expect(result.lines[0].amountMinor).toBe(50000);
  });
});

describe('parseBankStatementOfx — honest degrade', () => {
  it('names a transaction block missing TRNAMT, keeps parsing the rest', () => {
    const text = `<OFX><STMTTRN><DTPOSTED>20260101<NAME>No amount</STMTTRN><STMTTRN><DTPOSTED>20260102<TRNAMT>10.00<NAME>Fine</STMTTRN></OFX>`;
    const result = parseBankStatementOfx(text, 'EUR');
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].label).toBe('Fine');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^Transaction 1:/);
  });

  it('a file with no <STMTTRN> block at all parses to zero lines, zero errors', () => {
    expect(parseBankStatementOfx('<OFX></OFX>', 'EUR')).toEqual({ lines: [], errors: [] });
  });

  // Regression for the block extractor's own worst case: a `[\s\S]*?` lazy quantifier between two
  // literal tags, run through a global `.match()`, rescans to the end of the string for EVERY one of
  // many `<STMTTRN>` occurrences that never finds a closing tag — quadratic in the occurrence count.
  //
  // A fixed absolute-ms budget is a flaky proxy for that: a shared CI runner measured well over a
  // tight threshold here on the exact same code that comfortably clears it locally — machine noise,
  // not a regression. What's actually invariant across runners is GROWTH: quadrupling the occurrence
  // count should roughly quadruple linear work, never roughly SIXTEEN-fold it (the old regex's own
  // shape). So this times the same parse at two sizes and asserts the ratio instead of a raw number —
  // `factor * 3` is generous slack above the expected ~4× (linear) while still well under the ~16× a
  // real O(n²) regression would produce — and keeps a wide absolute cap purely as a hung-process filet.
  it('does not go quadratic on many <STMTTRN> opens with no closing tag anywhere', () => {
    const SMALL = 5_000;
    const LARGE = SMALL * 4;

    const start1 = performance.now();
    const resultSmall = parseBankStatementOfx('<STMTTRN>'.repeat(SMALL), 'EUR');
    const elapsedSmall = performance.now() - start1;

    const start2 = performance.now();
    const resultLarge = parseBankStatementOfx('<STMTTRN>'.repeat(LARGE), 'EUR');
    const elapsedLarge = performance.now() - start2;

    expect(resultSmall).toEqual({ lines: [], errors: [] });
    expect(resultLarge).toEqual({ lines: [], errors: [] });

    const factor = LARGE / SMALL;
    const absoluteCapMs = 2000; // filet against a genuinely hung process, not ordinary runner slowness.
    expect(elapsedLarge).toBeLessThan(absoluteCapMs);
    expect(elapsedLarge / Math.max(elapsedSmall, 1)).toBeLessThan(factor * 3);
  });
});
