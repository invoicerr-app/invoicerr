import { vi, type Mock } from 'vitest';
import prisma from '@/prisma/prisma.service';

import {
  attachAtcudToNumberedInvoice,
  AtcudValidationCodeMissingError,
  ensureAtcudIssuable,
  isAtcudBlockError,
} from './atcud-issuance';
import { AtcudFormatIncompatibleError } from '../numbering/atcud';

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    company: { findUnique: vi.fn() },
    companyAtcudSeries: { findUnique: vi.fn() },
    documentInstance: { update: vi.fn() },
    // logger.service.ts persists every log call through this — see render-pdf.spec.ts's own header
    // for why every spec whose code path can reach `logger.error`/`logger.debug` mocks this too.
    log: { create: vi.fn().mockResolvedValue({}) },
  },
}));

const mockedPrisma = prisma as unknown as {
  company: { findUnique: Mock };
  companyAtcudSeries: { findUnique: Mock };
  documentInstance: { update: Mock };
};

function mockCompany(country: string | null, numberFormats: Record<string, string> | null = null) {
  mockedPrisma.company.findUnique.mockResolvedValue({ country, countryCode: null, numberFormats });
}

const PT_DATE = new Date(2026, 8, 13); // 2026-09-13

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ensureAtcudIssuable — the load-bearing preflight gate, before any number is spent', () => {
  it('is a no-op for a non-Portuguese company — never even reads its number format', async () => {
    mockCompany('France');
    await expect(ensureAtcudIssuable('company-1', PT_DATE)).resolves.toBeUndefined();
    // Only the country lookup ran — a second `findUnique` call for `numberFormats` never happened.
    expect(mockedPrisma.company.findUnique).toHaveBeenCalledTimes(1);
  });

  it('is a no-op for a company with no resolvable country at all', async () => {
    mockCompany(null);
    await expect(ensureAtcudIssuable('company-1', PT_DATE)).resolves.toBeUndefined();
  });

  it('passes for a Portuguese company with an ATCUD-compatible format AND a registered series code', async () => {
    mockCompany('Portugal', { invoice: 'FT {year}/{number:4}' });
    mockedPrisma.companyAtcudSeries.findUnique.mockResolvedValue({
      id: 'series-1',
      companyId: 'company-1',
      typeId: 'invoice',
      seriesId: 'FT 2026',
      validationCode: 'JCVPTS0J',
    });

    await expect(ensureAtcudIssuable('company-1', PT_DATE)).resolves.toBeUndefined();
    expect(mockedPrisma.companyAtcudSeries.findUnique).toHaveBeenCalledWith({
      where: {
        companyId_typeId_seriesId: { companyId: 'company-1', typeId: 'invoice', seriesId: 'FT 2026' },
      },
    });
  });

  // FAILURE PATH 1/2 — an incompatible number format.
  it('throws AtcudFormatIncompatibleError for a Portuguese company on the shipped DEFAULT number format', async () => {
    mockCompany('Portugal', null); // no override at all -> defaultNumberFormatFor('invoice')
    await expect(ensureAtcudIssuable('company-1', PT_DATE)).rejects.toThrow(AtcudFormatIncompatibleError);
    // Never even looked up a series — the format check runs first and fails fast.
    expect(mockedPrisma.companyAtcudSeries.findUnique).not.toHaveBeenCalled();
  });

  // FAILURE PATH 2/2 — a compatible format, but no AT code registered for the predicted series yet.
  it('throws AtcudValidationCodeMissingError when the predicted series has no code registered', async () => {
    mockCompany('Portugal', { invoice: 'FT {year}/{number:4}' });
    mockedPrisma.companyAtcudSeries.findUnique.mockResolvedValue(null);

    await expect(ensureAtcudIssuable('company-1', PT_DATE)).rejects.toThrow(AtcudValidationCodeMissingError);
    await expect(ensureAtcudIssuable('company-1', PT_DATE)).rejects.toThrow(/FT 2026/);
  });

  it('resolves the series id fresh from `now` — a company with a per-year series needs a fresh code every year', async () => {
    mockCompany('Portugal', { invoice: 'FT {year}/{number:4}' });
    mockedPrisma.companyAtcudSeries.findUnique.mockResolvedValue(null);

    await ensureAtcudIssuable('company-1', new Date(2027, 0, 1)).catch(() => undefined);
    expect(mockedPrisma.companyAtcudSeries.findUnique).toHaveBeenCalledWith({
      where: {
        companyId_typeId_seriesId: { companyId: 'company-1', typeId: 'invoice', seriesId: 'FT 2027' },
      },
    });
  });
});

describe('isAtcudBlockError', () => {
  it('recognizes both named ATCUD errors', () => {
    expect(isAtcudBlockError(new AtcudFormatIncompatibleError('x'))).toBe(true);
    expect(isAtcudBlockError(new AtcudValidationCodeMissingError('x'))).toBe(true);
  });

  it('rejects an unrelated error', () => {
    expect(isAtcudBlockError(new Error('unrelated'))).toBe(false);
  });
});

describe('attachAtcudToNumberedInvoice — the defensive re-check AFTER a number is already spent', () => {
  it('is a no-op for a non-Portuguese company', async () => {
    mockCompany('France');
    await attachAtcudToNumberedInvoice('company-1', 'doc-1', {
      number: 1,
      displayNumber: 'INVOICE-2026-0001',
    });
    expect(mockedPrisma.documentInstance.update).not.toHaveBeenCalled();
  });

  it('computes and persists the ATCUD from the frozen displayNumber, for a Portuguese company', async () => {
    mockCompany('Portugal', { invoice: 'FT {year}/{number:4}' });
    mockedPrisma.companyAtcudSeries.findUnique.mockResolvedValue({
      id: 'series-1',
      companyId: 'company-1',
      typeId: 'invoice',
      seriesId: 'FT 2026',
      validationCode: 'JCVPTS0J',
    });

    await attachAtcudToNumberedInvoice('company-1', 'doc-1', { number: 7, displayNumber: 'FT 2026/0007' });

    expect(mockedPrisma.documentInstance.update).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { atcud: 'ATCUD:JCVPTS0J-0007' },
    });
  });

  // Never throws — see this function's own header. A DB write is still attempted only when the
  // re-check succeeds; when it does not, the invoice is left to send WITHOUT an ATCUD rather than
  // crashing an already-numbered, already-"sending" document into an unrecoverable state.
  it('never throws — logs and swallows if the series has since disappeared', async () => {
    mockCompany('Portugal', { invoice: 'FT {year}/{number:4}' });
    mockedPrisma.companyAtcudSeries.findUnique.mockResolvedValue(null);

    await expect(
      attachAtcudToNumberedInvoice('company-1', 'doc-1', { number: 7, displayNumber: 'FT 2026/0007' }),
    ).resolves.toBeUndefined();
    expect(mockedPrisma.documentInstance.update).not.toHaveBeenCalled();
  });

  it('never throws — logs and swallows if the number format itself has since become incompatible', async () => {
    mockCompany('Portugal', { invoice: 'INVOICE-{year}-{number:4}' }); // no "/" at all
    await expect(
      attachAtcudToNumberedInvoice('company-1', 'doc-1', { number: 7, displayNumber: 'INVOICE-2026-0007' }),
    ).resolves.toBeUndefined();
    expect(mockedPrisma.documentInstance.update).not.toHaveBeenCalled();
  });
});
