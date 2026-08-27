/**
 * FaceTransmissionProvider tests — fully mocked (no real SOAP calls).
 *
 * LIVE PROOF: DEFERRED — requires a real FACe-registered certificate + a working WS-Security
 * XML-DSig signing implementation before a real SSPP round-trip can be attempted (see
 * face-client.ts header). These tests exercise:
 *   - the F-6/F-8 honesty guard: transmit() with no FaceHttpPort injected → SKIPPED, never
 *     SENT/PENDING (COMPLIANCE_AUDIT.md).
 *   - the credential/artifact flow (mirrors sdi-transmission.spec.ts's structure).
 *   - transmit()/poll() against a mocked FaceHttpPort.
 *   - registry resolution by providerId='es-face'.
 */
import { TransactionContext } from '../../canonical/canonical-document';
import { RecordingComplianceLogger } from '../../execution/logger';
import { SignedArtifact } from '../../execution/types';
import { ChannelCredentialsPort, ResolvedChannelConfig } from './channel-credentials-port';
import { TransmissionProviderRegistry } from './registry';
import { FaceHttpPort } from './face-client';
import { FaceTransmissionProvider } from './face-transmission';

const COMPANY_ID = 'company_face_test';

function mockCredentials(resolved: ResolvedChannelConfig | null): ChannelCredentialsPort {
  return {
    resolve: jest.fn().mockResolvedValue(null),
    resolveActive: jest.fn().mockResolvedValue(resolved),
  };
}

function makeResolvedConfig(overrides: Partial<Record<string, unknown>> = {}): ResolvedChannelConfig {
  return {
    providerId: 'es-face',
    channel: 'GOV_PORTAL_API',
    environment: 'TEST',
    config: {
      environment: 'test',
      certificate: 'base64encodedpkcs12==',
      certificatePassword: 'cert-pass',
      notificationEmail: 'facturacion@empresa.es',
      ...overrides,
    },
    isActive: true,
  };
}

function makeFacturaeArtifact(): SignedArtifact {
  return {
    role: 'AUTHORITATIVE',
    syntax: 'ES_FACTURAE',
    mime: 'application/xml',
    bytes: Buffer.from('<?xml version="1.0"?><fe:Facturae xmlns:fe="Facturaev3.2.2"/>', 'utf8'),
  };
}

// Note: a JS default parameter also kicks in for an explicit `undefined` argument (not just a
// missing one), so `companyId = COMPANY_ID` would silently swallow `makeCtx(undefined)` below —
// no default here; every call site must pass its intent explicitly.
function makeCtx(companyId: string | undefined): TransactionContext {
  return {
    supplier: {
      legalName: 'Proveedor SL',
      countryCode: 'ES',
      role: 'B2G',
      identifiers: [{ scheme: 'VAT', value: 'ESB12345678', validated: true }],
    },
    buyer: {
      legalName: 'Ayuntamiento de Ejemplo',
      countryCode: 'ES',
      role: 'B2G',
      identifiers: [{ scheme: 'VAT', value: 'ESQ1234567A', validated: true }],
    },
    lines: [{ id: 'l1', description: 'Servicio', quantity: 1, unitNetMinor: 100000, supplyType: 'SERVICES' }],
    issueDate: new Date('2026-07-01'),
    currency: 'EUR',
    supplierCompanyId: companyId,
    externalRef: 'FACT-2026-001',
  } as TransactionContext;
}

const ENVIAR_FACTURA_OK_XML =
  '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>' +
  '<enviarFacturaResponse xmlns="https://webservice.face.gob.es"><return>' +
  '<resultado><codigo>0</codigo><descripcion>Correcto</descripcion></resultado>' +
  '<factura><numeroRegistro>2026/000000042</numeroRegistro></factura>' +
  '</return></enviarFacturaResponse></soapenv:Body></soapenv:Envelope>';

const ENVIAR_FACTURA_ERROR_XML =
  '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>' +
  '<enviarFacturaResponse xmlns="https://webservice.face.gob.es"><return>' +
  '<resultado><codigo>033</codigo><descripcion>El certificado de la firma está caducado</descripcion></resultado>' +
  '</return></enviarFacturaResponse></soapenv:Body></soapenv:Envelope>';

function consultarFacturaXml(codigo: string, descripcion: string): string {
  return (
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>' +
    '<consultarFacturaResponse xmlns="https://webservice.face.gob.es"><return>' +
    '<resultado><codigo>0</codigo><descripcion/></resultado>' +
    '<factura><numeroRegistro>2026/000000042</numeroRegistro>' +
    `<tramitacion><codigo>${codigo}</codigo><descripcion>${descripcion}</descripcion></tramitacion>` +
    '<anulacion><codigo>4100</codigo><descripcion>No solicita anulación</descripcion></anulacion>' +
    '</factura></return></consultarFacturaResponse></soapenv:Body></soapenv:Envelope>'
  );
}

function mockFaceHttp(responses: { status: number; data: string }[]): FaceHttpPort & { post: jest.Mock } {
  const post = jest.fn();
  for (const r of responses) post.mockResolvedValueOnce(r);
  return { post };
}

