/**
 * §3.4 DIAN (Colombia) transmission provider tests.
 *
 * Verifies:
 *   - DianTransmissionProvider resolves by id='dian' in the default registry
 *   - transmit() returns SKIPPED when no credentials are configured
 *   - transmit() returns SKIPPED when missing required config fields
 *   - poll() returns PENDING when credentials are absent
 *   - DianClient.mapEstado maps ACEPTADO→CLEARED, RECHAZADO→REJECTED, EN_PROCESO→PENDING
 *   - Full happy-path transmit + poll with an injected mock DianHttpPort
 */
import { DianClient, DianTransmissionProvider } from './dian-client';
import { defaultTransmissionRegistry } from '../registry';
import { RecordingComplianceLogger } from '../../../execution/logger';
import { ChannelCredentialsPort, ResolvedChannelConfig } from '../channel-credentials-port';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCredentials(config: Record<string, unknown> | null): ChannelCredentialsPort {
  const resolved: ResolvedChannelConfig | null = config
    ? { providerId: 'dian', channel: 'GOV_PORTAL_API', environment: 'test', config, isActive: true }
    : null;
  return {
    resolve: jest.fn().mockResolvedValue(null),
    resolveActive: jest.fn().mockResolvedValue(resolved),
  };
}

const DIAN_CONFIG = {
  environment: 'test',
  nit: '9000123456',
  softwareId: 'SW-DIAN-001',
  clientId: 'my-client-id',
  clientSecret: 'my-client-secret',
};

const EN16931_UBL_ARTIFACT = {
  role: 'AUTHORITATIVE' as const,
  syntax: 'EN16931_UBL' as const,
  mime: 'application/xml',
  bytes: Buffer.from('<?xml version="1.0"?><Invoice>test</Invoice>', 'utf8'),
};

