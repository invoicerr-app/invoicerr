/**
 * Peppol AP adapter registry tests — resolution, per-vendor config validation,
 * routing-ownership predicate, and PeppolTransmissionProvider wiring (mocked fetch).
 *
 * The wiring section exercises the REAL adapter resolution inside the provider (no
 * injected PeppolApPort) so that a per-company `apProvider` config demonstrably changes
 * which vendor endpoint is called — the multi-provider contract itself.
 */
import { RecordingComplianceLogger } from '../../../execution/logger';
import { SignedArtifact } from '../../../execution/types';
import { TransactionContext } from '../../../canonical/canonical-document';
import { ResolvedChannelConfig } from '../channel-credentials-port';
import { PeppolTransmissionProvider } from '../providers';
import {
  apProviderHandlesRouting,
  apProviderOf,
  missingPeppolConfig,
  resolvePeppolAdapter,
} from './ap-adapters';
import { PeppolApHttpClient } from './peppol-client';
import { PEPPOL_SH_SANDBOX_URL, PeppolShApClient } from './peppol-sh-client';
import { STORECOVE_API_URL, StorecoveApClient } from './storecove-client';

// ---------------------------------------------------------------------------
// Registry unit tests
// ---------------------------------------------------------------------------

describe('apProviderOf / apProviderHandlesRouting', () => {
  it('defaults to generic when apProvider is absent or empty (backward compatibility)', () => {
    expect(apProviderOf({})).toBe('generic');
    expect(apProviderOf({ apProvider: '' })).toBe('generic');
    expect(apProviderOf({ apProvider: 'peppol-sh' })).toBe('peppol-sh');
  });

  it('hosted vendors own the receiver resolution; generic does not', () => {
    expect(apProviderHandlesRouting('generic')).toBe(false);
    expect(apProviderHandlesRouting('peppol-sh')).toBe(true);
    expect(apProviderHandlesRouting('storecove')).toBe(true);
  });
});

describe('missingPeppolConfig', () => {
  it('generic requires participantId + accessPointUrl + apiKey', () => {
    expect(missingPeppolConfig({})).toEqual(['participantId', 'accessPointUrl', 'apiKey']);
    expect(
      missingPeppolConfig({
        participantId: '0009:1',
        accessPointUrl: 'https://ap.example.com',
        apiKey: 'k',
      }),
    ).toEqual([]);
  });

  it('peppol-sh requires apiKey + apCompanyId only', () => {
    expect(missingPeppolConfig({ apProvider: 'peppol-sh' })).toEqual(['apiKey', 'apCompanyId']);
    expect(
      missingPeppolConfig({ apProvider: 'peppol-sh', apiKey: 'ps_test_x', apCompanyId: 'com_1' }),
    ).toEqual([]);
  });

  it('storecove requires apiKey + legalEntityId', () => {
    expect(missingPeppolConfig({ apProvider: 'storecove', apiKey: 'k' })).toEqual(['legalEntityId']);
    expect(missingPeppolConfig({ apProvider: 'storecove', apiKey: 'k', legalEntityId: 42 })).toEqual([]);
  });

  it('flags unknown apProvider values instead of guessing', () => {
    expect(missingPeppolConfig({ apProvider: 'wat' })[0]).toMatch(/unknown value 'wat'/);
  });
});

describe('resolvePeppolAdapter', () => {
  it('builds the generic HTTP client by default', () => {
    const adapter = resolvePeppolAdapter({
      participantId: '0009:1',
      accessPointUrl: 'https://ap.example.com',
      apiKey: 'k',
    });
    expect(adapter).toBeInstanceOf(PeppolApHttpClient);
  });

  it('builds the peppol.sh client for apProvider=peppol-sh', () => {
    const adapter = resolvePeppolAdapter({
      apProvider: 'peppol-sh',
      apiKey: 'ps_test_x',
      apCompanyId: 'com_1',
      environment: 'TEST',
    });
    expect(adapter).toBeInstanceOf(PeppolShApClient);
  });

  it('builds the Storecove client for apProvider=storecove', () => {
    const adapter = resolvePeppolAdapter({
      apProvider: 'storecove',
      apiKey: 'k',
      legalEntityId: '42',
    });
    expect(adapter).toBeInstanceOf(StorecoveApClient);
  });

  it('throws on unknown vendors', () => {
    expect(() => resolvePeppolAdapter({ apProvider: 'wat', apiKey: 'k' })).toThrow(
      /unknown apProvider 'wat'/,
    );
  });
});

