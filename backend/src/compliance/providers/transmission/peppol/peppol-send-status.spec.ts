/**
 * Peppol sendStatus (Invoice Response / MLR) — mocked unit tests.
 *
 * LIVE PROOF: DEFERRED — requires a connected Peppol Access Point.
 * These tests verify:
 *   - ref parsing (companyId|messageId)
 *   - response code mapping (accept → AB, reject → RE, dispute → UQ)
 *   - PeppolApPort.sendInvoiceResponse() is called correctly
 *   - Error handling: invalid ref, missing credentials, AP error
 */
import { PeppolTransmissionProvider } from '../providers';
import { PeppolApPort, PeppolInvoiceResponseRequest, PeppolSendResult } from './peppol-client';
import { SmpLookupPort } from './smp-client';
import { ChannelCredentialsPort, ResolvedChannelConfig } from '../channel-credentials-port';
import { RecordingComplianceLogger } from '../../../execution/logger';
import { TransactionContext } from '../../../canonical/canonical-document';

const COMPANY_ID = 'company_peppol_test';
const MESSAGE_ID = 'msg-abc-123';
const REF = `${COMPANY_ID}|${MESSAGE_ID}`;

const SENDER_PARTICIPANT_ID = '0009:12345678900011';
const RECEIVER_PARTICIPANT_ID = '0009:98765432100022';

function mockCredentials(resolved: ResolvedChannelConfig | null): ChannelCredentialsPort {
  return {
    resolve: jest.fn().mockResolvedValue(null),
    resolveActive: jest.fn().mockResolvedValue(resolved),
  };
}

function makeResolvedConfig(): ResolvedChannelConfig {
  return {
    providerId: 'peppol',
    channel: 'PEPPOL',
    environment: 'TEST',
    config: {
      participantId: SENDER_PARTICIPANT_ID,
      accessPointUrl: 'https://ap.example.com',
      apiKey: 'api-key',
      environment: 'TEST',
    },
    isActive: true,
  };
}

function makeCtx(buyerPeppolId?: string): TransactionContext {
  return {
    supplier: {
      legalName: 'Seller',
      countryCode: 'NO',
      role: 'B2B',
      identifiers: [],
      peppolId: SENDER_PARTICIPANT_ID,
    },
    buyer: {
      legalName: 'Buyer',
      countryCode: 'NO',
      role: 'B2B',
      identifiers: [],
      peppolId: buyerPeppolId ?? RECEIVER_PARTICIPANT_ID,
    },
    lines: [],
    issueDate: new Date('2026-07-01'),
    currency: 'EUR',
  } as TransactionContext;
}

function mockApPort(): PeppolApPort {
  return {
    send: jest.fn(),
    getStatus: jest.fn(),
    sendInvoiceResponse: jest.fn().mockResolvedValue({ messageId: 'ir-resp-1', status: 'QUEUED' } satisfies PeppolSendResult),
  };
}

