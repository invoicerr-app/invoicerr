/**
 * The "invopop" transport in isolation. `InvopopClient` and `@/prisma/prisma.service` are mocked
 * wholesale (the real HTTP round-trip is `invopop/invopop.live.spec.ts`'s job, gated on real sandbox
 * credentials); this proves the ORCHESTRATION, and in particular the four ways this transport refuses
 * to call a deposit a success - see its own header's hard-success contract.
 */
import { vi, type Mock } from 'vitest';
import { BadRequestException, NotImplementedException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import { buildInvopopTransport, extractInvopopCredentials } from './invopop-transport';
import { DocumentTransportContext } from './transport-registry';

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    company: { findUnique: vi.fn() },
    client: { findFirst: vi.fn() },
  },
}));

const mockPutSiloEntry = vi.fn();
const mockPutJob = vi.fn();
const mockGetSiloEntry = vi.fn();

vi.mock('./invopop/invopop-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./invopop/invopop-client')>();
  return {
    ...actual,
    // A `function` expression, NOT an arrow function - production code does `new InvopopClient(...)`
    // and Vitest's mocks really `[[Construct]]` their implementation, which an arrow function cannot.
    // biome-ignore lint/complexity/useArrowFunction: must stay a function expression, see above.
    InvopopClient: vi.fn().mockImplementation(function () {
      return { putSiloEntry: mockPutSiloEntry, putJob: mockPutJob, getSiloEntry: mockGetSiloEntry };
    }),
  };
});

const mockedPrisma = prisma as unknown as {
  company: { findUnique: Mock };
  client: { findFirst: Mock };
};

const CONNECTED_CONFIG = {
  providerId: 'invopop',
  channel: 'INVOPOP',
  environment: 'TEST' as const,
  isActive: true,
  config: { apiKey: 'token-not-a-real-key', workflowId: 'wf-1' },
};

function buildDeps(resolveActive?: Mock) {
  return {
    channelCredentials: {
      resolveActive: resolveActive ?? vi.fn().mockResolvedValue(CONNECTED_CONFIG),
    } as unknown as ChannelCredentialsService,
  };
}

const CTX: DocumentTransportContext = {
  companyId: 'company-1',
  label: 'Invoice',
  document: {
    id: 'doc-1',
    typeId: 'invoice',
    status: 'sending',
    data: {
      client: 'client-1',
      issueDate: '2026-09-24',
      dueDate: '2026-10-24',
      currency: 'EUR',
      lines: [{ description: 'Consulting', quantity: 2, unit: 'hour', unitPrice: 100, vatRate: '20' }],
    },
    createdAt: new Date('2026-09-24T08:19:48.306Z'),
    updatedAt: new Date('2026-09-24T08:19:48.306Z'),
    displayNumber: 'INV-2026-0042',
  },
};

/** The entry the sandbox actually answers with, trimmed to what this transport reads. */
function storedEntry(payable = '240.00') {
  return {
    id: '01a0d27f-d515-7f3b-8866-b71f0585f08f',
    folder: 'invoices',
    signed: true,
    snippet: { payable },
    data: { $schema: 'https://gobl.org/draft-0/envelope', doc: { totals: { payable } }, sigs: ['sig'] },
  };
}

describe('extractInvopopCredentials', () => {
  it('refuses a config missing the workflow id - an entry with no workflow is transmitted nowhere', () => {
    expect(extractInvopopCredentials({ ...CONNECTED_CONFIG, config: { apiKey: 'k' } })).toBeNull();
  });

  it('refuses a config missing the API key', () => {
    expect(extractInvopopCredentials({ ...CONNECTED_CONFIG, config: { workflowId: 'wf-1' } })).toBeNull();
  });

  it('leaves the base URL undefined when none is configured - one host serves every workspace', () => {
    expect(extractInvopopCredentials(CONNECTED_CONFIG)).toEqual({
      apiKey: 'token-not-a-real-key',
      workflowId: 'wf-1',
      baseUrl: undefined,
    });
  });
});

