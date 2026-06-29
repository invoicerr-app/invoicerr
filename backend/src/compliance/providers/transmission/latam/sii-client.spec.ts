/**
 * Chile SII DTE client — mocked HTTP tests.
 * Live integration proof deferred (SII-accredited certificate required).
 */
import { SiiClient, SiiClientConfig, SiiHttpPort } from './sii-client';

const TEST_CONFIG: SiiClientConfig = {
  environment: 'cert',
  rut: '76123456',
  dv: '7',
};

function mockHttp(overrides?: Partial<SiiHttpPort>): SiiHttpPort {
  return {
    getSeed: jest.fn().mockResolvedValue('12345678'),
    getToken: jest.fn().mockResolvedValue({ token: 'sii-token-abc', expiresAt: '2026-06-29T23:59:00' }),
    submitEnvioDTE: jest.fn().mockResolvedValue({ trackId: '1234567890', estado: 'SOK', glosa: 'Envío recibido OK' }),
    queryEstado: jest.fn().mockResolvedValue({ estado: 'DOK', glosa: 'Proceso OK' }),
    ...overrides,
  };
}

const DTE_XML = Buffer.from('<EnvioDTE version="1.0"><Documento/></EnvioDTE>', 'utf8');

describe('SiiClient (mocked HTTP — live-deferred)', () => {
  it('authenticate() fetches seed then exchanges for token', async () => {
    const http = mockHttp();
    const client = new SiiClient(http, TEST_CONFIG);
    const token = await client.authenticate();
    expect(http.getSeed).toHaveBeenCalledWith(expect.stringContaining('maullin.sii.cl'));
    expect(http.getToken).toHaveBeenCalledWith(
      expect.stringContaining('maullin.sii.cl'),
      expect.any(String),
    );
    expect(token.token).toBe('sii-token-abc');
  });

  it('submitDte() authenticates then posts EnvioDTE', async () => {
    const http = mockHttp();
    const client = new SiiClient(http, TEST_CONFIG);
    const resp = await client.submitDte(DTE_XML);
    expect(http.submitEnvioDTE).toHaveBeenCalledWith(
      expect.stringContaining('maullin.sii.cl'),
      'sii-token-abc',
      DTE_XML,
      '76123456-7',
    );
    expect(resp.trackId).toBe('1234567890');
    expect(resp.estado).toBe('SOK');
  });

  it('queryEstado() authenticates then polls by trackId', async () => {
    const http = mockHttp();
    const client = new SiiClient(http, TEST_CONFIG);
    const resp = await client.queryEstado('1234567890');
    expect(http.queryEstado).toHaveBeenCalledWith(
      expect.stringContaining('maullin.sii.cl'),
      'sii-token-abc',
      '76123456',
      '7',
      '1234567890',
    );
    expect(resp.estado).toBe('DOK');
  });

  it('uses prod URL when environment is prod', async () => {
    const http = mockHttp();
    const client = new SiiClient(http, { ...TEST_CONFIG, environment: 'prod' });
    await client.authenticate();
    expect(http.getSeed).toHaveBeenCalledWith(expect.stringContaining('palena.sii.cl'));
  });

  it('mapEstado correctly classifies SII states', () => {
    expect(SiiClient.mapEstado('DOK')).toBe('CLEARED');
    expect(SiiClient.mapEstado('FOK')).toBe('CLEARED');
    expect(SiiClient.mapEstado('EPR')).toBe('CLEARED');
    expect(SiiClient.mapEstado('RCH')).toBe('REJECTED');
    expect(SiiClient.mapEstado('RFR')).toBe('REJECTED');
    expect(SiiClient.mapEstado('RPR')).toBe('REJECTED');
    expect(SiiClient.mapEstado('RSC')).toBe('REJECTED');
    expect(SiiClient.mapEstado('SOK')).toBe('PENDING');
    expect(SiiClient.mapEstado('PRD')).toBe('PENDING');
    expect(SiiClient.mapEstado('UNKNOWN')).toBe('PENDING');
  });

  it('propagates SII rejection (RCH)', async () => {
    const http = mockHttp({
      queryEstado: jest.fn().mockResolvedValue({ estado: 'RCH', glosa: 'DTE rechazado — error en firma' }),
    });
    const client = new SiiClient(http, TEST_CONFIG);
    const resp = await client.queryEstado('9999');
    expect(SiiClient.mapEstado(resp.estado)).toBe('REJECTED');
  });

  it('includes RUT+DV as rutEnvia when submitting', async () => {
    const http = mockHttp();
    const client = new SiiClient(http, { ...TEST_CONFIG, rut: '87654321', dv: '0' });
    await client.submitDte(DTE_XML);
    expect(http.submitEnvioDTE).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      DTE_XML,
      '87654321-0',
    );
  });
});
