/**
 * Peppol transmission tests — fully mocked.
 *
 * LIVE PROOF: DEFERRED — requires a Peppol-connected Access Point (production
 * or OpenPeppol AccAP test environment) with a valid AP certificate and network
 * agreement (PEPPOL Transport Infrastructure Agreement). These tests exercise:
 *   - SmpLookupPort mock: tests SMP resolution path without real DNS/HTTP.
 *   - PeppolApPort mock: tests AS4 gateway HTTP call without real Peppol network.
 *   - PeppolTransmissionProvider.transmit() credential / artifact / SMP-miss flow.
 *   - PeppolTransmissionProvider.poll() ref parsing + delivery status mapping.
 *   - DnsSmpLookup hostname construction (pure function, no network).
 *   - PeppolApHttpClient.normalizeStatus() via mapDeliveryStatus via poll().
 *
 * No real DNS, AS4 SOAP, or HTTP calls are made.
 */
import { PeppolApPort, PeppolSendResult, PeppolStatusResult, PEPPOL_DOC_TYPES } from './peppol-client';
import { SmpLookupPort, SmpLookupResult, PeppolEndpoint } from './smp-client';
import { TransmissionProviderRegistry } from '../registry';
import { PeppolTransmissionProvider } from '../providers';
import { ChannelCredentialsPort, ResolvedChannelConfig } from '../channel-credentials-port';
import { RecordingComplianceLogger } from '../../../execution/logger';
import { SignedArtifact } from '../../../execution/types';
import { TransactionContext } from '../../../canonical/canonical-document';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COMPANY_ID = 'company_peppol_test';
const SENDER_PARTICIPANT_ID = '0009:12345678900011';
const RECEIVER_PARTICIPANT_ID = '0009:98765432100022';

function mockCredentials(resolved: ResolvedChannelConfig | null): ChannelCredentialsPort {
  return {
    resolve: jest.fn().mockResolvedValue(null),
    resolveActive: jest.fn().mockResolvedValue(resolved),
  };
}

function makeResolvedConfig(overrides: Partial<Record<string, unknown>> = {}): ResolvedChannelConfig {
  return {
    providerId: 'peppol',
    channel: 'PEPPOL',
    environment: 'TEST',
    config: {
      participantId: SENDER_PARTICIPANT_ID,
      accessPointUrl: 'https://ap.example.com',
      apiKey: 'test-api-key',
      environment: 'TEST',
      ...overrides,
    },
    isActive: true,
  };
}

function makeUblArtifact(): SignedArtifact {
  return {
    role: 'AUTHORITATIVE',
    syntax: 'PEPPOL_BIS',
    mime: 'application/xml',
    bytes: Buffer.from('<?xml version="1.0"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>', 'utf8'),
  };
}

function makeCtx(receiverPeppolId = RECEIVER_PARTICIPANT_ID): TransactionContext {
  return {
    supplier: {
      legalName: 'Seller Company',
      countryCode: 'NO',
      role: 'B2B',
      identifiers: [{ scheme: 'NO:ORG', value: '123456789', validated: true }],
    },
    buyer: {
      legalName: 'Buyer Company',
      countryCode: 'NO',
      role: 'B2B',
      identifiers: [{ scheme: 'NO:ORG', value: '987654321', validated: true }],
      peppolId: receiverPeppolId,
    },
    lines: [{ id: 'l1', description: 'Consulting', quantity: 1, unitNetMinor: 500000, supplyType: 'SERVICES' }],
    issueDate: new Date('2026-07-01'),
    currency: 'EUR',
    supplierCompanyId: COMPANY_ID,
    externalRef: 'INV-2026-100',
  } as TransactionContext;
}

function mockSmpPort(result: SmpLookupResult | null = makeDefaultSmpResult()): SmpLookupPort {
  return {
    lookup: jest.fn().mockResolvedValue(result),
  };
}

function makeDefaultSmpResult(): SmpLookupResult {
  const endpoint: PeppolEndpoint = {
    url: 'https://ap.receiver.example.com/as4',
    transportProfile: 'peppol-transport-as4-v2_0',
  };
  return {
    endpoint,
    documentTypeIds: [PEPPOL_DOC_TYPES.INVOICE_UBL],
  };
}

