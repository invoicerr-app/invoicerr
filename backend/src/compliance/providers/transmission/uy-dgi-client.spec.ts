/**
 * Uruguay DGI CFE client — mocked HTTP tests.
 * Live integration proof deferred (DGI-accredited certificate required).
 */
import { UyDgiClient, UyDgiClientConfig, UyDgiHttpPort } from './uy-dgi-client';

const TEST_CONFIG: UyDgiClientConfig = { environment: 'test', rut: '214002340010' };

function mockHttp(overrides?: Partial<UyDgiHttpPort>): UyDgiHttpPort {
  return {
    enviarCfe: jest.fn().mockResolvedValue({ idEnvio: 'ENV-20260629-001', estado: 'RECIBIDO' }),
    obtenerRespuesta: jest.fn().mockResolvedValue({
      idEnvio: 'ENV-20260629-001',
      estado: 'ACEPTADO',
      cae: '22000000001',
      caeFechaVto: '2026-12-31',
    }),
    ...overrides,
  };
}

const CFE_XML = Buffer.from('<CFE version="1.0"><eFact/></CFE>', 'utf8');

describe('UyDgiClient (mocked HTTP — live-deferred)', () => {
  it('enviarCfe() submits to DGI WS and returns idEnvio', async () => {
    const http = mockHttp();
    const client = new UyDgiClient(http, TEST_CONFIG);
    const resp = await client.enviarCfe(CFE_XML);
    expect(http.enviarCfe).toHaveBeenCalledWith(
      expect.stringContaining('efactura.dgi.gub.uy'),
      CFE_XML,
      '214002340010',
    );
    expect(resp.idEnvio).toBe('ENV-20260629-001');
    expect(resp.estado).toBe('RECIBIDO');
  });

  it('obtenerRespuesta() polls by idEnvio and returns CAE', async () => {
    const http = mockHttp();
    const client = new UyDgiClient(http, TEST_CONFIG);
    const resp = await client.obtenerRespuesta('ENV-20260629-001');
    expect(http.obtenerRespuesta).toHaveBeenCalledWith(
      expect.stringContaining('efactura.dgi.gub.uy'),
      'ENV-20260629-001',
      '214002340010',
    );
    expect(resp.estado).toBe('ACEPTADO');
    expect(resp.cae).toBe('22000000001');
  });

  it('uses prod URL when environment is prod', async () => {
    const http = mockHttp();
    const client = new UyDgiClient(http, { ...TEST_CONFIG, environment: 'prod' });
    await client.enviarCfe(CFE_XML);
    expect(http.enviarCfe).toHaveBeenCalledWith(
      'https://efactura.dgi.gub.uy/dte/ws/dte_ws', // prod (no port 6443)
      CFE_XML,
      '214002340010',
    );
  });

  it('mapEstado classifies DGI states', () => {
    expect(UyDgiClient.mapEstado('ACEPTADO')).toBe('CLEARED');
    expect(UyDgiClient.mapEstado('RECHAZADO')).toBe('REJECTED');
    expect(UyDgiClient.mapEstado('ERROR')).toBe('REJECTED');
    expect(UyDgiClient.mapEstado('EN_PROCESO')).toBe('PENDING');
    expect(UyDgiClient.mapEstado('RECIBIDO')).toBe('PENDING');
    expect(UyDgiClient.mapEstado('UNKNOWN')).toBe('PENDING');
  });

  it('handles DGI error response', async () => {
    const http = mockHttp({
      enviarCfe: jest.fn().mockResolvedValue({ idEnvio: '', estado: 'ERROR', errorMsg: 'RUT inválido' }),
    });
    const client = new UyDgiClient(http, TEST_CONFIG);
    const resp = await client.enviarCfe(CFE_XML);
    expect(UyDgiClient.mapEstado(resp.estado)).toBe('REJECTED');
    expect(resp.errorMsg).toBe('RUT inválido');
  });

  it('handles DGI rejection with reason codes', async () => {
    const http = mockHttp({
      obtenerRespuesta: jest.fn().mockResolvedValue({
        idEnvio: 'ENV-001',
        estado: 'RECHAZADO',
        rechazos: [{ codigo: 'E001', descripcion: 'Número de comprobante duplicado' }],
      }),
    });
    const client = new UyDgiClient(http, TEST_CONFIG);
    const resp = await client.obtenerRespuesta('ENV-001');
    expect(UyDgiClient.mapEstado(resp.estado)).toBe('REJECTED');
    expect(resp.rechazos?.[0].codigo).toBe('E001');
  });
});
