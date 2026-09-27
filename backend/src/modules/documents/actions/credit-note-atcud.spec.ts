/**
 * Portugal's ATCUD on the credit note (issue #497) - the WIRING inside `credit-note-actions.ts`'s
 * "send", in the same mocked style as `invoice-atcud.spec.ts` (its invoice twin). Whether
 * `ensureAtcudIssuable`/`attachAtcudToNumberedDocument` resolve the right series on their own is
 * `atcud-issuance.spec.ts`'s job; this file only proves the credit note's "send" calls them, on the
 * credit note's own number format and series, at the right moments, and NOT for a legacy credit note
 * that will never be numbered.
 *
 * A FREE credit note (no `invoice`, its own `lines`) is used throughout: it skips the currency
 * comparison against an invoice, which has nothing to do with the ATCUD.
 */
import { vi, type Mock } from 'vitest';
import { BadRequestException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import * as countryPolicy from '../country-policy/country-policy';
import * as takeNumber from '../numbering/take-number';
import * as persistence from '../persistence';
import { ActionRegistry } from './action-registry';
import { registerCreditNoteActions } from './credit-note-actions';

vi.mock('../persistence');
vi.mock('../country-policy/country-policy');
vi.mock('../numbering/take-number');
vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    company: { findUnique: vi.fn() },
    companyAtcudSeries: { findUnique: vi.fn() },
    documentInstance: { update: vi.fn() },
    log: { create: vi.fn().mockResolvedValue({}) },
  },
}));

const mockedPrisma = prisma as unknown as {
  company: { findUnique: Mock };
  companyAtcudSeries: { findUnique: Mock };
  documentInstance: { update: Mock };
};

const PT_FORMATS = { invoice: 'FT {year}/{number:4}', 'credit-note': 'NC {year}/{number:4}' };
const YEAR = new Date().getFullYear();

const creditNoteData = {
  client: 'client-1',
  issueDate: `${YEAR}-09-28`,
  currency: 'EUR',
  lines: [{ description: 'Goodwill credit', quantity: 1, unit: 'unit', unitPrice: 50, vatRate: '23' }],
};

function creditNote(status: string, extra: Record<string, unknown> = {}) {
  return {
    id: 'cn-1',
    typeId: 'credit-note',
    status,
    data: creditNoteData,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...extra,
  };
}

function sendAction() {
  const registry = new ActionRegistry();
  registerCreditNoteActions(registry, { queueDispatcher: { enqueueAction: vi.fn() } });
  const handler = registry.resolve('credit-note', 'send');
  return handler!({
    companyId: 'company-1',
    typeId: 'credit-note',
    documentId: 'cn-1',
    data: creditNoteData,
    params: {},
  });
}

function numberedAs(displayNumber: string, number: number) {
  (takeNumber.takeDocumentNumberForTransitionWithStatus as Mock).mockResolvedValue({
    document: { ...creditNote('sending'), number, displayNumber },
    numbered: { number, displayNumber },
  });
}

describe('credit-note "send" - Portugal\'s ATCUD preflight and numbering-time attachment (issue #497)', () => {
  afterEach(() => vi.resetAllMocks());

  beforeEach(() => {
    (persistence.findOwnedDocument as Mock).mockResolvedValue(creditNote('draft'));
  });

  it('is a no-op outside Portugal: no number format read, no series read, no ATCUD written', async () => {
    (countryPolicy.resolveCompanyCountryCode as Mock).mockResolvedValue('FR');
    numberedAs(`CREDIT-NOTE-${YEAR}-0001`, 1);

    const result = await sendAction();

    expect(result.changed).toBe(true);
    expect(mockedPrisma.company.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.companyAtcudSeries.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.documentInstance.update).not.toHaveBeenCalled();
  });

  it('BLOCKS a Portuguese credit note on the shipped default format, before it is persisted or numbered', async () => {
    (countryPolicy.resolveCompanyCountryCode as Mock).mockResolvedValue('PT');
    mockedPrisma.company.findUnique.mockResolvedValue({ numberFormats: { invoice: 'FT {year}/{number:4}' } });

    const action = sendAction();

    await expect(action).rejects.toBeInstanceOf(BadRequestException);
    await expect(action).rejects.toThrow(/credit note number format/);
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
    expect(takeNumber.takeDocumentNumberForTransitionWithStatus).not.toHaveBeenCalled();
  });

  it('BLOCKS a Portuguese credit note whose NC series has no validation code, even if the FT one has', async () => {
    (countryPolicy.resolveCompanyCountryCode as Mock).mockResolvedValue('PT');
    mockedPrisma.company.findUnique.mockResolvedValue({ numberFormats: PT_FORMATS });
    mockedPrisma.companyAtcudSeries.findUnique.mockImplementation(
      ({ where }: { where: { companyId_typeId_seriesId: { typeId: string } } }) =>
        Promise.resolve(
          where.companyId_typeId_seriesId.typeId === 'invoice' ? { validationCode: 'FTVALID01' } : null,
        ),
    );

    const action = sendAction();

    await expect(action).rejects.toBeInstanceOf(BadRequestException);
    await expect(action).rejects.toThrow(`credit note series "NC ${YEAR}"`);
    expect(takeNumber.takeDocumentNumberForTransitionWithStatus).not.toHaveBeenCalled();
  });

  it('numbers the credit note, THEN freezes ATCUD:<NC code>-<sequential> onto it', async () => {
    (countryPolicy.resolveCompanyCountryCode as Mock).mockResolvedValue('PT');
    mockedPrisma.company.findUnique.mockResolvedValue({ numberFormats: PT_FORMATS });
    mockedPrisma.companyAtcudSeries.findUnique.mockResolvedValue({ validationCode: 'NCVALID01' });
    numberedAs(`NC ${YEAR}/0004`, 4);

    const result = await sendAction();

    expect(result.changed).toBe(true);
    expect(mockedPrisma.companyAtcudSeries.findUnique).toHaveBeenLastCalledWith({
      where: {
        companyId_typeId_seriesId: { companyId: 'company-1', typeId: 'credit-note', seriesId: `NC ${YEAR}` },
      },
    });
    expect(mockedPrisma.documentInstance.update).toHaveBeenCalledWith({
      where: { id: 'cn-1' },
      data: { atcud: 'ATCUD:NCVALID01-0004' },
    });
  });

  // A LEGACY credit note (issued before #471 gave the type a number) retried from "send_failed" is
  // never numbered (`numberingOnlyFrom: ['draft']`), so it can never carry an ATCUD: the gate must not
  // strand it for a code it could not print anyway.
  it('does NOT gate a legacy unnumbered credit note retried from "send_failed" (it will never be numbered)', async () => {
    (countryPolicy.resolveCompanyCountryCode as Mock).mockResolvedValue('PT');
    (persistence.findOwnedDocument as Mock).mockResolvedValue(creditNote('send_failed'));
    (persistence.upsertDocument as Mock).mockResolvedValue(creditNote('sending'));
    mockedPrisma.company.findUnique.mockResolvedValue({ numberFormats: null }); // would fail the gate

    const result = await sendAction();

    expect(result.changed).toBe(true);
    expect(takeNumber.takeDocumentNumberForTransitionWithStatus).not.toHaveBeenCalled();
    expect(mockedPrisma.companyAtcudSeries.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.documentInstance.update).not.toHaveBeenCalled();
  });
});
