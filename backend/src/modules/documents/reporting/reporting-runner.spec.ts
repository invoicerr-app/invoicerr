/**
 * `ReportingRunner` in isolation — persistence (`../persistence`'s own `findOwnedDocument`,
 * `../conformity/authority-events.persistence`) and Prisma itself are mocked wholesale, the same
 * "pure core, thin persistence shell, mock the shell" discipline
 * `conformity/conformity-sweep-runner.spec.ts` already holds for its own sibling runner. The real
 * Postgres/Redis proof (a genuine job traversing the queue) is
 * `queue/__tests__/document-report-queue.redis.spec.ts`'s job.
 */
import prisma from '@/prisma/prisma.service';

import { createAuthorityEvents, journalSyntheticEvent } from '../conformity/authority-events.persistence';
import { ChannelNotConnectedError } from '../conformity/authority-status-poller';
import * as persistence from '../persistence';
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { DocumentTypeRegistry } from '../descriptors/type-registry';
import { DeclarationProvider, DeclarationResult } from './declaration-provider';
import { DeclarationProviderRegistry } from './declaration-provider';
import { REPORT_BLOCKED_STATUS_CODE, REPORT_FAILED_STATUS_CODE, ReportJobData } from './report-job';
import { InvalidDeclarationResultError, ReportingRunner } from './reporting-runner';

jest.mock('../persistence');
jest.mock('../conformity/authority-events.persistence');
jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    company: { findUniqueOrThrow: jest.fn() },
    client: { findUniqueOrThrow: jest.fn() },
  },
}));

const mockedFindOwnedDocument = persistence.findOwnedDocument as jest.Mock;
const mockedCreateAuthorityEvents = createAuthorityEvents as jest.Mock;
const mockedJournalSynthetic = journalSyntheticEvent as jest.Mock;
const mockedPrisma = prisma as unknown as {
  company: { findUniqueOrThrow: jest.Mock };
  client: { findUniqueOrThrow: jest.Mock };
};

const JOB_DATA: ReportJobData = {
  companyId: 'company-1',
  documentId: 'doc-1',
  typeId: 'invoice',
  providerId: 'nav',
};

const FIXTURE_DOCUMENT = {
  id: 'doc-1',
  typeId: 'invoice',
  status: 'sent',
  displayNumber: 'INV-2026-0001',
  data: {
    issueDate: '2026-09-02T00:00:00.000Z',
    currency: 'HUF',
    client: 'client-1',
    lines: [{ description: 'Widget', quantity: 2, unit: 'pcs', unitPrice: 100, vatRate: 27 }],
  },
};

const FIXTURE_COMPANY = {
  id: 'company-1',
  name: 'Acme Kft.',
  address: 'Fő utca 1',
  addressLine2: null,
  city: 'Budapest',
  postalCode: '1011',
  country: 'Hungary',
  email: 'billing@acme.hu',
  phone: '+3611234567',
  iban: null,
  partyIdentifiers: [{ scheme: 'VAT', value: 'HU12345678' }],
};

const FIXTURE_CLIENT = {
  id: 'client-1',
  name: 'Buyer Kft.',
  contactFirstname: null,
  contactLastname: null,
  contactEmail: null,
  contactPhone: null,
  address: 'Kossuth tér 2',
  addressLine2: null,
  city: 'Budapest',
  postalCode: '1055',
  country: 'Hungary',
  partyIdentifiers: [{ scheme: 'VAT', value: 'HU87654321' }],
};

function buildRegistry(provider?: DeclarationProvider): DeclarationProviderRegistry {
  const registry = new DeclarationProviderRegistry();
  if (provider) registry.register(provider);
  return registry;
}

function buildRunner(provider?: DeclarationProvider): ReportingRunner {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildInvoiceDescriptor());
  return new ReportingRunner(buildRegistry(provider), typeRegistry);
}

const SUCCESS_RESULT: DeclarationResult = {
  statusCode: 'DONE',
  observedAt: new Date('2026-09-02T10:00:00Z'),
  rawPayload: { transactionId: 'TXN123456' },
  authorityId: 'TXN123456',
};