function makeCtx(companyId = 'company-co-001') {
  return {
    supplier: { legalName: 'Empresa CO SAS', countryCode: 'CO', role: 'B2B', identifiers: [] },
    buyer: { legalName: 'Comprador SA', countryCode: 'CO', role: 'B2B', identifiers: [] },
    lines: [],
    issueDate: new Date('2025-06-01'),
    currency: 'COP',
    supplierCompanyId: companyId,
  } as any;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe('DIAN portal in default registry', () => {
  it('resolves by providerId "dian"', () => {
    const p = defaultTransmissionRegistry.getById('dian');
    expect(p).toBeDefined();
    expect(p?.id).toBe('dian');
    expect(p?.channel).toBe('GOV_PORTAL_API');
  });

  it('is ASYNC_POLL with a poll policy (clearance is asynchronous)', () => {
    const p = defaultTransmissionRegistry.getById('dian')!;
    expect(p.feedback).toBe('ASYNC_POLL');
    expect(p.pollPolicy).toBeDefined();
  });

  it('exposes a configSchema with required fields', () => {
    const p = defaultTransmissionRegistry.getById('dian')!;
    expect(p.configSchema).toBeDefined();
    const fieldNames = p.configSchema!.fields.map((f) => f.name);
    expect(fieldNames).toContain('nit');
    expect(fieldNames).toContain('softwareId');
    expect(fieldNames).toContain('clientId');
    expect(fieldNames).toContain('clientSecret');
  });
});

// ---------------------------------------------------------------------------
// DianClient.mapEstado
// ---------------------------------------------------------------------------

describe('DianClient.mapEstado', () => {
  it('maps ACEPTADO to CLEARED', () => {
    expect(DianClient.mapEstado('ACEPTADO')).toBe('CLEARED');
    expect(DianClient.mapEstado('aceptado')).toBe('CLEARED');
    expect(DianClient.mapEstado('ACCEPTED')).toBe('CLEARED');
  });

  it('maps RECHAZADO to REJECTED', () => {
    expect(DianClient.mapEstado('RECHAZADO')).toBe('REJECTED');
    expect(DianClient.mapEstado('REJECTED')).toBe('REJECTED');
  });

  it('maps EN_PROCESO and unknown to PENDING', () => {
    expect(DianClient.mapEstado('EN_PROCESO')).toBe('PENDING');
    expect(DianClient.mapEstado('UNKNOWN')).toBe('PENDING');
    expect(DianClient.mapEstado('')).toBe('PENDING');
  });
});

// ---------------------------------------------------------------------------
// transmit() — unconfigured → SKIPPED
// ---------------------------------------------------------------------------

describe('DianTransmissionProvider.transmit() unconfigured', () => {
  it('returns SKIPPED when no credentials are configured', async () => {
    const provider = new DianTransmissionProvider(makeCredentials(null));
    const log = new RecordingComplianceLogger();
    const result = await provider.transmit(
      [EN16931_UBL_ARTIFACT], makeCtx(), {} as any, 'key-1', log,
    );
    expect(result.status).toBe('SKIPPED');
    expect(result.notes.join(' ')).toMatch(/no resolved config/);
  });

  it('returns SKIPPED when config is missing required fields', async () => {
    const provider = new DianTransmissionProvider(
      makeCredentials({ nit: '9000123456' }), // missing softwareId, clientId, clientSecret
    );
    const log = new RecordingComplianceLogger();
    const result = await provider.transmit(
      [EN16931_UBL_ARTIFACT], makeCtx(), {} as any, 'key-2', log,
      { providerId: 'dian', channel: 'GOV_PORTAL_API', environment: 'test', config: { nit: '9000123456' }, isActive: true },
    );
    expect(result.status).toBe('SKIPPED');
    expect(result.notes.join(' ')).toMatch(/incomplete config/);
  });

  it('returns SKIPPED when no EN16931_UBL artifact is present', async () => {
    const provider = new DianTransmissionProvider(makeCredentials(DIAN_CONFIG));
    const log = new RecordingComplianceLogger();
    const result = await provider.transmit(
      [], makeCtx(), {} as any, 'key-3', log,
      { providerId: 'dian', channel: 'GOV_PORTAL_API', environment: 'test', config: DIAN_CONFIG, isActive: true },
    );
    expect(result.status).toBe('SKIPPED');
    expect(result.notes.join(' ')).toMatch(/no EN16931_UBL artifact/);
  });
});

// ---------------------------------------------------------------------------
// transmit() — happy path with injected HTTP port
// ---------------------------------------------------------------------------

describe('DianTransmissionProvider.transmit() with mock HTTP port', () => {
  it('returns PENDING with ref containing trackId', async () => {
    const mockHttp = {
      getToken: jest.fn().mockResolvedValue({ access_token: 'tok', expires_in: 3600 }),
      sendDocument: jest.fn().mockResolvedValue({ trackId: 'TRK-001', cufe: 'abc123cufe' }),
      getStatus: jest.fn().mockResolvedValue({ estado: 'EN_PROCESO' }),
    };

    const provider = new DianTransmissionProvider(makeCredentials(DIAN_CONFIG), mockHttp);
    const log = new RecordingComplianceLogger();

    const result = await provider.transmit(
      [EN16931_UBL_ARTIFACT], makeCtx(), {} as any, 'key-4', log,
      { providerId: 'dian', channel: 'GOV_PORTAL_API', environment: 'test', config: DIAN_CONFIG, isActive: true },
    );

    expect(result.status).toBe('PENDING');
    expect(result.ref).toContain('TRK-001');
    expect(result.notes.join(' ')).toContain('trackId: TRK-001');
    expect(result.authorityIds?.find((a) => a.scheme === 'CUFE')).toEqual({ scheme: 'CUFE', value: 'abc123cufe' });
    expect(mockHttp.getToken).toHaveBeenCalledTimes(1);
    expect(mockHttp.sendDocument).toHaveBeenCalledTimes(1);
  });

  it('returns CLEARED immediately when DIAN responds ACEPTADO on submit', async () => {
    const mockHttp = {
      getToken: jest.fn().mockResolvedValue({ access_token: 'tok', expires_in: 3600 }),
      sendDocument: jest.fn().mockResolvedValue({ trackId: 'TRK-002', cufe: 'cufe-xyz', estado: 'ACEPTADO' }),
      getStatus: jest.fn().mockResolvedValue({ estado: 'ACEPTADO', cufe: 'cufe-xyz' }),
    };

    const provider = new DianTransmissionProvider(makeCredentials(DIAN_CONFIG), mockHttp);
    const log = new RecordingComplianceLogger();

    const result = await provider.transmit(
      [EN16931_UBL_ARTIFACT], makeCtx(), {} as any, 'key-5', log,
      { providerId: 'dian', channel: 'GOV_PORTAL_API', environment: 'test', config: DIAN_CONFIG, isActive: true },
    );

    expect(result.status).toBe('CLEARED');
    expect(result.authorityIds?.find((a) => a.scheme === 'CUFE')?.value).toBe('cufe-xyz');
  });
});

// ---------------------------------------------------------------------------
// poll() tests
// ---------------------------------------------------------------------------

describe('DianTransmissionProvider.poll()', () => {
  it('returns PENDING when credentials are absent', async () => {
    const provider = new DianTransmissionProvider(makeCredentials(null));
    const log = new RecordingComplianceLogger();
    const result = await provider.poll('company-co|TRK-001', log);
    expect(result.status).toBe('PENDING');
  });

  it('returns CLEARED when DIAN responds ACEPTADO on poll', async () => {
    const mockHttp = {
      getToken: jest.fn().mockResolvedValue({ access_token: 'tok', expires_in: 3600 }),
      sendDocument: jest.fn().mockResolvedValue({ trackId: 'TRK-003' }),
      getStatus: jest.fn().mockResolvedValue({ estado: 'ACEPTADO', cufe: 'cufe-poll' }),
    };

    const provider = new DianTransmissionProvider(makeCredentials(DIAN_CONFIG), mockHttp);
    const log = new RecordingComplianceLogger();

    const result = await provider.poll('company-co|TRK-003', log);
    expect(result.status).toBe('CLEARED');
    expect(result.authorityIds?.find((a) => a.scheme === 'CUFE')?.value).toBe('cufe-poll');
    expect(result.notes.join(' ')).toContain('ACEPTADO');
  });

  it('returns REJECTED when DIAN responds RECHAZADO on poll', async () => {
    const mockHttp = {
      getToken: jest.fn().mockResolvedValue({ access_token: 'tok', expires_in: 3600 }),
      sendDocument: jest.fn().mockResolvedValue({ trackId: 'TRK-004' }),
      getStatus: jest.fn().mockResolvedValue({ estado: 'RECHAZADO', errors: ['Invalid NIT'] }),
    };

    const provider = new DianTransmissionProvider(makeCredentials(DIAN_CONFIG), mockHttp);
    const log = new RecordingComplianceLogger();

    const result = await provider.poll('company-co|TRK-004', log);
    expect(result.status).toBe('REJECTED');
    expect(result.notes.join(' ')).toContain('RECHAZADO');
  });

  it('handles invalid ref gracefully', async () => {
    const provider = new DianTransmissionProvider(makeCredentials(DIAN_CONFIG));
    const log = new RecordingComplianceLogger();
    const result = await provider.poll('invalid-ref-no-pipe', log);
    expect(result.status).toBe('PENDING');
    expect(result.notes.join(' ')).toContain('invalid ref format');
  });
});