describe('buildInvopopTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedPrisma.company.findUnique.mockResolvedValue({
      id: 'company-1',
      name: 'Invoicerr Test Seller',
      address: '809 avenue du Languedoc',
      city: 'Millau',
      postalCode: '12100',
      country: 'France',
      email: 'seller@example.fr',
      partyIdentifiers: [{ scheme: 'VAT', value: 'FR11123456782' }],
    });
    mockedPrisma.client.findFirst.mockResolvedValue({
      id: 'client-1',
      name: 'Invoicerr Test Buyer',
      address: '1 rue de Tricatel',
      city: 'Paris',
      postalCode: '75001',
      country: 'France',
      partyIdentifiers: [{ scheme: 'VAT', value: 'FR82404847824' }],
    });
    mockPutSiloEntry.mockResolvedValue(storedEntry());
    mockGetSiloEntry.mockResolvedValue(storedEntry());
    mockPutJob.mockResolvedValue({ id: 'job-1', status: 'OK', completed_at: '2026-09-24T08:19:48.545Z' });
  });

  it('blocks in preflight, before any network call, when the channel is not connected', async () => {
    const transport = buildInvopopTransport(buildDeps(vi.fn().mockResolvedValue(null)));
    await expect(transport.preflight?.('company-1')).rejects.toBeInstanceOf(NotImplementedException);
    expect(mockPutSiloEntry).not.toHaveBeenCalled();
  });

  it('blocks in preflight when the config has no workflow id', async () => {
    const resolveActive = vi.fn().mockResolvedValue({ ...CONNECTED_CONFIG, config: { apiKey: 'k' } });
    const transport = buildInvopopTransport(buildDeps(resolveActive));
    await expect(transport.preflight?.('company-1')).rejects.toBeInstanceOf(NotImplementedException);
  });

  it('deposits the GOBL document, runs the workflow and returns the silo entry id', async () => {
    const result = await buildInvopopTransport(buildDeps()).send(CTX);

    expect(result.providerId).toBe('invopop');
    expect(result.reference).toBe('01a0d27f-d515-7f3b-8866-b71f0585f08f');

    const [entryId, document] = mockPutSiloEntry.mock.calls[0];
    expect(entryId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(document.$schema).toBe('https://gobl.org/draft-0/bill/invoice');
    // The document's own number, not a platform-assigned one: this product numbers its invoices.
    expect(document.code).toBe('INV-2026-0042');
    expect(mockPutJob.mock.calls[0][1]).toMatchObject({ workflowId: 'wf-1', siloEntryId: entryId });
  });

  it('archives the SIGNED envelope the platform handed back, not the bare document it sent', async () => {
    const result = await buildInvopopTransport(buildDeps()).send(CTX);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts?.[0]).toMatchObject({ role: 'gobl', mime: 'application/json' });
    const archived = JSON.parse(Buffer.from(result.artifacts![0].bytes).toString('utf8'));
    expect(archived.$schema).toBe('https://gobl.org/draft-0/envelope');
    expect(archived.sigs).toEqual(['sig']);
  });

  it('derives the same ids on a retry, so a repeated send can never deposit the invoice twice', async () => {
    const transport = buildInvopopTransport(buildDeps());
    await transport.send(CTX);
    await transport.send(CTX);
    expect(mockPutSiloEntry.mock.calls[0][0]).toBe(mockPutSiloEntry.mock.calls[1][0]);
    expect(mockPutJob.mock.calls[0][0]).toBe(mockPutJob.mock.calls[1][0]);
  });

  it('FAILS on a job carrying faults, even though its status reads OK', async () => {
    // The platform's own documentation: a job whose step failed and whose error branch then ran
    // reports `status: "OK"` and still carries `faults`. Reading success off `status` is the exact
    // false green this contract exists to prevent.
    mockPutJob.mockResolvedValue({
      id: 'job-1',
      status: 'OK',
      completed_at: '2026-09-24T08:19:48.545Z',
      faults: [{ provider: 'peppol', code: 'send-failed', message: 'receiver not registered' }],
    });
    await expect(buildInvopopTransport(buildDeps()).send(CTX)).rejects.toThrow(/receiver not registered/);
  });

  it('FAILS on an entry with no id - a reference nobody can look up is not a reference', async () => {
    mockGetSiloEntry.mockResolvedValue({ id: '' });
    await expect(buildInvopopTransport(buildDeps()).send(CTX)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('FAILS when the platform recomputed a different payable total', async () => {
    // GOBL replaces supplied totals silently, so the returned total is the only signal there is.
    mockGetSiloEntry.mockResolvedValue(storedEntry('999.00'));
    await expect(buildInvopopTransport(buildDeps()).send(CTX)).rejects.toThrow(/recomputed/);
  });

  it('ACCEPTS a job still running after the wait - the deposit is in, the verdict is not', async () => {
    mockPutJob.mockResolvedValue({ id: 'job-1', status: 'NA' });
    const result = await buildInvopopTransport(buildDeps()).send(CTX);
    expect(result.reference).toBe('01a0d27f-d515-7f3b-8866-b71f0585f08f');
    expect(result.message).toMatch(/still running/);
  });

  it('refuses a document with no currency rather than picking one on its behalf', async () => {
    const noCurrency = { ...CTX, document: { ...CTX.document, data: { ...(CTX.document.data as object) } } };
    delete (noCurrency.document.data as Record<string, unknown>).currency;
    await expect(buildInvopopTransport(buildDeps()).send(noCurrency)).rejects.toThrow(/no currency/);
    expect(mockPutSiloEntry).not.toHaveBeenCalled();
  });

  it("refuses a document whose client is not this company's", async () => {
    mockedPrisma.client.findFirst.mockResolvedValue(null);
    await expect(buildInvopopTransport(buildDeps()).send(CTX)).rejects.toThrow(/no valid client on file/);
  });

  it('turns a client error into a BadRequest so BullMQ retries before `send_failed` is recorded', async () => {
    mockPutSiloEntry.mockRejectedValue(new Error('Invopop API error 422: GOBL-FR-TAX-IDENTITY-01'));
    await expect(buildInvopopTransport(buildDeps()).send(CTX)).rejects.toThrow(
      /Invopop deposit failed: .*GOBL-FR-TAX-IDENTITY-01/,
    );
  });
});
