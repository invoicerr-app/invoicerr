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
});