// ---------------------------------------------------------------------------
// Provider wiring — per-company apProvider drives the vendor endpoint
// ---------------------------------------------------------------------------

const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => {
  mockFetch.mockReset();
});

function mockJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

// UBL fixture generated with the real EN16931 builder (no hand-written XML) — the
// peppol-sh path parses it, the storecove path forwards it as base64.
let ublXml: string;

beforeAll(async () => {
  const { InvoiceRenderingService } = await import(
    '../../../../modules/invoice-rendering/invoice-rendering.service.js'
  );
  const now = new Date('2026-07-01T10:00:00Z');
  ublXml = await new InvoiceRenderingService()
    .buildEInvoice({
      rawNumber: 'INV-WIRE-1',
      number: null,
      issuedAt: now,
      createdAt: now,
      company: {
        name: 'Seller SAS',
        description: null,
        foundedAt: null,
        currency: 'EUR',
        address: '1 Rue de Test',
        city: 'Paris',
        postalCode: '75001',
        country: 'France',
        email: 'seller@example.com',
        partyIdentifiers: [{ scheme: 'VAT', value: 'FR32123456789' }],
      },
      client: {
        type: 'COMPANY',
        name: 'Buyer GmbH',
        description: null,
        foundedAt: null,
        contactFirstname: null,
        contactLastname: null,
        contactEmail: 'buyer@example.com',
        salutation: null,
        sex: null,
        title: null,
        isActive: true,
        address: 'Käuferstr. 2',
        city: 'Munich',
        postalCode: '80333',
        country: 'Germany',
        partyIdentifiers: [{ scheme: 'VAT', value: 'DE811907980' }],
      },
      items: [{ name: 'Service', quantity: 1, unitPrice: 100, vatRate: 20, type: 'SERVICE' }],
    } as never)
    .exportXml('ubl');
});

function makeArtifact(): SignedArtifact {
  return {
    role: 'AUTHORITATIVE',
    syntax: 'PEPPOL_BIS',
    mime: 'application/xml',
    bytes: Buffer.from(ublXml, 'utf8'),
  };
}

function makeCtx(buyerPeppolId?: string): TransactionContext {
  return {
    supplier: { legalName: 'Seller SAS', countryCode: 'FR', role: 'B2B', identifiers: [] },
    buyer: {
      legalName: 'Buyer GmbH',
      countryCode: 'DE',
      role: 'B2B',
      identifiers: [],
      peppolId: buyerPeppolId,
    },
    lines: [],
    issueDate: new Date('2026-07-01'),
    currency: 'EUR',
    supplierCompanyId: 'company_wire_test',
  } as unknown as TransactionContext;
}

function resolvedConfig(config: Record<string, unknown>): ResolvedChannelConfig {
  return {
    providerId: 'peppol',
    channel: 'PEPPOL',
    environment: 'TEST',
    config: { environment: 'TEST', ...config },
    isActive: true,
  };
}