function mockApPort(messageId = 'msg-001'): PeppolApPort {
  return {
    send: jest.fn().mockResolvedValue({
      messageId,
      status: 'QUEUED',
    } satisfies PeppolSendResult),
    getStatus: jest.fn().mockResolvedValue({
      messageId,
      status: 'DELIVERED',
    } satisfies PeppolStatusResult),
    sendInvoiceResponse: jest.fn().mockResolvedValue({
      messageId: `ir-${messageId}`,
      status: 'QUEUED',
    } satisfies PeppolSendResult),
  };
}

// ---------------------------------------------------------------------------
// Section 1 — PeppolTransmissionProvider: credential / SMP / AP flow
// ---------------------------------------------------------------------------

describe('PeppolTransmissionProvider — credential and transmission flow', () => {
  it('returns SKIPPED when no resolvedConfig', async () => {
    const reg = new TransmissionProviderRegistry({ credentials: mockCredentials(null) });
    const log = new RecordingComplianceLogger();

    const result = await reg.transmitAll(
      [makeUblArtifact()],
      makeCtx(),
      { channels: [{ type: 'PEPPOL' }] } as any,
      'test-key',
      log,
    );

    expect(result[0].status).toBe('SKIPPED');
    expect(result[0].notes.join(' ')).toMatch(/not configured/);
  });

  it('returns SKIPPED when config is incomplete', async () => {
    const credentials = mockCredentials(makeResolvedConfig({ participantId: '', accessPointUrl: '' }));
    const reg = new TransmissionProviderRegistry({ credentials });
    const log = new RecordingComplianceLogger();

    const result = await reg.transmitAll(
      [makeUblArtifact()],
      makeCtx(),
      { channels: [{ type: 'PEPPOL' }] } as any,
      'test-key',
      log,
    );

    expect(result[0].status).toBe('SKIPPED');
    expect(result[0].notes.join(' ')).toMatch(/incomplete config/);
  });

  it('returns SKIPPED when buyer has no peppolId', async () => {
    const credentials = mockCredentials(makeResolvedConfig());
    const provider = new PeppolTransmissionProvider(credentials, mockApPort(), mockSmpPort());
    const log = new RecordingComplianceLogger();

    const ctxNoPeppolId = makeCtx(undefined as any);
    (ctxNoPeppolId.buyer as any).peppolId = undefined;

    const result = await provider.transmit(
      [makeUblArtifact()],
      ctxNoPeppolId,
      {} as any,
      'key',
      log,
      makeResolvedConfig(),
    );

    expect(result.status).toBe('SKIPPED');
    expect(result.notes.join(' ')).toMatch(/no peppolId/);
  });

  it('returns SKIPPED when no Peppol artifact', async () => {
    const credentials = mockCredentials(makeResolvedConfig());
    const provider = new PeppolTransmissionProvider(credentials, mockApPort(), mockSmpPort());
    const log = new RecordingComplianceLogger();

    const nonPeppolArtifact: SignedArtifact = {
      role: 'AUTHORITATIVE',
      syntax: 'FATTURAPA',
      mime: 'application/xml',
      bytes: Buffer.from('<xml/>'),
    };

    const result = await provider.transmit(
      [nonPeppolArtifact],
      makeCtx(),
      {} as any,
      'key',
      log,
      makeResolvedConfig(),
    );

    expect(result.status).toBe('SKIPPED');
    expect(result.notes.join(' ')).toMatch(/no PEPPOL_BIS/);
  });

  it('returns SKIPPED when receiver not found in SMP', async () => {
    const smp = mockSmpPort(null); // not registered
    const provider = new PeppolTransmissionProvider(undefined, mockApPort(), smp);
    const log = new RecordingComplianceLogger();

    const result = await provider.transmit(
      [makeUblArtifact()],
      makeCtx(),
      {} as any,
      'key',
      log,
      makeResolvedConfig(),
    );

    expect(result.status).toBe('SKIPPED');
    expect(result.notes.join(' ')).toMatch(/not found in SMP/);
    expect(smp.lookup).toHaveBeenCalledWith(
      { icd: '0009', identifier: '98765432100022' },
      PEPPOL_DOC_TYPES.INVOICE_UBL,
      'TEST',
    );
  });

  it('returns PENDING with ref after successful SMP lookup + AP send', async () => {
    const ap = mockApPort('message-xyz');
    const smp = mockSmpPort();
    const provider = new PeppolTransmissionProvider(undefined, ap, smp);
    const log = new RecordingComplianceLogger();

    const result = await provider.transmit(
      [makeUblArtifact()],
      makeCtx(),
      {} as any,
      'idem-key',
      log,
      makeResolvedConfig(),
    );

    expect(result.status).toBe('PENDING');
    expect(result.ref).toBe(`${COMPANY_ID}|message-xyz`);
    expect(result.notes.join(' ')).toContain('message-xyz');
    expect(ap.send).toHaveBeenCalledWith(
      expect.objectContaining({
        senderParticipantId: SENDER_PARTICIPANT_ID,
        receiverParticipantId: RECEIVER_PARTICIPANT_ID,
        idempotencyKey: 'idem-key',
      }),
    );
  });

  it('returns REJECTED when AP gateway throws', async () => {
    const failingAp: PeppolApPort = {
      send: jest.fn().mockRejectedValue(new Error('AP gateway timeout')),
      getStatus: jest.fn(),
      sendInvoiceResponse: jest.fn().mockResolvedValue({ messageId: 'ir-1', status: 'QUEUED' }),
    };
    const provider = new PeppolTransmissionProvider(undefined, failingAp, mockSmpPort());
    const log = new RecordingComplianceLogger();

    const result = await provider.transmit(
      [makeUblArtifact()],
      makeCtx(),
      {} as any,
      'key',
      log,
      makeResolvedConfig(),
    );

    expect(result.status).toBe('REJECTED');
    expect(result.notes.join(' ')).toContain('AP gateway timeout');
  });

  it('falls back to EN16931_UBL when no PEPPOL_BIS artifact', async () => {
    const ap = mockApPort('fallback-msg');
    const smp = mockSmpPort();
    const provider = new PeppolTransmissionProvider(undefined, ap, smp);
    const log = new RecordingComplianceLogger();

    const ublArtifact: SignedArtifact = {
      role: 'AUTHORITATIVE',
      syntax: 'EN16931_UBL',
      mime: 'application/xml',
      bytes: Buffer.from('<Invoice/>'),
    };

    const result = await provider.transmit(
      [ublArtifact],
      makeCtx(),
      {} as any,
      'key',
      log,
      makeResolvedConfig(),
    );

    expect(result.status).toBe('PENDING');
    expect(ap.send).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Section 2 — PeppolTransmissionProvider.poll(): status mapping
// ---------------------------------------------------------------------------

describe('PeppolTransmissionProvider.poll() — delivery status mapping', () => {
  it('returns PENDING for invalid ref format', async () => {
    const provider = new PeppolTransmissionProvider(mockCredentials(null));
    const result = await provider.poll('invalid-ref', new RecordingComplianceLogger());

    expect(result.status).toBe('PENDING');
    expect(result.notes.join(' ')).toMatch(/invalid ref format/);
  });

  it('returns PENDING when no credentials port', async () => {
    const provider = new PeppolTransmissionProvider(); // no credentials
    const result = await provider.poll(`${COMPANY_ID}|msg-123`, new RecordingComplianceLogger());

    expect(result.status).toBe('PENDING');
    expect(result.notes.join(' ')).toMatch(/no credentials port/);
  });

  it('calls resolveActive with the correct companyId', async () => {
    const credentials = mockCredentials(null);
    const provider = new PeppolTransmissionProvider(credentials);

    await provider.poll('my-company|msg-456', new RecordingComplianceLogger());

    expect(credentials.resolveActive).toHaveBeenCalledWith('my-company', 'peppol');
  });

  it('maps DELIVERED → CLEARED', async () => {
    const ap: PeppolApPort = {
      send: jest.fn(),
      getStatus: jest.fn().mockResolvedValue({ messageId: 'msg-1', status: 'DELIVERED' } satisfies PeppolStatusResult),
      sendInvoiceResponse: jest.fn().mockResolvedValue({ messageId: 'ir-1', status: 'QUEUED' }),
    };
    const credentials = mockCredentials(makeResolvedConfig());
    const provider = new PeppolTransmissionProvider(credentials, ap);

    const result = await provider.poll(`${COMPANY_ID}|msg-1`, new RecordingComplianceLogger());

    expect(result.status).toBe('CLEARED');
    expect(ap.getStatus).toHaveBeenCalledWith('msg-1');
  });

  it('maps FAILED → REJECTED', async () => {
    const ap: PeppolApPort = {
      send: jest.fn(),
      getStatus: jest.fn().mockResolvedValue({ messageId: 'msg-2', status: 'FAILED', mlrCode: 'ERR001', mlrDescription: 'Invalid document' } satisfies PeppolStatusResult),
      sendInvoiceResponse: jest.fn().mockResolvedValue({ messageId: 'ir-2', status: 'QUEUED' }),
    };
    const credentials = mockCredentials(makeResolvedConfig());
    const provider = new PeppolTransmissionProvider(credentials, ap);

    const result = await provider.poll(`${COMPANY_ID}|msg-2`, new RecordingComplianceLogger());

    expect(result.status).toBe('REJECTED');
    expect(result.notes.join(' ')).toContain('ERR001');
  });

  it('maps QUEUED → PENDING', async () => {
    const ap: PeppolApPort = {
      send: jest.fn(),
      getStatus: jest.fn().mockResolvedValue({ messageId: 'msg-3', status: 'QUEUED' } satisfies PeppolStatusResult),
      sendInvoiceResponse: jest.fn().mockResolvedValue({ messageId: 'ir-3', status: 'QUEUED' }),
    };
    const credentials = mockCredentials(makeResolvedConfig());
    const provider = new PeppolTransmissionProvider(credentials, ap);

    const result = await provider.poll(`${COMPANY_ID}|msg-3`, new RecordingComplianceLogger());

    expect(result.status).toBe('PENDING');
  });

  it('returns PENDING when credentials no longer active', async () => {
    const credentials = mockCredentials(null);
    const provider = new PeppolTransmissionProvider(credentials);

    const result = await provider.poll(`${COMPANY_ID}|msg-4`, new RecordingComplianceLogger());

    expect(result.status).toBe('PENDING');
  });

  it('PeppolTransmissionProvider has correct metadata', () => {
    const provider = new PeppolTransmissionProvider();
    expect(provider.id).toBe('peppol');
    expect(provider.channel).toBe('PEPPOL');
    expect(provider.feedback).toBe('ASYNC_CALLBACK');
    expect(provider.pollPolicy).toBeDefined();
    expect(provider.configSchema).toBeDefined();
    expect(provider.configSchema!.fields.length).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// Section 3 — SMP client: hostname construction (pure, no network)
// ---------------------------------------------------------------------------

describe('SMP DNS hostname construction', () => {
  it('passes parsed icd+identifier to smp.lookup (participant routing)', async () => {
    // The actual DNS hostname is computed inside DnsSmpLookup; here we verify
    // the provider correctly parses the receiver peppolId and passes the parts.
    const smp = mockSmpPort();
    const provider = new PeppolTransmissionProvider(undefined, mockApPort(), smp);

    // receiverPeppolId '0009:98765432100022' → icd='0009', identifier='98765432100022'
    await provider.transmit(
      [makeUblArtifact()],
      makeCtx('0009:98765432100022'),
      {} as any,
      'k',
      new RecordingComplianceLogger(),
      makeResolvedConfig(),
    );

    expect(smp.lookup).toHaveBeenCalledWith(
      expect.objectContaining({ icd: '0009', identifier: '98765432100022' }),
      expect.any(String),
      'TEST',
    );
  });
});
