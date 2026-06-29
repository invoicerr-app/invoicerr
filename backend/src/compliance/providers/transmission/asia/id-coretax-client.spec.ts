/**
 * Indonesia Coretax client — mocked HTTP tests.
 * All HTTP calls go through the injectable IdCoretaxHttpPort — no real network.
 * Live integration proof deferred (no public Coretax sandbox credentials).
 */
import {
  IdCoretaxClient,
  IdCoretaxClientConfig,
  IdCoretaxHttpPort,
  IdCoretaxAuthResponse,
  IdCoretaxSubmissionResponse,
  IdCoretaxStatusResponse,
  IdCoretaxFakturItem,
} from './id-coretax-client';

const TEST_CONFIG: IdCoretaxClientConfig = {
  environment: 'preprod',
  npwp: '012345678901234',
  passphrase: 'test-passphrase',
};

const MOCK_AUTH: IdCoretaxAuthResponse = {
  token: 'coretax-bearer-token',
  tokenType: 'Bearer',
  expiresIn: 3600,
  sessionId: 'sess-123',
};

const MOCK_SUBMISSION: IdCoretaxSubmissionResponse = {
  result: 'OK',
  fakturResults: [
    {
      nsfp: '0000001-25.00000001',
      status: 'APPROVED',
      kodeOtorisasi: 'KO-20250401-0001234',
    },
  ],
};

const MOCK_STATUS: IdCoretaxStatusResponse = {
  nsfp: '0000001-25.00000001',
  status: 'APPROVED',
  kodeOtorisasi: 'KO-20250401-0001234',
  tanggalPersetujuan: '2025-04-01T10:05:00Z',
};

function mockHttp(overrides?: Partial<IdCoretaxHttpPort>): IdCoretaxHttpPort {
  return {
    authenticate: jest.fn().mockResolvedValue(MOCK_AUTH),
    submitFaktur: jest.fn().mockResolvedValue(MOCK_SUBMISSION),
    getStatus: jest.fn().mockResolvedValue(MOCK_STATUS),
    ...overrides,
  };
}

const SAMPLE_FAKTUR: IdCoretaxFakturItem = {
  nsfp: '0000001-25.00000001',
  tanggalFaktur: '2025-04-01',
  npwpPenjual: '012345678901234',
  npwpPembeli: '987654321098765',
  namaPembeli: 'PT Buyer Indonesia',
  alamatPembeli: 'Jl. Sudirman 100, Jakarta',
  dpp: 10000000,
  ppn: 1100000,
  tarifPpn: 11,
  barangJasas: [
    {
      kodeBarang: 'SVC-001',
      namaBarang: 'Software development',
      satuan: 'Jam',
      jumlah: 200,
      hargaSatuan: 50000,
      jumlahBarangJasa: 10000000,
      potonganHarga: 0,
      dppBarang: 10000000,
      ppnBarang: 1100000,
    },
  ],
};

describe('IdCoretaxClient (mocked HTTP — live-deferred)', () => {
  it('authenticate() calls Coretax preprod URL with NPWP + passphrase', async () => {
    const http = mockHttp();
    const client = new IdCoretaxClient(http, TEST_CONFIG);
    const token = await client.authenticate();
    expect(http.authenticate).toHaveBeenCalledWith(
      expect.stringContaining('efaktur-preprod.pajak.go.id'),
      '012345678901234',
      'test-passphrase',
    );
    expect(token).toBe('coretax-bearer-token');
  });

  it('authenticate() uses prod URL in production environment', async () => {
    const http = mockHttp();
    const client = new IdCoretaxClient(http, { ...TEST_CONFIG, environment: 'prod' });
    await client.authenticate();
    expect(http.authenticate).toHaveBeenCalledWith(
      expect.stringContaining('efaktur.pajak.go.id'),
      expect.any(String),
      expect.any(String),
    );
    const call = (http.authenticate as jest.Mock).mock.calls[0][0] as string;
    expect(call).not.toContain('preprod');
  });

  it('authenticate() caches the token to avoid repeated auth calls', async () => {
    const http = mockHttp();
    const client = new IdCoretaxClient(http, TEST_CONFIG);
    await client.authenticate();
    await client.authenticate();
    expect(http.authenticate).toHaveBeenCalledTimes(1);
  });

  it('submitFaktur() authenticates then posts to submit endpoint', async () => {
    const http = mockHttp();
    const client = new IdCoretaxClient(http, TEST_CONFIG);
    const resp = await client.submitFaktur([SAMPLE_FAKTUR]);
    expect(http.authenticate).toHaveBeenCalledTimes(1);
    expect(http.submitFaktur).toHaveBeenCalledWith(
      expect.stringContaining('efaktur-preprod'),
      'coretax-bearer-token',
      expect.objectContaining({
        fakturList: expect.arrayContaining([
          expect.objectContaining({ nsfp: '0000001-25.00000001', tarifPpn: 11 }),
        ]),
      }),
    );
    expect(resp.result).toBe('OK');
    expect(resp.fakturResults[0].status).toBe('APPROVED');
    expect(resp.fakturResults[0].kodeOtorisasi).toBe('KO-20250401-0001234');
  });

  it('getStatus() authenticates then polls status by NSFP', async () => {
    const http = mockHttp();
    const client = new IdCoretaxClient(http, TEST_CONFIG);
    const status = await client.getStatus('0000001-25.00000001');
    expect(http.getStatus).toHaveBeenCalledWith(
      expect.stringContaining('efaktur-preprod'),
      'coretax-bearer-token',
      '0000001-25.00000001',
    );
    expect(status.status).toBe('APPROVED');
    expect(status.kodeOtorisasi).toBe('KO-20250401-0001234');
  });

  it('propagates authentication error', async () => {
    const http = mockHttp({
      authenticate: jest.fn().mockRejectedValue(new Error('Coretax: invalid NPWP or passphrase')),
    });
    const client = new IdCoretaxClient(http, TEST_CONFIG);
    await expect(client.authenticate()).rejects.toThrow('invalid NPWP or passphrase');
  });

  it('handles REJECTED faktur result', async () => {
    const http = mockHttp({
      submitFaktur: jest.fn().mockResolvedValue({
        result: 'ERROR',
        fakturResults: [
          {
            nsfp: '0000001-25.00000001',
            status: 'REJECTED',
            errorCode: 'ERR-NSFP-INVALID',
            errorMessage: 'NSFP tidak valid atau sudah digunakan',
          },
        ],
      }),
    });
    const client = new IdCoretaxClient(http, TEST_CONFIG);
    const resp = await client.submitFaktur([SAMPLE_FAKTUR]);
    expect(resp.result).toBe('ERROR');
    expect(resp.fakturResults[0].status).toBe('REJECTED');
    expect(resp.fakturResults[0].errorMessage).toContain('NSFP tidak valid');
  });

  it('handles PENDING status during polling', async () => {
    const http = mockHttp({
      getStatus: jest.fn().mockResolvedValue({ nsfp: '0000001-25.00000001', status: 'PENDING' }),
    });
    const client = new IdCoretaxClient(http, TEST_CONFIG);
    const status = await client.getStatus('0000001-25.00000001');
    expect(status.status).toBe('PENDING');
    expect(status.kodeOtorisasi).toBeUndefined();
  });
});
