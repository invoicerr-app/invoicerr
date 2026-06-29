/**
 * SdI (Sistema di Interscambio) transmission tests — fully mocked.
 *
 * LIVE PROOF: DEFERRED — requires AdE (Agenzia delle Entrate) intermediary accreditation
 * and a qualified PFX digital certificate before a real SDICoop round-trip can be attempted.
 * These tests exercise:
 *   - SdiClient.mapNotifica() for all six notifica types (RC/NS/MC/NE/DT/AT)
 *   - SdiTransmissionProvider.transmit() credential/artifact flow
 *   - SdiTransmissionProvider.poll() ref parsing + credential resolution
 *
 * No real SOAP calls are made.
 */
import { SdiClient, SdiHttpPort, SdiNotifica, SdiSubmitResult, SdiStatusResult } from './sdi-client';
import { TransmissionProviderRegistry } from '../registry';
import { SdiTransmissionProvider } from '../providers';
import { ChannelCredentialsPort, ResolvedChannelConfig } from '../channel-credentials-port';
import { RecordingComplianceLogger } from '../../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../../execution/types';
import { TransactionContext } from '../../../canonical/canonical-document';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COMPANY_ID = 'company_sdi_test';
const ID_TRASMITTENTE = 'IT01234567890';

function mockCredentials(resolved: ResolvedChannelConfig | null): ChannelCredentialsPort {
  return {
    resolve: jest.fn().mockResolvedValue(null),
    resolveActive: jest.fn().mockResolvedValue(resolved),
  };
}

function makeResolvedConfig(overrides: Partial<Record<string, unknown>> = {}): ResolvedChannelConfig {
  return {
    providerId: 'sdi',
    channel: 'SDI',
    environment: 'TEST',
    config: {
      idTrasmittente: ID_TRASMITTENTE,
      transmitChannel: 'SDICoop',
      certificate: 'base64encodedcert==',
      certificatePassword: 'cert-pass',
      ...overrides,
    },
    isActive: true,
  };
}

function makeFatturapaArtifact(): SignedArtifact {
  return {
    role: 'AUTHORITATIVE',
    syntax: 'FATTURAPA',
    mime: 'application/xml',
    bytes: Buffer.from('<?xml version="1.0"?><FatturaElettronica versione="FPR12"><FatturaElettronicaHeader/></FatturaElettronica>', 'utf8'),
  };
}

function makeCtx(companyId = COMPANY_ID): TransactionContext {
  return {
    supplier: {
      legalName: 'Fornitore SRL',
      countryCode: 'IT',
      role: 'B2B',
      identifiers: [{ scheme: 'IT_CF', value: '01234567890', validated: true }],
    },
    buyer: {
      legalName: 'Acquirente SPA',
      countryCode: 'IT',
      role: 'B2B',
      identifiers: [{ scheme: 'IT_CF', value: '09876543210', validated: true }],
    },
    lines: [{ id: 'l1', description: 'Servizio', quantity: 1, unitNetMinor: 100000, supplyType: 'SERVICES' }],
    issueDate: new Date('2026-07-01'),
    currency: 'EUR',
    supplierCompanyId: companyId,
    externalRef: 'FATT-2026-001',
  } as TransactionContext;
}

/** Mock SdiHttpPort that succeeds. */
function mockSdiHttpPort(idSdI = 12345): SdiHttpPort {
  return {
    submit: jest.fn().mockResolvedValue({
      idSdI,
      idTrasmittente: ID_TRASMITTENTE,
      filename: `${ID_TRASMITTENTE}_00001.xml`,
    } satisfies SdiSubmitResult),
    getStatus: jest.fn().mockResolvedValue({
      delivered: false,
      latestNotifica: undefined,
    } satisfies SdiStatusResult),
  };
}

// ---------------------------------------------------------------------------
// Section 1 — SdiClient.mapNotifica: all six notifica types
// ---------------------------------------------------------------------------