describe('ReportingRunner.runReport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFindOwnedDocument.mockResolvedValue(FIXTURE_DOCUMENT);
    mockedPrisma.company.findUniqueOrThrow.mockResolvedValue(FIXTURE_COMPANY);
    mockedPrisma.client.findUniqueOrThrow.mockResolvedValue(FIXTURE_CLIENT);
    mockedCreateAuthorityEvents.mockResolvedValue(1);
    mockedJournalSynthetic.mockResolvedValue(1);
  });

  it('no provider registered for this providerId: nothing journaled, document never even read', async () => {
    const runner = buildRunner(undefined);
    const result = await runner.runReport(JOB_DATA);
    expect(result).toEqual({ journaled: 0 });
    expect(mockedFindOwnedDocument).not.toHaveBeenCalled();
  });

  it('a real success journals the declaration event, carrying the authority result verbatim', async () => {
    const declare = jest.fn().mockResolvedValue(SUCCESS_RESULT);
    const runner = buildRunner({ providerId: 'nav', declare });

    const result = await runner.runReport(JOB_DATA);

    expect(result).toEqual({ journaled: 1 });
    expect(declare).toHaveBeenCalledTimes(1);
    expect(declare.mock.calls[0][0]).toBe('company-1');
    const declaredInvoice = declare.mock.calls[0][1];
    expect(declaredInvoice.documentId).toBe('doc-1');
    expect(declaredInvoice.number).toBe('INV-2026-0001');
    expect(declaredInvoice.seller.vatNumber).toBe('HU12345678');
    expect(declaredInvoice.buyer.vatNumber).toBe('HU87654321');
    expect(mockedCreateAuthorityEvents).toHaveBeenCalledWith('company-1', 'doc-1', 'nav', [SUCCESS_RESULT]);
    expect(mockedJournalSynthetic).not.toHaveBeenCalled();
  });

  // Credentials absent → `report:blocked`, journaled, NEVER a crash — this task's own named rule.
  it('missing credentials (ChannelNotConnectedError): journals report:blocked, never calls createAuthorityEvents', async () => {
    const declare = jest.fn().mockRejectedValue(new ChannelNotConnectedError('nav'));
    const runner = buildRunner({ providerId: 'nav', declare });

    const result = await runner.runReport(JOB_DATA);

    expect(result).toEqual({ journaled: 1 });
    expect(mockedJournalSynthetic).toHaveBeenCalledWith(
      'company-1',
      'doc-1',
      'nav',
      REPORT_BLOCKED_STATUS_CODE,
      expect.any(String),
    );
    expect(mockedCreateAuthorityEvents).not.toHaveBeenCalled();
  });

  // THE MUTATION TARGET: an unexpected declaration failure that got silently swallowed (instead of
  // propagating) would let this test's own `await expect(...).rejects` fail — BullMQ's own
  // attempts/backoff is what actually retries a report job, and it can only do that if this method
  // still throws.
  it('a genuine, unexpected failure (not "not connected") PROPAGATES — never swallowed here', async () => {
    const declare = jest.fn().mockRejectedValue(new Error('NAV HTTP 500'));
    const runner = buildRunner({ providerId: 'nav', declare });

    await expect(runner.runReport(JOB_DATA)).rejects.toThrow('NAV HTTP 500');
    expect(mockedCreateAuthorityEvents).not.toHaveBeenCalled();
    expect(mockedJournalSynthetic).not.toHaveBeenCalled();
  });

  // ⚖ "MARK/transactionId non vides" — the hard contract this whole mechanism refuses to relax.
  it('a provider returning an empty authorityId is REFUSED — never journaled as a success', async () => {
    const declare = jest.fn().mockResolvedValue({ ...SUCCESS_RESULT, authorityId: '' });
    const runner = buildRunner({ providerId: 'nav', declare });

    await expect(runner.runReport(JOB_DATA)).rejects.toThrow(InvalidDeclarationResultError);
    expect(mockedCreateAuthorityEvents).not.toHaveBeenCalled();
  });

  it('a provider returning an empty statusCode is REFUSED the same way', async () => {
    const declare = jest.fn().mockResolvedValue({ ...SUCCESS_RESULT, statusCode: '' });
    const runner = buildRunner({ providerId: 'nav', declare });

    await expect(runner.runReport(JOB_DATA)).rejects.toThrow(InvalidDeclarationResultError);
    expect(mockedCreateAuthorityEvents).not.toHaveBeenCalled();
  });

  // Dédup — re-running the SAME successful declaration journals it through the SAME persistence call
  // a second time; `DocumentAuthorityEvent`'s own `@@unique([documentId, providerId, statusCode])`
  // (proven directly in `conformity/authority-events.persistence.spec.ts` and the real-Redis
  // integration spec) is what turns the SECOND call into zero newly-created rows — this test proves
  // the RUNNER faithfully reports back whatever the persistence layer says, never inventing its own
  // "already done" shortcut that could itself drift from the real dedup mechanism.
  it("re-running the same successful declaration reflects the persistence layer's own dedup (1, then 0)", async () => {
    mockedCreateAuthorityEvents.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const declare = jest.fn().mockResolvedValue(SUCCESS_RESULT);
    const runner = buildRunner({ providerId: 'nav', declare });

    const first = await runner.runReport(JOB_DATA);
    const second = await runner.runReport(JOB_DATA);

    expect(first).toEqual({ journaled: 1 });
    expect(second).toEqual({ journaled: 0 });
    expect(mockedCreateAuthorityEvents).toHaveBeenCalledTimes(2);
  });
});

describe('ReportingRunner.recordTerminalFailure', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedJournalSynthetic.mockResolvedValue(1);
  });

  it("journals report:failed with the failure's own message", async () => {
    const runner = buildRunner({ providerId: 'nav', declare: jest.fn() });
    await runner.recordTerminalFailure(JOB_DATA, new Error('every retry exhausted'));

    expect(mockedJournalSynthetic).toHaveBeenCalledWith(
      'company-1',
      'doc-1',
      'nav',
      REPORT_FAILED_STATUS_CODE,
      'every retry exhausted',
    );
  });

  // Belt and suspenders — never crashes the worker process even when its OWN compensating write
  // fails, the identical discipline `archive/archive-on-send.ts`'s own compensating write already
  // holds.
  it('never throws even when the journal write itself fails', async () => {
    mockedJournalSynthetic.mockRejectedValue(new Error('DB unreachable'));
    const runner = buildRunner({ providerId: 'nav', declare: jest.fn() });

    await expect(runner.recordTerminalFailure(JOB_DATA, new Error('original'))).resolves.toBeUndefined();
  });
});
