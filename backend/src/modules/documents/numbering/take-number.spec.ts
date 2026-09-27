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

describe('takeDocumentNumberForTransition', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses the default pattern for the type when the company has no numberFormats at all', async () => {
    findCompany.mockResolvedValue({ numberFormats: null });
    takeDocumentNumber.mockResolvedValue({ number: 1, displayNumber: 'INVOICE-2026-0001' });

    const result = await takeDocumentNumberForTransition('company-1', 'invoice', 'doc-1');

    expect(takeDocumentNumber).toHaveBeenCalledWith(
      'company-1',
      'invoice',
      'doc-1',
      'INVOICE-{year}-{number:4}',
    );
    expect(result).toEqual({ number: 1, displayNumber: 'INVOICE-2026-0001' });
  });

  it("uses the company's own configured pattern for this type when present", async () => {
    findCompany.mockResolvedValue({ numberFormats: { invoice: 'FAC-{year}-{number:5}' } });
    takeDocumentNumber.mockResolvedValue({ number: 1, displayNumber: 'FAC-2026-00001' });

    await takeDocumentNumberForTransition('company-1', 'invoice', 'doc-1');

    expect(takeDocumentNumber).toHaveBeenCalledWith('company-1', 'invoice', 'doc-1', 'FAC-{year}-{number:5}');
  });

  it("a configured pattern for a DIFFERENT type doesn't leak into this one — falls back to the default", async () => {
    findCompany.mockResolvedValue({ numberFormats: { quote: 'Q-{number}' } });
    takeDocumentNumber.mockResolvedValue({ number: 1, displayNumber: 'INVOICE-2026-0001' });

    await takeDocumentNumberForTransition('company-1', 'invoice', 'doc-1');

    expect(takeDocumentNumber).toHaveBeenCalledWith(
      'company-1',
      'invoice',
      'doc-1',
      'INVOICE-{year}-{number:4}',
    );
  });

  // THE "never waste a number" requirement: a bad pattern must be caught BEFORE the sequence is ever
  // touched, not after — see format-number.ts's own header on why validation happens at resolution.
  it('refuses a misconfigured company pattern WITHOUT ever calling the sequence', async () => {
    findCompany.mockResolvedValue({ numberFormats: { invoice: 'FAC-{year}' } });

    await expect(takeDocumentNumberForTransition('company-1', 'invoice', 'doc-1')).rejects.toThrow(
      /no "\{number\}" token/,
    );
    expect(takeDocumentNumber).not.toHaveBeenCalled();
  });

  it('propagates "already numbered" (undefined) from the sequence layer untouched', async () => {
    findCompany.mockResolvedValue({ numberFormats: null });
    takeDocumentNumber.mockResolvedValue(undefined);

    const result = await takeDocumentNumberForTransition('company-1', 'invoice', 'doc-1');

    expect(result).toBeUndefined();
  });
});

// PR #473 review point 1: the atomic sibling - resolves the company's own format pattern (same
// "bad pattern refuses before anything is written" discipline above) then wraps
// `sequence.ts#takeDocumentNumberWithStatusTransition` instead of `takeDocumentNumber`, so the status
// write and the number land as ONE transaction. See that function's own header (sequence.ts) for why.
describe('takeDocumentNumberForTransitionWithStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves the format pattern, then delegates the atomic write with it', async () => {
    findCompany.mockResolvedValue({ numberFormats: { 'credit-note': 'CN-{year}-{number:4}' } });
    takeDocumentNumberWithStatusTransition.mockResolvedValue({
      document: { id: 'cn-1', status: 'sending', number: 1, displayNumber: 'CN-2026-0001' },
      numbered: { number: 1, displayNumber: 'CN-2026-0001' },
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
      'CN-{year}-{number:4}',
    );
    expect(result).toEqual({
      document: { id: 'cn-1', status: 'sending', number: 1, displayNumber: 'CN-2026-0001' },
      numbered: { number: 1, displayNumber: 'CN-2026-0001' },
    });
  });

  // Same "never waste a number" requirement as the non-atomic sibling above: a bad pattern must be
  // caught before the status write or the sequence are EVER touched.
  it('refuses a misconfigured company pattern WITHOUT ever calling the atomic write', async () => {
    findCompany.mockResolvedValue({ numberFormats: { 'credit-note': 'CN-{year}' } });

    await expect(
      takeDocumentNumberForTransitionWithStatus(
        'company-1',
        'credit-note',
        'cn-1',
        ['draft', 'send_failed'],
        'sending',
        {},
      ),
    ).rejects.toThrow(/no "\{number\}" token/);
    expect(takeDocumentNumberWithStatusTransition).not.toHaveBeenCalled();
  });
});
