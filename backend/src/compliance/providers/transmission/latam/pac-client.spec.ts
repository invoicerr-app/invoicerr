/**
 * Mexico PAC client — mocked HTTP tests.
 * Live integration proof deferred (SAT CSD certificate + PAC credentials required).
 */
import { PacClient, PacClientConfig, PacHttpPort, PacTimbreResponse } from './pac-client';

const TEST_CONFIG: PacClientConfig = {
  environment: 'test',
  baseUrl: 'https://services.test.sw.com.mx',
  apiKey: 'test-api-key-abc',
  rfc: 'AAA010101AAA',
};

const MOCK_TIMBRE: PacTimbreResponse = {
  uuid: '6128396f-c09b-4ec6-8699-43c5f7e3b230',
  selloCfd: 'base64SelloCfd==',
  selloSat: 'base64SelloSat==',
  noCertificadoSat: '20001000000300022323',
  cfdiXmlStamped: '<?xml version="1.0"?><cfdi:Comprobante><cfdi:Complemento><tfd:TimbreFiscalDigital UUID="6128396f-c09b-4ec6-8699-43c5f7e3b230"/></cfdi:Complemento></cfdi:Comprobante>',
};

function mockHttp(overrides?: Partial<PacHttpPort>): PacHttpPort {
  return {
    timbrar: jest.fn().mockResolvedValue(MOCK_TIMBRE),
    consultaEstado: jest.fn().mockResolvedValue({
      uuid: MOCK_TIMBRE.uuid,
      status: 'vigente',
    }),
    ...overrides,
  };
}

const CFDI_XML = Buffer.from(
  '<?xml version="1.0" encoding="UTF-8"?><cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Sello="" Certificado="" NoCertificado="" Total="116.00"><cfdi:Complemento/></cfdi:Comprobante>',
  'utf-8',
);

describe('PacClient (mocked HTTP — live-deferred)', () => {
  it('timbrar() posts base64 CFDI to PAC and returns UUID + TimbreFiscalDigital', async () => {
    const http = mockHttp();
    const client = new PacClient(http, TEST_CONFIG);
    const resp = await client.timbrar(CFDI_XML);
    expect(http.timbrar).toHaveBeenCalledWith(
      'https://services.test.sw.com.mx',
      expect.any(String), // base64-encoded XML
      'test-api-key-abc',
      'AAA010101AAA',
    );
    // Verify the XML was base64-encoded in the call
    const [, xmlBase64] = (http.timbrar as jest.Mock).mock.calls[0];
    expect(Buffer.from(xmlBase64, 'base64').toString('utf-8')).toContain('<cfdi:Comprobante');
    expect(resp.uuid).toBe('6128396f-c09b-4ec6-8699-43c5f7e3b230');
    expect(resp.selloSat).toBe('base64SelloSat==');
    expect(resp.cfdiXmlStamped).toContain('TimbreFiscalDigital');
  });

  it('timbrar() accepts XML as string', async () => {
    const http = mockHttp();
    const client = new PacClient(http, TEST_CONFIG);
    const resp = await client.timbrar(CFDI_XML.toString('utf-8'));
    expect(resp.uuid).toBe(MOCK_TIMBRE.uuid);
  });

  it('consultaEstado() queries the PAC/SAT status by UUID', async () => {
    const http = mockHttp();
    const client = new PacClient(http, TEST_CONFIG);
    const resp = await client.consultaEstado(MOCK_TIMBRE.uuid, 'XAXX010101000', '116.00');
    expect(http.consultaEstado).toHaveBeenCalledWith(
      'https://services.test.sw.com.mx',
      MOCK_TIMBRE.uuid,
      'AAA010101AAA',
      'XAXX010101000',
      '116.00',
      'test-api-key-abc',
    );
    expect(resp.status).toBe('vigente');
  });

  it('mapEstado() classifies SAT estados', () => {
    expect(PacClient.mapEstado('vigente')).toBe('CLEARED');
    expect(PacClient.mapEstado('cancelado')).toBe('REJECTED');
    expect(PacClient.mapEstado('no_encontrado')).toBe('PENDING');
    expect(PacClient.mapEstado('unknown')).toBe('PENDING');
  });

  it('handles PAC rejection (no UUID returned)', async () => {
    const http = mockHttp({
      timbrar: jest.fn().mockRejectedValue(new Error('CFDI_DUPLICATE: UUID already registered with SAT')),
    });
    const client = new PacClient(http, TEST_CONFIG);
    await expect(client.timbrar(CFDI_XML)).rejects.toThrow('CFDI_DUPLICATE');
  });

  it('handles cancelled CFDI state', async () => {
    const http = mockHttp({
      consultaEstado: jest.fn().mockResolvedValue({
        uuid: MOCK_TIMBRE.uuid,
        status: 'cancelado',
        acuse: 'ACUSE-12345',
      }),
    });
    const client = new PacClient(http, TEST_CONFIG);
    const resp = await client.consultaEstado(MOCK_TIMBRE.uuid, 'XAXX010101000', '116.00');
    expect(PacClient.mapEstado(resp.status)).toBe('REJECTED');
    expect(resp.acuse).toBe('ACUSE-12345');
  });
});