describe('PeppolTransmissionProvider.sendStatus — mocked', () => {
  it('returns QUEUED when ref is malformed (not 2 parts)', async () => {
    const provider = new PeppolTransmissionProvider(mockCredentials(makeResolvedConfig()));
    const result = await provider.sendStatus('bad-ref', 'accepted', makeCtx(), {} as any, new RecordingComplianceLogger());
    expect(result.status).toBe('QUEUED');
    expect(result.notes.join(' ')).toMatch(/invalid ref/);
  });

  it('returns QUEUED when no credentials port', async () => {
    const provider = new PeppolTransmissionProvider(); // no credentials
    const result = await provider.sendStatus(REF, 'accepted', makeCtx(), {} as any, new RecordingComplianceLogger());
    expect(result.status).toBe('QUEUED');
    expect(result.notes.join(' ')).toMatch(/no credentials port/);
  });

  it('returns QUEUED when credentials no longer active', async () => {
    const provider = new PeppolTransmissionProvider(mockCredentials(null));
    const result = await provider.sendStatus(REF, 'accepted', makeCtx(), {} as any, new RecordingComplianceLogger());
    expect(result.status).toBe('QUEUED');
    expect(result.notes.join(' ')).toMatch(/no longer active/);
  });

  it('returns QUEUED when no peppolId on buyer or supplier', async () => {
    // Implementation falls back to ctx.supplier.peppolId when buyer has none.
    // Only returns QUEUED when BOTH parties lack a peppolId.
    const provider = new PeppolTransmissionProvider(mockCredentials(makeResolvedConfig()), mockApPort());
    const ctxNoPeppol: TransactionContext = {
      ...makeCtx(),
      supplier: { legalName: 'Seller', countryCode: 'NO', role: 'B2B', identifiers: [] },
      buyer: { legalName: 'Buyer', countryCode: 'NO', role: 'B2B', identifiers: [] },
    } as TransactionContext;
    const result = await provider.sendStatus(REF, 'accepted', ctxNoPeppol, {} as any, new RecordingComplianceLogger());
    expect(result.status).toBe('QUEUED');
    expect(result.notes.join(' ')).toContain('peppolId');
  });

  it('maps "accept" → AB and calls sendInvoiceResponse correctly', async () => {
    const ap = mockApPort();
    const provider = new PeppolTransmissionProvider(mockCredentials(makeResolvedConfig()), ap);
    const log = new RecordingComplianceLogger();

    const result = await provider.sendStatus(REF, 'accepted by buyer', makeCtx(), {} as any, log);

    expect(result.status).toBe('SENT');
    expect(result.ref).toBe(REF);
    expect(result.notes.join(' ')).toContain('AB');
    expect(ap.sendInvoiceResponse).toHaveBeenCalledWith(
      expect.objectContaining<Partial<PeppolInvoiceResponseRequest>>({
        senderParticipantId: SENDER_PARTICIPANT_ID,
        receiverParticipantId: RECEIVER_PARTICIPANT_ID,
        originalMessageId: MESSAGE_ID,
        responseCode: 'AB',
      }),
    );
  });

  it('maps "rejected" → RE', async () => {
    const ap = mockApPort();
    const provider = new PeppolTransmissionProvider(mockCredentials(makeResolvedConfig()), ap);
    await provider.sendStatus(REF, 'invoice rejected', makeCtx(), {} as any, new RecordingComplianceLogger());
    expect(ap.sendInvoiceResponse).toHaveBeenCalledWith(expect.objectContaining({ responseCode: 'RE' }));
  });

  it('maps "dispute" → UQ', async () => {
    const ap = mockApPort();
    const provider = new PeppolTransmissionProvider(mockCredentials(makeResolvedConfig()), ap);
    await provider.sendStatus(REF, 'invoice in dispute', makeCtx(), {} as any, new RecordingComplianceLogger());
    expect(ap.sendInvoiceResponse).toHaveBeenCalledWith(expect.objectContaining({ responseCode: 'UQ' }));
  });

  it('maps unknown status → AP (in process)', async () => {
    const ap = mockApPort();
    const provider = new PeppolTransmissionProvider(mockCredentials(makeResolvedConfig()), ap);
    await provider.sendStatus(REF, 'unknown status', makeCtx(), {} as any, new RecordingComplianceLogger());
    expect(ap.sendInvoiceResponse).toHaveBeenCalledWith(expect.objectContaining({ responseCode: 'AP' }));
  });

  it('returns QUEUED and does not throw when AP port throws', async () => {
    const ap = mockApPort();
    (ap.sendInvoiceResponse as jest.MockedFunction<any>).mockRejectedValueOnce(new Error('AP gateway down'));
    const provider = new PeppolTransmissionProvider(mockCredentials(makeResolvedConfig()), ap);

    const result = await provider.sendStatus(REF, 'accepted', makeCtx(), {} as any, new RecordingComplianceLogger());

    expect(result.status).toBe('QUEUED');
    expect(result.notes.join(' ')).toMatch(/sendStatus error/);
  });
});
