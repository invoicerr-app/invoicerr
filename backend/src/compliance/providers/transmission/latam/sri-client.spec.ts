/**
 * Ecuador SRI client — mocked HTTP tests.
 * Live integration proof deferred (SRI-accredited certificate required).
 */
import { SriClient, SriClientConfig, SriHttpPort } from './sri-client';

const TEST_CONFIG: SriClientConfig = { environment: 'test', ruc: '1792345678001' };

function mockHttp(overrides?: Partial<SriHttpPort>): SriHttpPort {
  return {
    recibirComprobante: jest.fn().mockResolvedValue({ estado: 'RECIBIDA' }),
    autorizarComprobante: jest.fn().mockResolvedValue({
      claveAccesoConsultada: '0106202501179234567800110010010000000011234567810',
      numeroComprobantes: 1,
      autorizaciones: [{
        estado: 'AUTORIZADO',
        numeroAutorizacion: '0106202501179234567800110010010000000011234567810',
        fechaAutorizacion: '2026-06-29T12:00:00',
        ambiente: 'PRUEBAS',
        comprobante: '<factura>...</factura>',
      }],
    }),
    ...overrides,
  };
}

const SIGNED_XML = Buffer.from('<factura><infoTributaria/></factura>', 'utf8');

describe('SriClient (mocked HTTP — live-deferred)', () => {
  it('submitComprobante() posts to Recepción endpoint', async () => {
    const http = mockHttp();
    const client = new SriClient(http, TEST_CONFIG);
    const resp = await client.submitComprobante(SIGNED_XML);
    expect(http.recibirComprobante).toHaveBeenCalledWith(
      expect.stringContaining('celcer.sri.gob.ec'),
      SIGNED_XML,
    );
    expect(resp.estado).toBe('RECIBIDA');
  });

  it('pollAutorizacion() queries by claveAcceso', async () => {
    const http = mockHttp();
    const client = new SriClient(http, TEST_CONFIG);
    const claveAcceso = '0106202501179234567800110010010000000011234567810';
    const resp = await client.pollAutorizacion(claveAcceso);
    expect(http.autorizarComprobante).toHaveBeenCalledWith(
      expect.stringContaining('celcer.sri.gob.ec'),
      claveAcceso,
    );
    expect(resp.autorizaciones[0].estado).toBe('AUTORIZADO');
    expect(resp.autorizaciones[0].numeroAutorizacion).toBe(claveAcceso);
  });

  it('uses prod URLs when environment is prod', async () => {
    const http = mockHttp();
    const client = new SriClient(http, { ...TEST_CONFIG, environment: 'prod' });
    await client.submitComprobante(SIGNED_XML);
    expect(http.recibirComprobante).toHaveBeenCalledWith(
      expect.stringContaining('cel.sri.gob.ec'),
      SIGNED_XML,
    );
  });

  it('mapEstado classifies SRI states', () => {
    expect(SriClient.mapEstado('AUTORIZADO')).toBe('CLEARED');
    expect(SriClient.mapEstado('NO AUTORIZADO')).toBe('REJECTED');
    expect(SriClient.mapEstado('DEVUELTA')).toBe('REJECTED');
    expect(SriClient.mapEstado('RECIBIDA')).toBe('PENDING');
    expect(SriClient.mapEstado('EN PROCESO')).toBe('PENDING');
  });

  it('handles immediate DEVUELTA rejection', async () => {
    const http = mockHttp({
      recibirComprobante: jest.fn().mockResolvedValue({
        estado: 'DEVUELTA',
        comprobantes: [{ claveAcceso: 'xxx', mensajes: [{ mensaje: 'RUC inválido', tipo: 'ERROR' }] }],
      }),
    });
    const client = new SriClient(http, TEST_CONFIG);
    const resp = await client.submitComprobante(SIGNED_XML);
    expect(SriClient.mapEstado(resp.estado)).toBe('REJECTED');
  });
});