describe('SdiClient.mapNotifica — all SdI notifica types', () => {
  const makeNotifica = (type: SdiNotifica['type'], extras: Partial<SdiNotifica> = {}): SdiNotifica => ({
    type,
    idSdI: 99,
    dataOraRicezione: '2026-07-01T10:00:00Z',
    ...extras,
  });

  const REF = 'company1|99|IT01234567890';

  it('RC (Ricevuta di Consegna) → CLEARED', () => {
    const result = SdiClient.mapNotifica(makeNotifica('RC'), REF);
    expect(result.status).toBe('CLEARED');
    expect(result.channel).toBe('SDI');
    expect(result.notes.join(' ')).toContain('RC');
  });

  it('NS (Notifica di Scarto) → REJECTED with error detail', () => {
    const result = SdiClient.mapNotifica(
      makeNotifica('NS', { descrizioneErrore: 'Schema validation failed: missing cedente' }),
      REF,
    );
    expect(result.status).toBe('REJECTED');
    expect(result.notes.join(' ')).toContain('Schema validation failed');
  });

  it('MC (Mancata Consegna) → PENDING', () => {
    const result = SdiClient.mapNotifica(makeNotifica('MC'), REF);
    expect(result.status).toBe('PENDING');
    expect(result.notes.join(' ')).toContain('15 days');
  });

  it('NE EC01 (buyer accepted) → CLEARED', () => {
    const result = SdiClient.mapNotifica(
      makeNotifica('NE', { esitoCommittente: 'EC01' }),
      REF,
    );
    expect(result.status).toBe('CLEARED');
    expect(result.notes.join(' ')).toContain('EC01');
  });

  it('NE EC02 (buyer refused) → REJECTED', () => {
    const result = SdiClient.mapNotifica(
      makeNotifica('NE', { esitoCommittente: 'EC02' }),
      REF,
    );
    expect(result.status).toBe('REJECTED');
    expect(result.notes.join(' ')).toContain('EC02');
  });

  it('NE without esitoCommittente → PENDING (outcome pending)', () => {
    const result = SdiClient.mapNotifica(makeNotifica('NE'), REF);
    expect(result.status).toBe('PENDING');
  });

  it('DT (Decorrenza Termini) → CLEARED', () => {
    const result = SdiClient.mapNotifica(makeNotifica('DT'), REF);
    expect(result.status).toBe('CLEARED');
    expect(result.notes.join(' ')).toContain('15 days');
  });

  it('AT (Avvenuta Trasmissione) → CLEARED', () => {
    const result = SdiClient.mapNotifica(makeNotifica('AT'), REF);
    expect(result.status).toBe('CLEARED');
    expect(result.notes.join(' ')).toContain('avvenuta trasmissione');
  });

  it('all notifiche include idSdI in notes', () => {
    for (const type of ['RC', 'NS', 'MC', 'NE', 'DT', 'AT'] as const) {
      const result = SdiClient.mapNotifica(makeNotifica(type, { idSdI: 42 }), REF);
      expect(result.notes.join(' ')).toContain('42');
    }
  });
});

// ---------------------------------------------------------------------------
// Section 2 — SdiTransmissionProvider: credential / artifact flow
// ---------------------------------------------------------------------------

describe('SdiTransmissionProvider — credential and artifact flow', () => {
  it('returns SKIPPED when no resolvedConfig', async () => {
    const reg = new TransmissionProviderRegistry({ credentials: mockCredentials(null) });
    const log = new RecordingComplianceLogger();

    const result = await reg.transmitAll(
      [makeFatturapaArtifact()],
      makeCtx(),
      { channels: [{ type: 'SDI' }] } as any,
      'test-key',
      log,
    );

    expect(result[0].status).toBe('SKIPPED');
    expect(result[0].notes.join(' ')).toMatch(/not configured/);
  });

  it('returns SKIPPED when no FATTURAPA artifact', async () => {
    const reg = new TransmissionProviderRegistry({ credentials: mockCredentials(makeResolvedConfig()) });
    const log = new RecordingComplianceLogger();

    const noFatturaArtifact: SignedArtifact = {
      role: 'AUTHORITATIVE',
      syntax: 'EN16931_CII',
      mime: 'application/xml',
      bytes: Buffer.from('<xml/>'),
    };

    const result = await reg.transmitAll(
      [noFatturaArtifact],
      makeCtx(),
      { channels: [{ type: 'SDI' }] } as any,
      'test-key',
      log,
    );

    expect(result[0].status).toBe('SKIPPED');
    expect(result[0].notes.join(' ')).toMatch(/no FATTURAPA/);
  });

  it('returns SKIPPED when idTrasmittente is missing from config', async () => {
    const credentials = mockCredentials(makeResolvedConfig({ idTrasmittente: '' }));
    const reg = new TransmissionProviderRegistry({ credentials });
    const log = new RecordingComplianceLogger();

    const result = await reg.transmitAll(
      [makeFatturapaArtifact()],
      makeCtx(),
      { channels: [{ type: 'SDI' }] } as any,
      'test-key',
      log,
    );

    expect(result[0].status).toBe('SKIPPED');
    expect(result[0].notes.join(' ')).toMatch(/idTrasmittente/);
  });

  it('submits via mock SdiHttpPort and returns PENDING with ref', async () => {
    const http = mockSdiHttpPort(55555);
    const provider = new SdiTransmissionProvider(mockCredentials(makeResolvedConfig()), http);
    const log = new RecordingComplianceLogger();

    const result = await provider.transmit(
      [makeFatturapaArtifact()],
      makeCtx(),
      {} as any,
      'test-key',
      log,
      makeResolvedConfig(),
    );

    expect(result.status).toBe('PENDING');
    expect(result.ref).toContain(COMPANY_ID);
    expect(result.ref).toContain('55555'); // idSdI
    expect(result.ref).toContain(ID_TRASMITTENTE);
    expect(http.submit).toHaveBeenCalledTimes(1);
  });

  it('returns REJECTED when HTTP port throws', async () => {
    const failingHttp: SdiHttpPort = {
      submit: jest.fn().mockRejectedValue(new Error('SOAP connection refused')),
      getStatus: jest.fn(),
    };
    const provider = new SdiTransmissionProvider(undefined, failingHttp);
    const log = new RecordingComplianceLogger();

    const result = await provider.transmit(
      [makeFatturapaArtifact()],
      makeCtx(),
      {} as any,
      'test-key',
      log,
      makeResolvedConfig(),
    );

    expect(result.status).toBe('REJECTED');
    expect(result.notes.join(' ')).toContain('SOAP connection refused');
  });

  it('REJECTED result when no httpPort injected (AdE accreditation stub)', async () => {
    // No httpPort → uses the default stub that throws "not implemented"
    const provider = new SdiTransmissionProvider(undefined, undefined);
    const log = new RecordingComplianceLogger();

    const result = await provider.transmit(
      [makeFatturapaArtifact()],
      makeCtx(),
      {} as any,
      'test-key',
      log,
      makeResolvedConfig(),
    );

    expect(result.status).toBe('REJECTED');
    expect(result.notes.join(' ')).toMatch(/accreditation|not implemented/i);
  });
});

