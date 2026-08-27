/**
 * Peru OSE client — mocked HTTP tests.
 * Live integration proof deferred (SUNAT-accredited certificate + OSE credentials required).
 */
import { OseClient, OseClientConfig, OseHttpPort, OseCdrResponse } from './ose-client';

const TEST_CONFIG: OseClientConfig = {
  environment: 'test',
  baseUrl: 'https://ose-homologacion.example.pe',
  apiKey: 'test-ose-key-abc',
  ruc: '20123456789',
};

const MOCK_CDR_ZIP = Buffer.from('PK\x03\x04CDR_CONTENT', 'utf-8');

const MOCK_CDR: OseCdrResponse = {
  cdrZip: MOCK_CDR_ZIP,
  codigoRespuesta: '0',
  descripcion: 'La Factura numero F001-1, ha sido aceptada',
  estado: 'ACEPTADO',
};

function mockHttp(overrides?: Partial<OseHttpPort>): OseHttpPort {
  return {
    enviarComprobante: jest.fn().mockResolvedValue({
      ticket: 'TICKET-20260629-001',
      estado: 'EN_PROCESO',
    }),
    obtenerCdr: jest.fn().mockResolvedValue(MOCK_CDR),
    ...overrides,
  };
}

const SIGNED_XML_ZIP = Buffer.from('PK\x03\x0420123456789-01-F001-1.xml...', 'utf-8');

describe('OseClient (mocked HTTP — live-deferred)', () => {
  it('enviarComprobante() posts signed ZIP to OSE and returns ticket', async () => {
    const http = mockHttp();
    const client = new OseClient(http, TEST_CONFIG);
    const resp = await client.enviarComprobante('01', 'F001', '1', SIGNED_XML_ZIP);
    expect(http.enviarComprobante).toHaveBeenCalledWith(
      'https://ose-homologacion.example.pe',
      '20123456789',
      '01',
      'F001',
      '1',
      SIGNED_XML_ZIP,
      'test-ose-key-abc',
    );
    expect(resp.ticket).toBe('TICKET-20260629-001');
    expect(resp.estado).toBe('EN_PROCESO');
  });

  it('obtenerCdr() polls OSE by ticket and returns CDR zip + SUNAT code', async () => {
    const http = mockHttp();
    const client = new OseClient(http, TEST_CONFIG);
    const resp = await client.obtenerCdr('01', 'F001', '1', 'TICKET-20260629-001');
    expect(http.obtenerCdr).toHaveBeenCalledWith(
      'https://ose-homologacion.example.pe',
      '20123456789',
      '01',
      'F001',
      '1',
      'test-ose-key-abc',
      'TICKET-20260629-001',
    );
    expect(resp.estado).toBe('ACEPTADO');
    expect(resp.codigoRespuesta).toBe('0');
    expect(resp.cdrZip).toEqual(MOCK_CDR_ZIP);
  });

  it('mapEstado() classifies OSE estados', () => {
    expect(OseClient.mapEstado('ACEPTADO')).toBe('CLEARED');
    expect(OseClient.mapEstado('RECHAZADO')).toBe('REJECTED');
    expect(OseClient.mapEstado('EN_PROCESO')).toBe('PENDING');
    expect(OseClient.mapEstado('PENDIENTE')).toBe('PENDING');
    expect(OseClient.mapEstado('UNKNOWN')).toBe('PENDING');
  });

  it('mapCodigo() classifies SUNAT response codes', () => {
    expect(OseClient.mapCodigo('0')).toBe('CLEARED'); // aceptado
    expect(OseClient.mapCodigo('100')).toBe('CLEARED'); // aceptado con observación menor
    expect(OseClient.mapCodigo('1000')).toBe('CLEARED'); // aceptado con observaciones
    expect(OseClient.mapCodigo('2000')).toBe('REJECTED'); // rechazado
    expect(OseClient.mapCodigo('2800')).toBe('REJECTED'); // rechazado
  });

  it('handles immediate sync CDR return (no ticket)', async () => {
    const http = mockHttp({
      enviarComprobante: jest.fn().mockResolvedValue({
        cdrZip: MOCK_CDR_ZIP,
        codigoRespuesta: '0',
        descripcion: 'Aceptado',
        estado: 'ACEPTADO',
      }),
    });
    const client = new OseClient(http, TEST_CONFIG);
    const resp = await client.enviarComprobante('01', 'F001', '1', SIGNED_XML_ZIP);
    expect(resp.estado).toBe('ACEPTADO');
    expect(resp.cdrZip).toEqual(MOCK_CDR_ZIP);
  });

  it('handles rejection with SUNAT error details', async () => {
    const http = mockHttp({
      obtenerCdr: jest.fn().mockResolvedValue({
        cdrZip: Buffer.from('PK\x03\x04CDR_REJECTED'),
        codigoRespuesta: '2800',
        descripcion: 'El valor del Tipo de Documento de Identidad es invalido',
        estado: 'RECHAZADO',
        detalles: [{ codigo: '2800', descripcion: 'Tipo de documento inválido', tipoError: 'ERROR' }],
      }),
    });
    const client = new OseClient(http, TEST_CONFIG);
    const resp = await client.obtenerCdr('01', 'F001', '1');
    expect(OseClient.mapEstado(resp.estado)).toBe('REJECTED');
    expect(resp.detalles?.[0].codigo).toBe('2800');
  });

  it('uses test baseUrl in all calls', async () => {
    const http = mockHttp();
    const client = new OseClient(http, TEST_CONFIG);
    await client.enviarComprobante('01', 'B001', '5', SIGNED_XML_ZIP);
    expect(http.enviarComprobante).toHaveBeenCalledWith(
      expect.stringContaining('ose-homologacion.example.pe'),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(Buffer),
      expect.any(String),
    );
  });
});
