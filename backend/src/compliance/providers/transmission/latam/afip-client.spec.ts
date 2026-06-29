/**
 * AFIP/ARCA client — mocked HTTP tests.
 * All HTTP calls go through the injectable AfipHttpPort — no real network.
 * Live integration proof deferred (no public sandbox credentials available).
 */
import { AfipClient, AfipClientConfig, AfipHttpPort, AfipTicketAcceso, AfipCaeResponse, AfipStatusResponse } from './afip-client';

const TEST_CONFIG: AfipClientConfig = {
  environment: 'test',
  cuit: '30712345679',
};

function mockHttp(overrides?: Partial<AfipHttpPort>): AfipHttpPort {
  const ta: AfipTicketAcceso = {
    token: 'test-token',
    sign: 'test-sign',
    expirationTime: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
  };
  const caeResp: AfipCaeResponse = {
    cae: '12345678901234',
    vencimientoCAE: '20260101',
    cbteDesde: 1,
    cbteHasta: 1,
    resultado: 'A',
  };
  const status: AfipStatusResponse = { appServer: 'OK', authServer: 'OK', dbServer: 'OK' };
  return {
    authenticate: jest.fn().mockResolvedValue(ta),
    fecaeSolicitar: jest.fn().mockResolvedValue(caeResp),
    serverStatus: jest.fn().mockResolvedValue(status),
    ...overrides,
  };
}

describe('AfipClient (mocked HTTP — live-deferred)', () => {
  it('authenticate() calls WSAA URL with CMS signed XML', async () => {
    const http = mockHttp();
    const client = new AfipClient(http, TEST_CONFIG);
    const ta = await client.authenticate();
    expect(http.authenticate).toHaveBeenCalledWith(
      expect.stringContaining('wsaahomo.afip.gov.ar'),
      expect.any(String),
    );
    expect(ta.token).toBe('test-token');
    expect(ta.sign).toBe('test-sign');
  });

  it('requestCae() calls WSFE with TA and request body', async () => {
    const http = mockHttp();
    const client = new AfipClient(http, TEST_CONFIG);
    const ta = await client.authenticate();
    const resp = await client.requestCae(ta, {
      cuit: '30712345679',
      puntoVenta: 1,
      tipoComprobante: 6, // Factura B
      numero: 1,
      fechaComprobante: '20260101',
      importeGravado: 1000.00,
      importeIva: 210.00,
      importeTotal: 1210.00,
      cuitReceptor: '20345678901',
      ivaItems: [{ id: 5, baseImponible: 1000.00, importe: 210.00 }],
    });
    expect(http.fecaeSolicitar).toHaveBeenCalledWith(
      expect.stringContaining('wswhomo.afip.gov.ar'),
      ta,
      expect.objectContaining({ tipoComprobante: 6 }),
    );
    expect(resp.cae).toBe('12345678901234');
    expect(resp.resultado).toBe('A');
  });

  it('submitComprobante() orchestrates auth → CAE in one call', async () => {
    const http = mockHttp();
    const client = new AfipClient(http, TEST_CONFIG);
    const resp = await client.submitComprobante({
      cuit: '30712345679',
      puntoVenta: 1,
      tipoComprobante: 1,
      numero: 42,
      fechaComprobante: '20260101',
      importeGravado: 500,
      importeIva: 105,
      importeTotal: 605,
      cuitReceptor: '20345678901',
      ivaItems: [{ id: 5, baseImponible: 500, importe: 105 }],
    });
    expect(http.authenticate).toHaveBeenCalledTimes(1);
    expect(http.fecaeSolicitar).toHaveBeenCalledTimes(1);
    expect(resp.resultado).toBe('A');
  });

  it('uses prod WSAA URL when environment is prod', async () => {
    const http = mockHttp();
    const client = new AfipClient(http, { ...TEST_CONFIG, environment: 'prod' });
    await client.authenticate();
    expect(http.authenticate).toHaveBeenCalledWith(
      expect.stringContaining('wsaa.afip.gov.ar'),
      expect.any(String),
    );
  });

  it('serverStatus() calls FEDummy health check', async () => {
    const http = mockHttp();
    const client = new AfipClient(http, TEST_CONFIG);
    const status = await client.serverStatus();
    expect(http.serverStatus).toHaveBeenCalledWith(expect.stringContaining('wswhomo.afip.gov.ar'));
    expect(status.appServer).toBe('OK');
  });

  it('propagates WSAA error when auth fails', async () => {
    const http = mockHttp({
      authenticate: jest.fn().mockRejectedValue(new Error('WSAA: certificate rejected')),
    });
    const client = new AfipClient(http, TEST_CONFIG);
    await expect(client.authenticate()).rejects.toThrow('WSAA: certificate rejected');
  });

  it('propagates WSFE rejection when CAE is refused', async () => {
    const http = mockHttp({
      fecaeSolicitar: jest.fn().mockResolvedValue({
        cae: '',
        vencimientoCAE: '',
        cbteDesde: 1,
        cbteHasta: 1,
        resultado: 'R',
        errores: [{ code: 10016, msg: 'El campo PtoVta no es válido' }],
      }),
    });
    const client = new AfipClient(http, TEST_CONFIG);
    const ta = await client.authenticate();
    const resp = await client.requestCae(ta, {
      cuit: '30712345679', puntoVenta: 9999, tipoComprobante: 1, numero: 1,
      fechaComprobante: '20260101', importeGravado: 100, importeIva: 21, importeTotal: 121,
      cuitReceptor: '20000000001', ivaItems: [{ id: 5, baseImponible: 100, importe: 21 }],
    });
    expect(resp.resultado).toBe('R');
    expect(resp.errores?.[0].code).toBe(10016);
  });
});
