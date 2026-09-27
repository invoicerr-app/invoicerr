import { vi, type Mock } from 'vitest';

import prisma from '@/prisma/prisma.service';

import { takeDocumentNumberForTransition, takeDocumentNumberForTransitionWithStatus } from './take-number';
import * as sequence from './sequence';

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: { company: { findUnique: vi.fn() } },
}));
vi.mock('./sequence');

const findCompany = prisma.company.findUnique as Mock;
const takeDocumentNumber = sequence.takeDocumentNumber as Mock;
const takeDocumentNumberWithStatusTransition = sequence.takeDocumentNumberWithStatusTransition as Mock;

/** The `NumberPattern` a call was given - issue #496 passes `{ pattern, check }`, never a bare string. */
function patternArg(mock: Mock, index: number): { pattern: string; check: (displayNumber: string) => void } {
  return mock.mock.calls[0][index];
}

describe('takeDocumentNumberForTransition (issue #496: the format comes from the country, not the company)', () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the country's own format when the company has no running series", async () => {
    findCompany.mockResolvedValue({ country: 'Italy', countryCode: 'IT', numberFormats: null });
    takeDocumentNumber.mockResolvedValue({ number: 1, displayNumber: 'CN-2026-0001' });

    const result = await takeDocumentNumberForTransition('company-1', 'credit-note', 'doc-1');

    expect(takeDocumentNumber).toHaveBeenCalledWith('company-1', 'credit-note', 'doc-1', expect.anything());
    expect(patternArg(takeDocumentNumber, 3).pattern).toBe('CN-{year}-{number:4}');
    expect(result).toEqual({ number: 1, displayNumber: 'CN-2026-0001' });
  });

  it('keeps a running series that satisfies the country constraints', async () => {
    findCompany.mockResolvedValue({ countryCode: 'FR', numberFormats: { invoice: 'FAC-{year}-{number:5}' } });
    takeDocumentNumber.mockResolvedValue({ number: 7, displayNumber: 'FAC-2026-00007' });

    await takeDocumentNumberForTransition('company-1', 'invoice', 'doc-1');

    expect(patternArg(takeDocumentNumber, 3).pattern).toBe('FAC-{year}-{number:5}');
  });

  it('drops a running series that breaks a country constraint - the country format takes over', async () => {
    // FatturaPA's <Numero> holds 20 characters: the old default credit-note series renders 21.
    findCompany.mockResolvedValue({
      countryCode: 'IT',
      numberFormats: { 'credit-note': 'CREDIT-NOTE-{year}-{number:4}' },
    });
    takeDocumentNumber.mockResolvedValue({ number: 5, displayNumber: 'CN-2026-0005' });

    await takeDocumentNumberForTransition('company-1', 'credit-note', 'doc-1');

    expect(patternArg(takeDocumentNumber, 3).pattern).toBe('CN-{year}-{number:4}');
  });

  it("a running series for a DIFFERENT type doesn't leak into this one", async () => {
    findCompany.mockResolvedValue({ countryCode: 'DE', numberFormats: { quote: 'Q-{number}' } });
    takeDocumentNumber.mockResolvedValue({ number: 1, displayNumber: 'INVOICE-2026-0001' });

    await takeDocumentNumberForTransition('company-1', 'invoice', 'doc-1');

    expect(patternArg(takeDocumentNumber, 3).pattern).toBe('INVOICE-{year}-{number:4}');
  });

  // THE "never waste a number" requirement: a company with no applicable format is refused BEFORE the
  // sequence is ever touched.
  it('refuses a company whose country has no number formats, WITHOUT ever calling the sequence', async () => {
    findCompany.mockResolvedValue({ country: null, countryCode: 'US', numberFormats: null });

    await expect(takeDocumentNumberForTransition('company-1', 'invoice', 'doc-1')).rejects.toThrow(
      /No document number format is defined for "invoice" in country "US"/,
    );
    expect(takeDocumentNumber).not.toHaveBeenCalled();
  });

  it('hands the sequence a check that refuses a rendered number over the country limit', async () => {
    findCompany.mockResolvedValue({ countryCode: 'IT', numberFormats: null });
    takeDocumentNumber.mockResolvedValue(undefined);

    await takeDocumentNumberForTransition('company-1', 'credit-note', 'doc-1');

    const { check } = patternArg(takeDocumentNumber, 3);
    expect(() => check('CN-2026-0001')).not.toThrow();
    expect(() => check('CN-2026-1234567890123')).toThrow(/limit is 20 \(it-fatturapa-numero-string20\)/);
  });

  it('propagates "already numbered" (undefined) from the sequence layer untouched', async () => {
    findCompany.mockResolvedValue({ countryCode: 'FR', numberFormats: null });
    takeDocumentNumber.mockResolvedValue(undefined);

    const result = await takeDocumentNumberForTransition('company-1', 'invoice', 'doc-1');

    expect(result).toBeUndefined();
  });
});

// PR #473 review point 1: the atomic sibling - resolves the format the same way, then wraps
// `sequence.ts#takeDocumentNumberWithStatusTransition` instead of `takeDocumentNumber`, so the status
// write and the number land as ONE transaction. See that function's own header (sequence.ts) for why.
describe('takeDocumentNumberForTransitionWithStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves the format pattern, then delegates the atomic write with it', async () => {
    findCompany.mockResolvedValue({ countryCode: 'PT', numberFormats: null });
    takeDocumentNumberWithStatusTransition.mockResolvedValue({
      document: { id: 'cn-1', status: 'sending', number: 1, displayNumber: 'NC A/0001' },
      numbered: { number: 1, displayNumber: 'NC A/0001' },
    });

    const result = await takeDocumentNumberForTransitionWithStatus(
      'company-1',
      'credit-note',
      'cn-1',
      ['draft', 'send_failed'],
      'sending',
      { reason: 'refund' },
    );

    expect(takeDocumentNumberWithStatusTransition).toHaveBeenCalledWith(
      'company-1',
      'credit-note',
      'cn-1',
      ['draft', 'send_failed'],
      'sending',
      { reason: 'refund' },
      expect.anything(),
    );
    expect(patternArg(takeDocumentNumberWithStatusTransition, 6).pattern).toBe('NC A/{number}');
    expect(result).toEqual({
      document: { id: 'cn-1', status: 'sending', number: 1, displayNumber: 'NC A/0001' },
      numbered: { number: 1, displayNumber: 'NC A/0001' },
    });
  });

  it('refuses a company with no applicable format WITHOUT ever calling the atomic write', async () => {
    findCompany.mockResolvedValue({ country: '', countryCode: null, numberFormats: null });

    await expect(
      takeDocumentNumberForTransitionWithStatus(
        'company-1',
        'credit-note',
        'cn-1',
        ['draft', 'send_failed'],
        'sending',
        {},
      ),
    ).rejects.toThrow(/country could not be resolved/);
    expect(takeDocumentNumberWithStatusTransition).not.toHaveBeenCalled();
  });
});
