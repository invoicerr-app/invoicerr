import {
  AtcudFormatIncompatibleError,
  ATCUD_MIN_VALIDATION_CODE_LENGTH,
  computeAtcud,
  InvalidAtcudSequentialNumberError,
  InvalidAtcudValidationCodeError,
  parseAtcudPattern,
  renderAtcudSeriesId,
  splitAtcudDisplayNumber,
} from './atcud';

describe('computeAtcud — the pure ATCUD string, and its two failure paths', () => {
  it('joins the validation code and the sequential number with exactly one hyphen, prefixed "ATCUD:"', () => {
    expect(computeAtcud('JCVPTS0J', '1')).toBe('ATCUD:JCVPTS0J-1');
  });

  it('passes a zero-padded sequential number through EXACTLY as given — never reformatted', () => {
    expect(computeAtcud('JCVPTS0J', '0007')).toBe('ATCUD:JCVPTS0J-0007');
  });

  it(`accepts a validation code of exactly the legal minimum (${ATCUD_MIN_VALIDATION_CODE_LENGTH} characters)`, () => {
    const code = 'A'.repeat(ATCUD_MIN_VALIDATION_CODE_LENGTH);
    expect(computeAtcud(code, '1')).toBe(`ATCUD:${code}-1`);
  });

  // FAILURE PATH 1/2 — Portaria n.º 195/2020, art. 3.º n.º 1 ("comprimento mínimo de oito (8) carateres").
  it('throws InvalidAtcudValidationCodeError for a validation code shorter than the legal minimum', () => {
    const tooShort = 'A'.repeat(ATCUD_MIN_VALIDATION_CODE_LENGTH - 1);
    expect(() => computeAtcud(tooShort, '1')).toThrow(InvalidAtcudValidationCodeError);
    expect(() => computeAtcud(tooShort, '1')).toThrow(/minimum of 8/);
  });

  it('throws for an empty validation code', () => {
    expect(() => computeAtcud('', '1')).toThrow(InvalidAtcudValidationCodeError);
  });

  // FAILURE PATH 2/2 — art. 3.º n.º 3 ("a sequência de caracteres numéricos").
  it('throws InvalidAtcudSequentialNumberError for a non-digit sequential number', () => {
    const code = 'A'.repeat(ATCUD_MIN_VALIDATION_CODE_LENGTH);
    expect(() => computeAtcud(code, '12a')).toThrow(InvalidAtcudSequentialNumberError);
  });

  it('throws for an empty sequential number', () => {
    const code = 'A'.repeat(ATCUD_MIN_VALIDATION_CODE_LENGTH);
    expect(() => computeAtcud(code, '')).toThrow(InvalidAtcudSequentialNumberError);
  });

  it('throws for a sequential number carrying a sign or separator', () => {
    const code = 'A'.repeat(ATCUD_MIN_VALIDATION_CODE_LENGTH);
    expect(() => computeAtcud(code, '-1')).toThrow(InvalidAtcudSequentialNumberError);
    expect(() => computeAtcud(code, '1,000')).toThrow(InvalidAtcudSequentialNumberError);
  });
});

describe('parseAtcudPattern — which company number-formats can lawfully produce an ATCUD', () => {
  it('accepts a pattern ending in a literal "/" immediately followed by "{number}"', () => {
    expect(parseAtcudPattern('FT {year}/{number}')).toEqual({ seriesTemplate: 'FT {year}' });
  });

  it('accepts "{number:N}" padding the same way', () => {
    expect(parseAtcudPattern('FT-A/{number:4}')).toEqual({ seriesTemplate: 'FT-A' });
  });

  it('accepts a series template with no date token at all — a fixed series id', () => {
    expect(parseAtcudPattern('INVOICES/{number:6}')).toEqual({ seriesTemplate: 'INVOICES' });
  });

  it('accepts a series template that itself contains a literal "/"', () => {
    expect(parseAtcudPattern('PT/FT {year}/{number:4}')).toEqual({ seriesTemplate: 'PT/FT {year}' });
  });

  // This product's own SHIPPED DEFAULT (numbering/format-number.ts#defaultNumberFormatFor) — proving
  // a Portuguese company cannot issue on the out-of-the-box format without reconfiguring it first.
  it('rejects this product\'s own default pattern — it has no "/" at all', () => {
    expect(parseAtcudPattern('INVOICE-{year}-{number:4}')).toBeUndefined();
  });

  it('rejects a pattern with no "{number}" token next to the "/" at all', () => {
    expect(parseAtcudPattern('FT-{year}/{month}')).toBeUndefined();
  });

  it('rejects a pattern where "{number}" is not the LAST thing in the pattern', () => {
    expect(parseAtcudPattern('FT/{number:4}-DRAFT')).toBeUndefined();
  });

  it('rejects a pattern where "{number}" comes before the "/" instead of after', () => {
    expect(parseAtcudPattern('{number:4}/{year}')).toBeUndefined();
  });

  it('rejects an empty series identifier (a bare "/{number}")', () => {
    expect(parseAtcudPattern('/{number:4}')).toBeUndefined();
  });

  it('rejects a series template carrying a SECOND "{number}" token of its own — ambiguous', () => {
    expect(parseAtcudPattern('FT-{number:2}/{number:4}')).toBeUndefined();
  });

  it('rejects a pattern with more than one "/" both immediately before a number-shaped token', () => {
    // Only the LAST "/" is ever a candidate separator — a "/" that is not immediately followed by the
    // final "{number...}" token is just an ordinary literal character in the series template.
    expect(parseAtcudPattern('FT//{number:4}')).toEqual({ seriesTemplate: 'FT/' });
  });
});

describe('renderAtcudSeriesId — rendering a series template against a real date', () => {
  it('substitutes {year}/{month}/{day} the same way formatDocumentNumber does', () => {
    const date = new Date(2026, 8, 13); // 2026-09-13 (JS months are 0-based)
    expect(renderAtcudSeriesId('FT {year}', date)).toBe('FT 2026');
    expect(renderAtcudSeriesId('FT {year}-{month:2}', date)).toBe('FT 2026-09');
    expect(renderAtcudSeriesId('FT {year}-{month:2}-{day:2}', date)).toBe('FT 2026-09-13');
  });

  it('leaves a series template with no date token at all completely untouched', () => {
    expect(renderAtcudSeriesId('INVOICES', new Date(2026, 8, 13))).toBe('INVOICES');
  });

  it('throws for a token outside {year}/{month}/{day} — e.g. a stray "{number}" that slipped through', () => {
    expect(() => renderAtcudSeriesId('FT {number}', new Date())).toThrow(/only \{year\}/);
  });
});

describe('splitAtcudDisplayNumber — recovering series/sequential from an already-frozen displayNumber', () => {
  it('splits on the LAST "/", trusting the pattern that produced it', () => {
    expect(splitAtcudDisplayNumber('FT 2026/0007', 'FT {year}/{number:4}')).toEqual({
      seriesId: 'FT 2026',
      sequentialNumber: '0007',
    });
  });

  it('splits correctly even when the series id itself contains a literal "/"', () => {
    expect(splitAtcudDisplayNumber('PT/FT 2026/0001', 'PT/FT {year}/{number:4}')).toEqual({
      seriesId: 'PT/FT 2026',
      sequentialNumber: '0001',
    });
  });

  it('throws AtcudFormatIncompatibleError if the pattern is (no longer) ATCUD-compatible', () => {
    expect(() => splitAtcudDisplayNumber('INVOICE-2026-0007', 'INVOICE-{year}-{number:4}')).toThrow(
      AtcudFormatIncompatibleError,
    );
  });
});