// ---------------------------------------------------------------------------
// Section 3 — SdiTransmissionProvider.poll(): ref parsing + credential resolution
// ---------------------------------------------------------------------------

describe('SdiTransmissionProvider.poll() — ref parsing and credential resolution', () => {
  it('returns PENDING for invalid ref format', async () => {
    const provider = new SdiTransmissionProvider(mockCredentials(null));
    const result = await provider.poll('bad-ref', new RecordingComplianceLogger());

    expect(result.status).toBe('PENDING');
    expect(result.notes.join(' ')).toMatch(/invalid ref format/);
  });

  it('returns PENDING when no credentials port', async () => {
    const provider = new SdiTransmissionProvider(); // no credentials
    const result = await provider.poll(`${COMPANY_ID}|99|${ID_TRASMITTENTE}`, new RecordingComplianceLogger());

    expect(result.status).toBe('PENDING');
    expect(result.notes.join(' ')).toMatch(/no credentials port/);
  });

  it('calls resolveActive with correct companyId', async () => {
    const credentials = mockCredentials(null);
    const provider = new SdiTransmissionProvider(credentials);

    await provider.poll(`my-company|12345|IT01234567890`, new RecordingComplianceLogger());

    expect(credentials.resolveActive).toHaveBeenCalledWith('my-company', 'sdi');
  });

  it('returns PENDING when credentials no longer active', async () => {
    const credentials = mockCredentials(null);
    const provider = new SdiTransmissionProvider(credentials);

    const result = await provider.poll(`${COMPANY_ID}|99|${ID_TRASMITTENTE}`, new RecordingComplianceLogger());

    expect(result.status).toBe('PENDING');
    expect(result.notes.join(' ')).toMatch(/credentials no longer active|accreditation|poll error/);
  });

  it('maps notifica RC to CLEARED on poll with mock port', async () => {
    const http: SdiHttpPort = {
      submit: jest.fn(),
      getStatus: jest.fn().mockResolvedValue({
        delivered: true,
        latestNotifica: {
          type: 'RC',
          idSdI: 99,
          dataOraRicezione: '2026-07-01T12:00:00Z',
        } satisfies SdiNotifica,
      } satisfies SdiStatusResult),
    };
    const credentials = mockCredentials(makeResolvedConfig());
    const provider = new SdiTransmissionProvider(credentials, http);

    const result = await provider.poll(`${COMPANY_ID}|99|${ID_TRASMITTENTE}`, new RecordingComplianceLogger());

    expect(result.status).toBe('CLEARED');
    expect(http.getStatus).toHaveBeenCalledWith(99, ID_TRASMITTENTE);
  });

  it('returns PENDING when no notifica received yet', async () => {
    const http: SdiHttpPort = {
      submit: jest.fn(),
      getStatus: jest.fn().mockResolvedValue({
        delivered: false,
        latestNotifica: undefined,
      } satisfies SdiStatusResult),
    };
    const credentials = mockCredentials(makeResolvedConfig());
    const provider = new SdiTransmissionProvider(credentials, http);

    const result = await provider.poll(`${COMPANY_ID}|99|${ID_TRASMITTENTE}`, new RecordingComplianceLogger());

    expect(result.status).toBe('PENDING');
    expect(result.notes.join(' ')).toContain('no notifica');
  });

  it('SdiTransmissionProvider has correct metadata', () => {
    const provider = new SdiTransmissionProvider();
    expect(provider.id).toBe('sdi');
    expect(provider.channel).toBe('SDI');
    expect(provider.feedback).toBe('ASYNC_CALLBACK');
    expect(provider.pollPolicy).toBeDefined();
    expect(provider.configSchema).toBeDefined();
    expect(provider.configSchema!.fields.length).toBeGreaterThanOrEqual(4);
  });
});