describe('FaceTransmissionProvider.transmit — F-6/F-8 honesty guard', () => {
  it('returns SKIPPED (never SENT/PENDING) when no FaceHttpPort is injected, even with full config', async () => {
    const provider = new FaceTransmissionProvider(mockCredentials(makeResolvedConfig()) /* no httpPort */);
    const log = new RecordingComplianceLogger();

    const result = await provider.transmit(
      [makeFacturaeArtifact()],
      makeCtx(COMPANY_ID),
      {} as never,
      'test-key',
      log,
      makeResolvedConfig(),
    );

    expect(result.status).toBe('SKIPPED');
    expect(result.status).not.toBe('SENT');
    expect(result.status).not.toBe('PENDING');
    expect(result.notes.join(' ')).toMatch(/FaceHttpPort/);
  });

  it('returns SKIPPED when no resolvedConfig (unconfigured company)', async () => {
    const provider = new FaceTransmissionProvider();
    const log = new RecordingComplianceLogger();
    const result = await provider.transmit(
      [makeFacturaeArtifact()],
      makeCtx(COMPANY_ID),
      {} as never,
      'k',
      log,
    );
    expect(result.status).toBe('SKIPPED');
    expect(result.notes.join(' ')).toMatch(/no resolved config/);
  });

  it('returns SKIPPED when config is incomplete (missing certificate)', async () => {
    const provider = new FaceTransmissionProvider();
    const log = new RecordingComplianceLogger();
    const result = await provider.transmit(
      [makeFacturaeArtifact()],
      makeCtx(COMPANY_ID),
      {} as never,
      'k',
      log,
      makeResolvedConfig({ certificate: undefined }),
    );
    expect(result.status).toBe('SKIPPED');
    expect(result.notes.join(' ')).toMatch(/incomplete config/);
  });

  it('returns SKIPPED when no ES_FACTURAE artifact is present', async () => {
    const http = mockFaceHttp([{ status: 200, data: ENVIAR_FACTURA_OK_XML }]);
    const provider = new FaceTransmissionProvider(undefined, http);
    const log = new RecordingComplianceLogger();
    const nonFacturae: SignedArtifact = {
      role: 'AUTHORITATIVE',
      syntax: 'EN16931_CII',
      mime: 'application/xml',
      bytes: Buffer.from('<xml/>'),
    };
    const result = await provider.transmit(
      [nonFacturae],
      makeCtx(COMPANY_ID),
      {} as never,
      'k',
      log,
      makeResolvedConfig(),
    );
    expect(result.status).toBe('SKIPPED');
    expect(result.notes.join(' ')).toMatch(/no ES_FACTURAE artifact/);
    expect(http.post).not.toHaveBeenCalled();
  });
});

describe('FaceTransmissionProvider.transmit — mocked FaceHttpPort', () => {
  it('submits via enviarFactura and returns PENDING with ref + authorityId', async () => {
    const http = mockFaceHttp([{ status: 200, data: ENVIAR_FACTURA_OK_XML }]);
    const provider = new FaceTransmissionProvider(undefined, http);
    const log = new RecordingComplianceLogger();

    const result = await provider.transmit(
      [makeFacturaeArtifact()],
      makeCtx(COMPANY_ID),
      {} as never,
      'test-key',
      log,
      makeResolvedConfig(),
    );

    expect(result.status).toBe('PENDING');
    expect(result.ref).toBe(`${COMPANY_ID}|2026/000000042`);
    expect(result.authorityIds).toEqual([{ scheme: 'FACE_NUMERO_REGISTRO', value: '2026/000000042' }]);
    expect(http.post).toHaveBeenCalledTimes(1);
  });

  it('returns REJECTED when FACe returns a non-zero resultado.codigo', async () => {
    const http = mockFaceHttp([{ status: 200, data: ENVIAR_FACTURA_ERROR_XML }]);
    const provider = new FaceTransmissionProvider(undefined, http);
    const log = new RecordingComplianceLogger();

    const result = await provider.transmit(
      [makeFacturaeArtifact()],
      makeCtx(COMPANY_ID),
      {} as never,
      'test-key',
      log,
      makeResolvedConfig(),
    );

    expect(result.status).toBe('REJECTED');
    expect(result.notes.join(' ')).toMatch(/033/);
  });

  it('returns REJECTED when the HTTP port throws', async () => {
    const http: FaceHttpPort = { post: jest.fn().mockRejectedValue(new Error('connection refused')) };
    const provider = new FaceTransmissionProvider(undefined, http);
    const log = new RecordingComplianceLogger();

    const result = await provider.transmit(
      [makeFacturaeArtifact()],
      makeCtx(COMPANY_ID),
      {} as never,
      'test-key',
      log,
      makeResolvedConfig(),
    );

    expect(result.status).toBe('REJECTED');
    expect(result.notes.join(' ')).toMatch(/connection refused/);
  });

  it('returns SKIPPED when supplierCompanyId is absent from context', async () => {
    const http = mockFaceHttp([{ status: 200, data: ENVIAR_FACTURA_OK_XML }]);
    const provider = new FaceTransmissionProvider(undefined, http);
    const log = new RecordingComplianceLogger();

    const result = await provider.transmit(
      [makeFacturaeArtifact()],
      makeCtx(undefined),
      {} as never,
      'test-key',
      log,
      makeResolvedConfig(),
    );

    expect(result.status).toBe('SKIPPED');
    expect(result.notes.join(' ')).toMatch(/supplierCompanyId/);
  });
});

