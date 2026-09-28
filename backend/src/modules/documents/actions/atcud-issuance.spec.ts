import { vi, type Mock } from 'vitest';
import prisma from '@/prisma/prisma.service';

import {
  attachAtcudToNumberedDocument,
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
    await expect(ensureAtcudIssuable('company-1', 'invoice', PT_DATE)).resolves.toBeUndefined();
    // Only the country lookup ran — a second `findUnique` call for `numberFormats` never happened.
    expect(mockedPrisma.company.findUnique).toHaveBeenCalledTimes(1);
  });

  it('is a no-op for a company with no resolvable country at all', async () => {
    mockCompany(null);
    await expect(ensureAtcudIssuable('company-1', 'invoice', PT_DATE)).resolves.toBeUndefined();
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

    await expect(ensureAtcudIssuable('company-1', 'invoice', PT_DATE)).resolves.toBeUndefined();
    expect(mockedPrisma.companyAtcudSeries.findUnique).toHaveBeenCalledWith({
      where: {
        companyId_typeId_seriesId: { companyId: 'company-1', typeId: 'invoice', seriesId: 'FT 2026' },
      },
    });
  });

  // FAILURE PATH 1/2 — an incompatible number format.
  it('throws AtcudFormatIncompatibleError for a Portuguese company on the shipped DEFAULT number format', async () => {
    mockCompany('Portugal', null); // no override at all -> defaultNumberFormatFor('invoice')
    await expect(ensureAtcudIssuable('company-1', 'invoice', PT_DATE)).rejects.toThrow(
      AtcudFormatIncompatibleError,
    );
    // Never even looked up a series — the format check runs first and fails fast.
    expect(mockedPrisma.companyAtcudSeries.findUnique).not.toHaveBeenCalled();
  });

  // FAILURE PATH 2/2 — a compatible format, but no AT code registered for the predicted series yet.
  it('throws AtcudValidationCodeMissingError when the predicted series has no code registered', async () => {
    mockCompany('Portugal', { invoice: 'FT {year}/{number:4}' });
    mockedPrisma.companyAtcudSeries.findUnique.mockResolvedValue(null);

    await expect(ensureAtcudIssuable('company-1', 'invoice', PT_DATE)).rejects.toThrow(
      AtcudValidationCodeMissingError,
    );
    await expect(ensureAtcudIssuable('company-1', 'invoice', PT_DATE)).rejects.toThrow(/FT 2026/);
  });

  it('resolves the series id fresh from `now` — a company with a per-year series needs a fresh code every year', async () => {
    mockCompany('Portugal', { invoice: 'FT {year}/{number:4}' });
    mockedPrisma.companyAtcudSeries.findUnique.mockResolvedValue(null);

    await ensureAtcudIssuable('company-1', 'invoice', new Date(2027, 0, 1)).catch(() => undefined);
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

describe('attachAtcudToNumberedDocument - the defensive re-check AFTER a number is already spent', () => {
  it('is a no-op for a non-Portuguese company', async () => {
    mockCompany('France');
    await attachAtcudToNumberedDocument('company-1', 'invoice', 'doc-1', {
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

    await attachAtcudToNumberedDocument('company-1', 'invoice', 'doc-1', {
      number: 7,
      displayNumber: 'FT 2026/0007',
    });

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
      attachAtcudToNumberedDocument('company-1', 'invoice', 'doc-1', {
        number: 7,
        displayNumber: 'FT 2026/0007',
      }),
    ).resolves.toBeUndefined();
    expect(mockedPrisma.documentInstance.update).not.toHaveBeenCalled();
  });

  it('never throws — logs and swallows if the number format itself has since become incompatible', async () => {
    mockCompany('Portugal', { invoice: 'INVOICE-{year}-{number:4}' }); // no "/" at all
    await expect(
      attachAtcudToNumberedDocument('company-1', 'invoice', 'doc-1', {
        number: 7,
        displayNumber: 'INVOICE-2026-0007',
      }),
    ).resolves.toBeUndefined();
    expect(mockedPrisma.documentInstance.update).not.toHaveBeenCalled();
  });
});

// Issue #497 - the credit note gets its own ATCUD, from its OWN number format and its OWN series
// (Portaria n.º 195/2020, art. 2.º b): a series is registered per SAF-T document type, NC here).
describe("the credit note (issue #497): its own format, its own NC series, never the invoice's", () => {
  const formats = { invoice: 'FT {year}/{number:4}', 'credit-note': 'NC {year}/{number:4}' };

  it("ensureAtcudIssuable looks up the credit note's own series, predicted from its own number format", async () => {
    mockCompany('Portugal', formats);
    mockedPrisma.companyAtcudSeries.findUnique.mockResolvedValue({ validationCode: 'NCVALID01' });

    await expect(ensureAtcudIssuable('company-1', 'credit-note', PT_DATE)).resolves.toBeUndefined();
    expect(mockedPrisma.companyAtcudSeries.findUnique).toHaveBeenCalledWith({
      where: {
        companyId_typeId_seriesId: { companyId: 'company-1', typeId: 'credit-note', seriesId: 'NC 2026' },
      },
    });
  });

  it('refuses the shipped default credit-note format, naming the type and an NC-shaped example', async () => {
    mockCompany('Portugal', { invoice: 'FT {year}/{number:4}' }); // credit note left on the default
    const attempt = ensureAtcudIssuable('company-1', 'credit-note', PT_DATE);
    await expect(attempt).rejects.toThrow(AtcudFormatIncompatibleError);
    await expect(ensureAtcudIssuable('company-1', 'credit-note', PT_DATE)).rejects.toThrow(
      /credit note number format \("CREDIT-NOTE-\{year\}-\{number:4\}"\).*"NC \{year\}\/\{number:4\}"/,
    );
  });

  it('refuses when only the INVOICE series is registered: the error names the NC series', async () => {
    mockCompany('Portugal', formats);
    mockedPrisma.companyAtcudSeries.findUnique.mockResolvedValue(null);
    await expect(ensureAtcudIssuable('company-1', 'credit-note', PT_DATE)).rejects.toThrow(
      /credit note series "NC 2026" \(SAF-T document type NC\)/,
    );
  });

  it('attachAtcudToNumberedDocument freezes ATCUD:<NC code>-<sequential> onto the credit note', async () => {
    mockCompany('Portugal', formats);
    mockedPrisma.companyAtcudSeries.findUnique.mockResolvedValue({ validationCode: 'NCVALID01' });

    await attachAtcudToNumberedDocument('company-1', 'credit-note', 'cn-1', {
      number: 3,
      displayNumber: 'NC 2026/0003',
    });

    expect(mockedPrisma.companyAtcudSeries.findUnique).toHaveBeenCalledWith({
      where: {
        companyId_typeId_seriesId: { companyId: 'company-1', typeId: 'credit-note', seriesId: 'NC 2026' },
      },
    });
    expect(mockedPrisma.documentInstance.update).toHaveBeenCalledWith({
      where: { id: 'cn-1' },
      data: { atcud: 'ATCUD:NCVALID01-0003' },
    });
  });
});
