import { vi, type Mock } from 'vitest';
import prisma from '@/prisma/prisma.service';

import {
  attachAtcudToNumberedDocument,
  AtcudValidationCodeMissingError,
  ensureAtcudIssuable,
  isAtcudBlockError,
} from './atcud-issuance';
import { AtcudFormatIncompatibleError } from '../numbering/atcud';
import { defaultCountryPolicyCatalog } from '../country-policy/registry';

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

  it('passes for a Portuguese company whose RUNNING series is ATCUD-compatible, with its code registered (issue #496: the running series is kept)', async () => {
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

  // Issue #496: with no running series, Portugal's own format ("FT A/{number}", country-policy/data/
  // pt.json) applies - ATCUD-compatible out of the box, so the only thing left to configure is the AT
  // validation code of series "FT A". The old shared default had no "/" at all and blocked here.
  it('a Portuguese company with no running series gets Portugal\'s own format: series "FT A", no per-year code', async () => {
    mockCompany('Portugal', null);
    mockedPrisma.companyAtcudSeries.findUnique.mockResolvedValue({ validationCode: 'JCVPTS0J' });

    await expect(ensureAtcudIssuable('company-1', 'invoice', new Date(2031, 5, 1))).resolves.toBeUndefined();
    expect(mockedPrisma.companyAtcudSeries.findUnique).toHaveBeenCalledWith({
      where: { companyId_typeId_seriesId: { companyId: 'company-1', typeId: 'invoice', seriesId: 'FT A' } },
    });
  });

  it('a running series that cannot carry an ATCUD gives way to the country format (series "FT A")', async () => {
    mockCompany('Portugal', { invoice: 'INVOICE-{year}-{number:4}' });
    mockedPrisma.companyAtcudSeries.findUnique.mockResolvedValue(null);

    await expect(ensureAtcudIssuable('company-1', 'invoice', PT_DATE)).rejects.toThrow(
      AtcudValidationCodeMissingError,
    );
    await expect(ensureAtcudIssuable('company-1', 'invoice', PT_DATE)).rejects.toThrow(/"FT A"/);
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

// Issue #603 - proves the gate is now driven by the country's own `documentValidationCode` fact
// (`country-policy/schema.ts`) rather than by the literal 'PT': a `documentValidationCodeFor` spy
// shows the SAME fact-based decision for a country that is not Portugal, and the opposite decision
// for Portugal itself when the fact's scheme does not say "ATCUD" - something a bare `=== 'PT'`
// check could never express.
describe('ensureAtcudIssuable - driven by the documentValidationCode fact, not a country literal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('proceeds for a non-Portuguese country whose fact happens to declare scheme "ATCUD"', async () => {
    mockCompany('Germany', { invoice: 'FT {year}/{number:4}' });
    vi.spyOn(defaultCountryPolicyCatalog, 'documentValidationCodeFor').mockReturnValue({
      scheme: 'ATCUD',
      provenance: { kind: 'unverified', resolutionNote: 'Fixture.' },
    });
    mockedPrisma.companyAtcudSeries.findUnique.mockResolvedValue({ validationCode: 'JCVPTS0J' });

    await expect(ensureAtcudIssuable('company-1', 'invoice', PT_DATE)).resolves.toBeUndefined();
  });

  it('is a no-op for Portugal itself when the fact declares a DIFFERENT scheme', async () => {
    mockCompany('Portugal', { invoice: 'FT {year}/{number:4}' });
    vi.spyOn(defaultCountryPolicyCatalog, 'documentValidationCodeFor').mockReturnValue({
      scheme: 'SOME-OTHER-CODE',
      provenance: { kind: 'unverified', resolutionNote: 'Fixture.' },
    });

    await expect(ensureAtcudIssuable('company-1', 'invoice', PT_DATE)).resolves.toBeUndefined();
    expect(mockedPrisma.companyAtcudSeries.findUnique).not.toHaveBeenCalled();
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

  it('never throws - logs and swallows if the number it is handed cannot carry an ATCUD', async () => {
    mockCompany('Portugal', null);
    mockedPrisma.companyAtcudSeries.findUnique.mockResolvedValue(null);
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

  // Issue #496: a Portuguese credit note left without a running series is numbered in Portugal's own
  // NC format, so the series to register is "NC A" - never a format the company has to configure.
  it('a credit note with no running series gets Portugal\'s own NC format: series "NC A"', async () => {
    mockCompany('Portugal', { invoice: 'FT {year}/{number:4}' });
    mockedPrisma.companyAtcudSeries.findUnique.mockResolvedValue(null);
    await expect(ensureAtcudIssuable('company-1', 'credit-note', PT_DATE)).rejects.toThrow(
      /credit note series "NC A" \(SAF-T document type NC\)/,
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