describe('FaceTransmissionProvider.poll', () => {
  const REF = `${COMPANY_ID}|2026/000000042`;

  it('returns PENDING when no credentials port is configured', async () => {
    const provider = new FaceTransmissionProvider();
    const log = new RecordingComplianceLogger();
    const result = await provider.poll(REF, log);
    expect(result.status).toBe('PENDING');
    expect(result.notes.join(' ')).toMatch(/no credentials port/);
  });

  it('maps tramitacion 1200 (Registrada) → PENDING', async () => {
    const http = mockFaceHttp([{ status: 200, data: consultarFacturaXml('1200', 'Registrada') }]);
    const provider = new FaceTransmissionProvider(mockCredentials(makeResolvedConfig()), http);
    const log = new RecordingComplianceLogger();
    const result = await provider.poll(REF, log);
    expect(result.status).toBe('PENDING');
  });

  it('maps tramitacion 2500 (Pagada) → CLEARED', async () => {
    const http = mockFaceHttp([{ status: 200, data: consultarFacturaXml('2500', 'Pagada') }]);
    const provider = new FaceTransmissionProvider(mockCredentials(makeResolvedConfig()), http);
    const log = new RecordingComplianceLogger();
    const result = await provider.poll(REF, log);
    expect(result.status).toBe('CLEARED');
  });

  it('maps tramitacion 2600 (Rechazada) → REJECTED', async () => {
    const http = mockFaceHttp([{ status: 200, data: consultarFacturaXml('2600', 'Rechazada') }]);
    const provider = new FaceTransmissionProvider(mockCredentials(makeResolvedConfig()), http);
    const log = new RecordingComplianceLogger();
    const result = await provider.poll(REF, log);
    expect(result.status).toBe('REJECTED');
  });

  it('returns PENDING when credentials are no longer active', async () => {
    const provider = new FaceTransmissionProvider(
      mockCredentials({ ...makeResolvedConfig(), isActive: false }),
    );
    const log = new RecordingComplianceLogger();
    const result = await provider.poll(REF, log);
    expect(result.status).toBe('PENDING');
    expect(result.notes.join(' ')).toMatch(/no longer active/);
  });

  it('returns PENDING (not SKIPPED) when credentials resolve but no FaceHttpPort is injected', async () => {
    const provider = new FaceTransmissionProvider(mockCredentials(makeResolvedConfig()) /* no httpPort */);
    const log = new RecordingComplianceLogger();
    const result = await provider.poll(REF, log);
    expect(result.status).toBe('PENDING');
    expect(result.notes.join(' ')).toMatch(/FaceHttpPort/);
  });
});

describe('FaceTransmissionProvider — registry resolution', () => {
  it("resolves { type:'GOV_PORTAL_API', providerId:'es-face' } to the FaceTransmissionProvider", () => {
    const reg = new TransmissionProviderRegistry();
    const resolved = reg.resolve({ type: 'GOV_PORTAL_API', providerId: 'es-face' });
    expect(resolved).toBeInstanceOf(FaceTransmissionProvider);
    expect(resolved?.id).toBe('es-face');
  });

  it("a bare { type:'GOV_PORTAL_API' } (no providerId) still resolves to null — unchanged", () => {
    const reg = new TransmissionProviderRegistry();
    expect(reg.resolve({ type: 'GOV_PORTAL_API' })).toBeNull();
  });

  it('declares an honest maturity + configSchema with cert/password marked secret', () => {
    const reg = new TransmissionProviderRegistry();
    const provider = reg.getById('es-face')!;
    expect(provider.maturity).toBe('IMPLEMENTED');
    expect(provider.feedback).toBe('ASYNC_POLL');
    const fields = provider.configSchema?.fields ?? [];
    const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
    expect(byName.certificate?.secret).toBe(true);
    expect(byName.certificatePassword?.secret).toBe(true);
    expect(byName.notificationEmail?.secret).toBeFalsy();
  });

  it('transmit() via the registry with no credentials port configured returns SKIPPED', async () => {
    const reg = new TransmissionProviderRegistry();
    const log = new RecordingComplianceLogger();
    const results = await reg.transmitAll(
      [makeFacturaeArtifact()],
      makeCtx(COMPANY_ID),
      { channels: [{ type: 'GOV_PORTAL_API', providerId: 'es-face' }] } as never,
      'test-key',
      log,
    );
    expect(results[0].status).toBe('SKIPPED');
  });
});
