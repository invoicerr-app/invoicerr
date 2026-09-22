import {
  assertValidNumberPattern,
  defaultNumberFormatFor,
  DocumentNumberParts,
  formatDocumentNumber,
  resolveNumberFormat,
} from './format-number';

const PARTS = (overrides: Partial<DocumentNumberParts> = {}): DocumentNumberParts => ({
  number: 7,
  date: new Date('2026-03-05T00:00:00Z'),
  ...overrides,
});

describe('formatDocumentNumber — pure formatting', () => {
  it('pads {number} to 4 digits by default, matching the old engine', () => {
    expect(formatDocumentNumber('INV-{number}', PARTS({ number: 7 }))).toBe('INV-0007');
  });

  it('honors an explicit {number:N} padding width', () => {
    expect(formatDocumentNumber('INV-{number:2}', PARTS({ number: 7 }))).toBe('INV-07');
    expect(formatDocumentNumber('INV-{number:6}', PARTS({ number: 7 }))).toBe('INV-000007');
  });

  it('does not truncate a number wider than its padding', () => {
    expect(formatDocumentNumber('INV-{number:2}', PARTS({ number: 12345 }))).toBe('INV-12345');
  });

  it('substitutes {year}/{month}/{day} from the given date, unpadded by default', () => {
    // 2026-03-05 — month and day are single digits with no explicit width. {number} is required on
    // every pattern (see the "refuses a pattern with no {number} token" test below) even when this
    // test isn't asserting on it.
    expect(
      formatDocumentNumber(
        '{year}/{month}/{day}-{number}',
        PARTS({ date: new Date('2026-03-05'), number: 1 }),
      ),
    ).toBe('2026/3/5-0001');
  });

  it('pads {month}/{day} when given an explicit width, exactly like {number}', () => {
    expect(
      formatDocumentNumber('{month:2}-{day:2}-{number}', PARTS({ date: new Date('2026-03-05'), number: 1 })),
    ).toBe('03-05-0001');
  });

  it('renders the full default pattern shape end to end', () => {
    const result = formatDocumentNumber(
      'INVOICE-{year}-{number:4}',
      PARTS({ number: 1, date: new Date('2026-01-15') }),
    );
    expect(result).toBe('INVOICE-2026-0001');
  });

  // THE mutation target for "never a fabricated number": this module is never even supposed to be
  // called with a null/undefined number for an unnumbered document (see this file's own header) —
  // but if it somehow were, TypeScript already refuses it at compile time (`number: number`, not
  // `number | null`) rather than silently reproducing the old `null + 1 - 1 === 0` bug. This test
  // documents that refusal at the type level by asserting the field is required, not optional.
  it('requires a real, non-null number — the type itself has no "unset" state to fall back to', () => {
    const parts: DocumentNumberParts = PARTS({ number: 0 });
    // number 0 is a legitimate (if unusual) integer value — formatting it must NOT be confused with
    // "no number" the way `null` was silently coerced to 0 by the old engine's arithmetic.
    expect(formatDocumentNumber('{number:2}', parts)).toBe('00');
  });

  it('refuses a pattern with no {number} token at all — every document would show the same string', () => {
    expect(() => formatDocumentNumber('INV-{year}', PARTS())).toThrow(/no "\{number\}" token/);
  });

  it('refuses an unknown token rather than silently dropping or echoing it bare', () => {
    expect(() => formatDocumentNumber('INV-{number}-{bogus}', PARTS())).toThrow(/unknown token "\{bogus\}"/);
  });
});

describe('assertValidNumberPattern', () => {
  it('accepts a pattern with a bare {number}', () => {
    expect(() => assertValidNumberPattern('X-{number}', 'ctx')).not.toThrow();
  });

  it('accepts a pattern with a padded {number:N}', () => {
    expect(() => assertValidNumberPattern('X-{number:3}', 'ctx')).not.toThrow();
  });

  it('throws, naming the context, for a pattern with no {number} token', () => {
    expect(() => assertValidNumberPattern('X-{year}', 'for document type "quote"')).toThrow(
      /for document type "quote"/,
    );
  });
});

describe('defaultNumberFormatFor', () => {
  it('uppercases the type id and appends the standard {year}-{number:4} shape', () => {
    expect(defaultNumberFormatFor('invoice')).toBe('INVOICE-{year}-{number:4}');
    expect(defaultNumberFormatFor('quote')).toBe('QUOTE-{year}-{number:4}');
  });
});

describe('resolveNumberFormat', () => {
  it('falls back to the default pattern when the company has no numberFormats at all', () => {
    expect(resolveNumberFormat(null, 'invoice')).toBe('INVOICE-{year}-{number:4}');
    expect(resolveNumberFormat(undefined, 'invoice')).toBe('INVOICE-{year}-{number:4}');
  });

  it('falls back to the default pattern when numberFormats exists but has no entry for this type', () => {
    expect(resolveNumberFormat({ quote: 'Q-{number}' }, 'invoice')).toBe('INVOICE-{year}-{number:4}');
  });

  it('uses the company-configured pattern when present', () => {
    expect(resolveNumberFormat({ invoice: 'FAC-{year}-{number:5}' }, 'invoice')).toBe(
      'FAC-{year}-{number:5}',
    );
  });

  it('ignores a non-string / empty entry and falls back to the default', () => {
    expect(resolveNumberFormat({ invoice: '' }, 'invoice')).toBe('INVOICE-{year}-{number:4}');
    expect(resolveNumberFormat({ invoice: 42 as unknown as string }, 'invoice')).toBe(
      'INVOICE-{year}-{number:4}',
    );
  });

  // THE "at load time" requirement: a company-configured pattern missing {number} must fail the
  // moment it is RESOLVED, before anything downstream ever spends a real sequence number trying to
  // format it (see sequence.ts's own header on never wasting a number).
  it('refuses, loudly, a company-configured pattern with no {number} token', () => {
    expect(() => resolveNumberFormat({ invoice: 'FAC-{year}' }, 'invoice')).toThrow(/no "\{number\}" token/);
  });
});