describe('PeppolTransmissionProvider — multi-provider wiring (no injected port)', () => {
  it('apProvider=peppol-sh sends to sandbox.peppol.sh and never touches the SMP', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ id: 'doc_wire_1', status: 'queued' }, 202));

    const smp = { lookup: jest.fn() };
    const provider = new PeppolTransmissionProvider(undefined, undefined, smp);
    const log = new RecordingComplianceLogger();

    const result = await provider.transmit(
      [makeArtifact()],
      makeCtx('9930:DE811907980'),
      {} as never,
      'wire-key',
      log,
      resolvedConfig({ apProvider: 'peppol-sh', apiKey: 'ps_test_x', apCompanyId: 'com_1' }),
    );

    expect(result.status).toBe('PENDING');
    expect(result.ref).toBe('company_wire_test|doc_wire_1');
    expect(smp.lookup).not.toHaveBeenCalled();
    expect((mockFetch.mock.calls[0] as [string])[0]).toBe(`${PEPPOL_SH_SANDBOX_URL}/v1/documents`);
  });

  it('apProvider=peppol-sh proceeds without a buyer peppolId (tax_id routing)', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ id: 'doc_wire_2', status: 'queued' }, 202));

    const provider = new PeppolTransmissionProvider();
    const result = await provider.transmit(
      [makeArtifact()],
      makeCtx(undefined),
      {} as never,
      'wire-key-2',
      new RecordingComplianceLogger(),
      resolvedConfig({ apProvider: 'peppol-sh', apiKey: 'ps_test_x', apCompanyId: 'com_1' }),
    );

    expect(result.status).toBe('PENDING');
  });

  it('apProvider=storecove sends the raw UBL to api.storecove.com (no SMP pre-check)', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ guid: 'wire-guid-3' }));

    const smp = { lookup: jest.fn() };
    const provider = new PeppolTransmissionProvider(undefined, undefined, smp);

    const result = await provider.transmit(
      [makeArtifact()],
      makeCtx('9930:DE811907980'),
      {} as never,
      'wire-key-3',
      new RecordingComplianceLogger(),
      resolvedConfig({ apProvider: 'storecove', apiKey: 'sc-key', legalEntityId: 42 }),
    );

    expect(result.status).toBe('PENDING');
    expect(result.ref).toBe('company_wire_test|wire-guid-3');
    expect(smp.lookup).not.toHaveBeenCalled();
    expect((mockFetch.mock.calls[0] as [string])[0]).toBe(`${STORECOVE_API_URL}/document_submissions`);
  });

  it('storecove still requires a buyer peppolId (routing.eIdentifiers)', async () => {
    const provider = new PeppolTransmissionProvider();
    const result = await provider.transmit(
      [makeArtifact()],
      makeCtx(undefined),
      {} as never,
      'wire-key-4',
      new RecordingComplianceLogger(),
      resolvedConfig({ apProvider: 'storecove', apiKey: 'sc-key', legalEntityId: 42 }),
    );

    expect(result.status).toBe('SKIPPED');
    expect(result.notes?.join(' ')).toMatch(/no peppolId/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('incomplete per-vendor config → SKIPPED with the vendor named', async () => {
    const provider = new PeppolTransmissionProvider();
    const result = await provider.transmit(
      [makeArtifact()],
      makeCtx('9930:DE811907980'),
      {} as never,
      'wire-key-5',
      new RecordingComplianceLogger(),
      resolvedConfig({ apProvider: 'peppol-sh', apiKey: 'ps_test_x' }), // no apCompanyId
    );

    expect(result.status).toBe('SKIPPED');
    expect(result.notes?.join(' ')).toMatch(/incomplete config for apProvider 'peppol-sh'/);
    expect(result.notes?.join(' ')).toMatch(/apCompanyId/);
  });

  it('poll() resolves the adapter from config: peppol.sh delivered → CLEARED', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ id: 'doc_wire_1', status: 'delivered', events: [] }));

    const credentials = {
      resolve: jest.fn().mockResolvedValue(null),
      resolveActive: jest
        .fn()
        .mockResolvedValue(
          resolvedConfig({ apProvider: 'peppol-sh', apiKey: 'ps_test_x', apCompanyId: 'com_1' }),
        ),
    };
    const provider = new PeppolTransmissionProvider(credentials);

    const result = await provider.poll('company_wire_test|doc_wire_1', new RecordingComplianceLogger());

    expect(result.status).toBe('CLEARED');
    expect((mockFetch.mock.calls[0] as [string])[0]).toBe(
      `${PEPPOL_SH_SANDBOX_URL}/v1/documents/doc_wire_1?company_id=com_1`,
    );
  });

  it('sendStatus() with peppol-sh surfaces the unsupported-IR error on the QUEUED path', async () => {
    const credentials = {
      resolve: jest.fn().mockResolvedValue(null),
      resolveActive: jest
        .fn()
        .mockResolvedValue(
          resolvedConfig({ apProvider: 'peppol-sh', apiKey: 'ps_test_x', apCompanyId: 'com_1' }),
        ),
    };
    const provider = new PeppolTransmissionProvider(credentials);

    const result = await provider.sendStatus(
      'company_wire_test|doc_wire_1',
      'accepted',
      makeCtx('9930:DE811907980'),
      {} as never,
      new RecordingComplianceLogger(),
    );

    expect(result.status).toBe('QUEUED');
    expect(result.notes?.join(' ')).toMatch(/does not support sending Peppol Invoice Responses/);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
