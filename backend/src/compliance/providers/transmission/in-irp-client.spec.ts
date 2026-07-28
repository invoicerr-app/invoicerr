/**
 * India IRP client — mocked HTTP tests.
 * All HTTP calls go through the injectable InIrpHttpPort — no real network.
 * Live integration proof deferred (no public sandbox GSTIN + app_key available).
 */
import {
  InIrpClient,
  InIrpClientConfig,
  InIrpHttpPort,
  InIrpAuthResponse,
  InIrpIrnResponse,
  InIrpCancelResponse,
  InIrpInvoicePayload,
  computeIrn,
} from './in-irp-client';

const TEST_CONFIG: InIrpClientConfig = {
  environment: 'sandbox',
  gstin: '06AABCT1234F1Z5',
  appKey: 'test-app-key-base64',
};

const MOCK_AUTH: InIrpAuthResponse = {
  authToken: 'test-auth-token',
  sek: 'test-sek-base64',
  tokenExpiry: 21600,
};

const MOCK_IRN_RESPONSE: InIrpIrnResponse = {
  Irn: 'a' + '0'.repeat(63), // 64 hex chars (SHA-256 placeholder)
  AckNo: '112025000123456',
  AckDt: '2025-04-01 10:00:00',
  SignedInvoice: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.test.sig',
  SignedQRCode: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.qr.sig',
  Status: '1',
};

const MOCK_CANCEL: InIrpCancelResponse = {
  Irn: 'a' + '0'.repeat(63),
  CancelDate: '2025-04-01 10:30:00',
};

function mockHttp(overrides?: Partial<InIrpHttpPort>): InIrpHttpPort {
  return {
    authenticate: jest.fn().mockResolvedValue(MOCK_AUTH),
    generateIrn: jest.fn().mockResolvedValue(MOCK_IRN_RESPONSE),
    cancelIrn: jest.fn().mockResolvedValue(MOCK_CANCEL),
    ping: jest.fn().mockResolvedValue({ status: 'UP' }),
    ...overrides,
  };
}

const SAMPLE_PAYLOAD: InIrpInvoicePayload = {
  version: '1.1',
  TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' },
  DocDtls: { Typ: 'INV', No: 'INV-2025-0001', Dt: '01/04/2025' },
  SellerDtls: {
    Gstin: '06AABCT1234F1Z5',
    LglNm: 'InfoTech Pvt Ltd',
    Addr1: 'Plot 42 Sector 5',
    Loc: 'Gurugram',
    Pin: 122001,
    Stcd: '06',
  },
  BuyerDtls: {
    Gstin: '27AAACG9876E1Z9',
    LglNm: 'Global Solutions Ltd',
    Addr1: 'Tower B Floor 12',
    Loc: 'Mumbai',
    Pin: 400001,
    Stcd: '27',
    Pos: '27',
  },
  ItemList: [
    {
      SlNo: '1',
      PrdDesc: 'Software development',
      IsServc: 'Y',
      HsnCd: '998314',
      Qty: 200,
      Unit: 'HRS',
      UnitPrice: 5000,
      TotAmt: 1000000,
      AssAmt: 1000000,
      GstRt: 18,
      IgstAmt: 0,
      CgstAmt: 90000,
      SgstAmt: 90000,
      TotItemVal: 1180000,
    },
  ],
  ValDtls: {
    AssVal: 1000000,
    CgstVal: 90000,
    SgstVal: 90000,
    IgstVal: 0,
    TotInvVal: 1180000,
  },
};

