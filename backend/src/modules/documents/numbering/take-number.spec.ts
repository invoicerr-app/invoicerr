import prisma from '@/prisma/prisma.service';

import { takeDocumentNumberForTransition } from './take-number';
import * as sequence from './sequence';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: { company: { findUnique: jest.fn() } },
}));
jest.mock('./sequence');

const findCompany = prisma.company.findUnique as jest.Mock;
const takeDocumentNumber = sequence.takeDocumentNumber as jest.Mock;

describe('takeDocumentNumberForTransition', () => {
  beforeEach(() => jest.clearAllMocks());

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
