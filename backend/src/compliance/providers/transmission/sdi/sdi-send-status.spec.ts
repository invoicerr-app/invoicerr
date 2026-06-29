/**
 * SdI sendStatus — mocked unit tests.
 *
 * LIVE PROOF: DEFERRED — requires AdE intermediary accreditation + qualified PFX.
 * These tests verify:
 *   - ref parsing (companyId|idSdI|idTrasmittente)
 *   - esito mapping (accept → EC01, refuse/reject → EC02)
 *   - SdiClient.sendEsito() is called via the injected port
 *   - Error handling: invalid ref, missing credentials, port error
 */
import { SdiTransmissionProvider } from '../providers';
import { SdiHttpPort } from './sdi-client';
import { ChannelCredentialsPort, ResolvedChannelConfig } from '../channel-credentials-port';
import { RecordingComplianceLogger } from '../../../execution/logger';

const COMPANY_ID = 'company_sdi_test';
const ID_SDI = 99;
const ID_TRASMITTENTE = 'IT01234567890';
const REF = `${COMPANY_ID}|${ID_SDI}|${ID_TRASMITTENTE}`;

function mockCredentials(resolved: ResolvedChannelConfig | null): ChannelCredentialsPort {
  return {
    resolve: jest.fn().mockResolvedValue(null),
    resolveActive: jest.fn().mockResolvedValue(resolved),
  };
}

function makeResolvedConfig(): ResolvedChannelConfig {
  return {
    providerId: 'sdi',
    channel: 'SDI',
    environment: 'TEST',
    config: {
      idTrasmittente: ID_TRASMITTENTE,
      transmitChannel: 'SDICoop',
      certificate: 'base64cert==',
      certificatePassword: 'pass',
    },
    isActive: true,
  };
}

function mockPort(): SdiHttpPort {
  return {
    submit: jest.fn(),
    getStatus: jest.fn(),
    sendEsito: jest.fn().mockResolvedValue(undefined),
  };
}

describe('SdiTransmissionProvider.sendStatus — mocked', () => {
  it('returns QUEUED when ref is malformed (not 3 parts)', async () => {
    const provider = new SdiTransmissionProvider(mockCredentials(makeResolvedConfig()), mockPort());
    const result = await provider.sendStatus('bad|ref', 'accepted', {} as any, {} as any, new RecordingComplianceLogger());
    expect(result.status).toBe('QUEUED');
    expect(result.notes.join(' ')).toMatch(/invalid ref/);
  });

  it('returns QUEUED when no credentials port', async () => {
    const provider = new SdiTransmissionProvider(); // no credentials
    const result = await provider.sendStatus(REF, 'accepted', {} as any, {} as any, new RecordingComplianceLogger());
    expect(result.status).toBe('QUEUED');
    expect(result.notes.join(' ')).toMatch(/no credentials port/);
  });

  it('returns QUEUED when credentials no longer active', async () => {
    const provider = new SdiTransmissionProvider(mockCredentials(null), mockPort());
    const result = await provider.sendStatus(REF, 'accepted', {} as any, {} as any, new RecordingComplianceLogger());
    expect(result.status).toBe('QUEUED');
    expect(result.notes.join(' ')).toMatch(/no longer active/);
  });

  it('maps "accepted" → EC01 and returns SENT', async () => {
    const port = mockPort();
    const provider = new SdiTransmissionProvider(mockCredentials(makeResolvedConfig()), port);
    const log = new RecordingComplianceLogger();

    const result = await provider.sendStatus(REF, 'accepted by buyer', {} as any, {} as any, log);

    expect(result.status).toBe('SENT');
    expect(result.ref).toBe(REF);
    expect(result.notes.join(' ')).toContain('EC01');
    // SdiClient.sendEsito delegates to http.sendEsito(idSdI, idTrasmittente, esito, descrizione)
    expect(port.sendEsito).toHaveBeenCalledWith(ID_SDI, ID_TRASMITTENTE, 'EC01', undefined);
  });

  it('maps "consegnata" → EC01', async () => {
    const port = mockPort();
    const provider = new SdiTransmissionProvider(mockCredentials(makeResolvedConfig()), port);
    await provider.sendStatus(REF, 'notifica consegnata', {} as any, {} as any, new RecordingComplianceLogger());
    expect(port.sendEsito).toHaveBeenCalledWith(ID_SDI, ID_TRASMITTENTE, 'EC01', undefined);
  });

  it('maps "refused" → EC02', async () => {
    const port = mockPort();
    const provider = new SdiTransmissionProvider(mockCredentials(makeResolvedConfig()), port);
    await provider.sendStatus(REF, 'buyer refused the invoice', {} as any, {} as any, new RecordingComplianceLogger());
    expect(port.sendEsito).toHaveBeenCalledWith(ID_SDI, ID_TRASMITTENTE, 'EC02', undefined);
  });

  it('maps "scartata" → EC02', async () => {
    const port = mockPort();
    const provider = new SdiTransmissionProvider(mockCredentials(makeResolvedConfig()), port);
    await provider.sendStatus(REF, 'notifica scartata', {} as any, {} as any, new RecordingComplianceLogger());
    expect(port.sendEsito).toHaveBeenCalledWith(ID_SDI, ID_TRASMITTENTE, 'EC02', undefined);
  });

  it('returns QUEUED and does not throw when port throws', async () => {
    const port = mockPort();
    (port.sendEsito as jest.MockedFunction<any>).mockRejectedValueOnce(new Error('SOAP connection refused'));
    const provider = new SdiTransmissionProvider(mockCredentials(makeResolvedConfig()), port);

    const result = await provider.sendStatus(REF, 'accepted', {} as any, {} as any, new RecordingComplianceLogger());

    expect(result.status).toBe('QUEUED');
    expect(result.notes.join(' ')).toMatch(/sendStatus error/);
  });

  it('deferred: sendEsito fails without injection (no AdE accreditation)', async () => {
    // No httpPort injected → falls through to the stub that throws
    const provider = new SdiTransmissionProvider(mockCredentials(makeResolvedConfig()));
    const result = await provider.sendStatus(REF, 'accepted', {} as any, {} as any, new RecordingComplianceLogger());
    // Should return QUEUED (caught the throw) with a clear message
    expect(result.status).toBe('QUEUED');
    expect(result.notes.join(' ')).toMatch(/not implemented|AdE|deferred/i);
  });
});