describe('InIrpClient (mocked HTTP — live-deferred)', () => {
  it('authenticate() calls IRP sandbox URL with GSTIN + app_key', async () => {
    const http = mockHttp();
    const client = new InIrpClient(http, TEST_CONFIG);
    const auth = await client.authenticate();
    expect(http.authenticate).toHaveBeenCalledWith(
      expect.stringContaining('einvoice1-sandbox.nic.in'),
      expect.objectContaining({ gstin: '06AABCT1234F1Z5' }),
    );
    expect(auth.authToken).toBe('test-auth-token');
    expect(auth.sek).toBe('test-sek-base64');
  });

  it('authenticate() uses prod URL when environment is prod', async () => {
    const http = mockHttp();
    const client = new InIrpClient(http, { ...TEST_CONFIG, environment: 'prod' });
    await client.authenticate();
    expect(http.authenticate).toHaveBeenCalledWith(
      expect.stringContaining('einvoice1.gst.gov.in'),
      expect.any(Object),
    );
  });

  it('generateIrn() calls IRP with auth token and INV-01 payload', async () => {
    const http = mockHttp();
    const client = new InIrpClient(http, TEST_CONFIG);
    const resp = await client.generateIrn('test-auth-token', SAMPLE_PAYLOAD);
    expect(http.generateIrn).toHaveBeenCalledWith(
      expect.stringContaining('einvoice1-sandbox'),
      'test-auth-token',
      expect.objectContaining({ DocDtls: expect.objectContaining({ Typ: 'INV', No: 'INV-2025-0001' }) }),
    );
    expect(resp.Irn).toHaveLength(64);
    expect(resp.Status).toBe('1');
    expect(resp.SignedQRCode).toBeTruthy();
  });

  it('submitInvoice() orchestrates auth → generate IRN in one call', async () => {
    const http = mockHttp();
    const client = new InIrpClient(http, TEST_CONFIG);
    const resp = await client.submitInvoice(SAMPLE_PAYLOAD);
    expect(http.authenticate).toHaveBeenCalledTimes(1);
    expect(http.generateIrn).toHaveBeenCalledTimes(1);
    expect(resp.AckNo).toBe('112025000123456');
  });

  it('cancelIrn() calls IRP cancel endpoint with IRN + reason', async () => {
    const http = mockHttp();
    const client = new InIrpClient(http, TEST_CONFIG);
    const irn = 'a' + '0'.repeat(63);
    const resp = await client.cancelIrn('test-auth-token', irn, '2', 'Data entry mistake');
    expect(http.cancelIrn).toHaveBeenCalledWith(
      expect.any(String),
      'test-auth-token',
      expect.objectContaining({ Irn: irn, CnlRsn: '2' }),
    );
    expect(resp.CancelDate).toBeTruthy();
  });

  it('ping() calls health check endpoint', async () => {
    const http = mockHttp();
    const client = new InIrpClient(http, TEST_CONFIG);
    const resp = await client.ping();
    expect(http.ping).toHaveBeenCalledWith(expect.stringContaining('einvoice1-sandbox'));
    expect(resp.status).toBe('UP');
  });

  it('propagates authentication error gracefully', async () => {
    const http = mockHttp({
      authenticate: jest.fn().mockRejectedValue(new Error('IRP auth: invalid GSTIN')),
    });
    const client = new InIrpClient(http, TEST_CONFIG);
    await expect(client.authenticate()).rejects.toThrow('IRP auth: invalid GSTIN');
  });

  it('propagates IRN generation error (e.g. duplicate invoice)', async () => {
    const http = mockHttp({
      generateIrn: jest.fn().mockRejectedValue(new Error('IRP: Duplicate IRN — invoice already registered')),
    });
    const client = new InIrpClient(http, TEST_CONFIG);
    await expect(client.generateIrn('tok', SAMPLE_PAYLOAD)).rejects.toThrow('Duplicate IRN');
  });
});

describe('computeIrn()', () => {
  it('returns a 64-char hex SHA-256 string', () => {
    const irn = computeIrn('06AABCT1234F1Z5', new Date('2025-04-01'), 'INV', 'INV-2025-0001');
    expect(irn).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(irn)).toBe(true);
  });

  it('is deterministic for the same inputs', () => {
    const d = new Date('2025-06-15');
    const a = computeIrn('06AABCT1234F1Z5', d, 'INV', 'INV-001');
    const b = computeIrn('06AABCT1234F1Z5', d, 'INV', 'INV-001');
    expect(a).toBe(b);
  });

  it('differs when doc number differs', () => {
    const d = new Date('2025-04-01');
    const a = computeIrn('06AABCT1234F1Z5', d, 'INV', 'INV-001');
    const b = computeIrn('06AABCT1234F1Z5', d, 'INV', 'INV-002');
    expect(a).not.toBe(b);
  });

  it('uses same FY for Apr and Mar of same year', () => {
    // April 2025 → FY 2025-26
    const aprilIrn = computeIrn('G', new Date('2025-04-01'), 'INV', 'X');
    // March 2026 → FY 2025-26 (same FY)
    const marchIrn = computeIrn('G', new Date('2026-03-31'), 'INV', 'X');
    expect(aprilIrn).toBe(marchIrn);
  });
});
