/**
 * KRA eTIMS client — mocked / structural tests.
 *
 * Live integration deferred — no KRA eTIMS sandbox credentials available.
 */
import { KeKraClient, KeKraAuthResponse, KeKraInvoiceResponse, KeKraStatusResponse, KeKraHttpPort } from './ke-kra-client';
import { KeKraTransmissionProvider } from './ke-kra-transmission';
import { RecordingComplianceLogger } from '../../../execution/logger';

const MOCK_AUTH: KeKraAuthResponse = {
  resultCd: '000',
  resultMsg: 'Authentication successful',
  data: {
    authToken: 'mock-kra-token',
    cisAplctnDt: '2026-06-29',
  },
};

const MOCK_INVOICE_RESP: KeKraInvoiceResponse = {
  resultCd: '000',
  resultMsg: 'Sales transaction saved successfully',
  data: {
    rcptNo: 1001,
    intrlData: 'base64-internal-data',
    rcptSign: 'base64-receipt-signature',
    sdcDateTime: '2026062910000000',
    totRcptNo: 1001,
  },
};

const MOCK_STATUS: KeKraStatusResponse = {
  resultCd: '000',
  resultMsg: 'Transaction found',
  data: {
    invoiceNo: 'INV-2026-001',
    rcptNo: 1001,
    status: 'CLEARED',
  },
};

function buildMockHttp(): KeKraHttpPort {
  return {
    authenticate: jest.fn().mockResolvedValue(MOCK_AUTH),
    saveTrns: jest.fn().mockResolvedValue(MOCK_INVOICE_RESP),
    selectTrns: jest.fn().mockResolvedValue(MOCK_STATUS),
  };
}

const samplePayload = {
  tpin: 'A000000000A',
  bhfId: '00',
  invoiceNo: 'INV-2026-001',
  invoiceDate: '20260629',
  custPin: 'A111111111A',
  custNm: 'Buyer Company',
  invTypCd: '1',
  pymtTyCd: '02',
  validDt: '20260629',
  items: [{
    itemSeq: 1,
    itemNm: 'Consulting services',
    itemClsCd: '20101601',
    itemTyCd: '2',
    qty: 1,
    prc: 100000,
    splyAmt: 100000,
    dcAmt: 0,
    taxblAmt: 100000,
    taxTyCd: 'A' as const,
    taxAmt: 16000,
    totAmt: 116000,
  }],
  totItemCnt: 1,
  taxblAmtA: 100000,
  taxblAmtB: 0,
  taxblAmtC: 0,
  taxblAmtD: 0,
  taxblAmtE: 0,
  taxAmtA: 16000,
  taxAmtB: 0,
  taxAmtC: 0,
  taxAmtD: 0,
  taxAmtE: 0,
  totTaxblAmt: 100000,
  totTaxAmt: 16000,
  totAmt: 116000,
};

describe('KeKraClient (scaffold — mocked HTTP)', () => {
  const http = buildMockHttp();
  const client = new KeKraClient(http, {
    environment: 'sandbox',
    taxpayerPin: 'A000000000A',
    deviceSerial: 'VSCU-TEST-001',
    branchId: '00',
  });

  it('authenticate() returns authToken', async () => {
    const resp = await client.authenticate();
    expect(resp.resultCd).toBe('000');
    expect(resp.data?.authToken).toBe('mock-kra-token');
  });

  it('saveTrns() returns rcptNo and rcptSign', async () => {
    const resp = await client.saveTrns('mock-token', samplePayload);
    expect(resp.resultCd).toBe('000');
    expect(resp.data?.rcptNo).toBe(1001);
    expect(resp.data?.rcptSign).toBeTruthy();
    expect(resp.data?.intrlData).toBeTruthy();
  });

  it('selectTrns() returns status', async () => {
    const resp = await client.selectTrns('mock-token', 'INV-2026-001');
    expect(resp.resultCd).toBe('000');
    expect(resp.data?.status).toBe('CLEARED');
  });

  it('submitInvoice() full flow returns receipt data', async () => {
    const resp = await client.submitInvoice(samplePayload);
    expect(resp.resultCd).toBe('000');
    expect(resp.data?.rcptNo).toBe(1001);
    expect(resp.data?.rcptSign).toBeTruthy();
  });

  it('buildQrString() encodes pin|rcptNo|intrlData|rcptSign', () => {
    const qr = KeKraClient.buildQrString('A000000000A', 1001, 'intrl', 'sign');
    expect(qr).toBe('A000000000A|1001|intrl|sign');
  });
});

describe('KeKraTransmissionProvider (scaffold)', () => {
  const log = new RecordingComplianceLogger();

  it('has id "ke-kra" and GOV_PORTAL_API channel', () => {
    const p = new KeKraTransmissionProvider();
    expect(p.id).toBe('ke-kra');
    expect(p.channel).toBe('GOV_PORTAL_API');
  });

  it('is NONE feedback (real-time) with no poll()', () => {
    const p: import('../transmission-provider').TransmissionProvider = new KeKraTransmissionProvider();
    expect(p.feedback).toBe('NONE');
    expect(p.poll).toBeUndefined();
  });

  it('declares configSchema with environment + taxpayerPin + deviceSerial', () => {
    const p = new KeKraTransmissionProvider();
    expect(p.configSchema?.fields.length).toBeGreaterThanOrEqual(3);
    const names = p.configSchema!.fields.map((f) => f.name);
    expect(names).toContain('environment');
    expect(names).toContain('taxpayerPin');
    expect(names).toContain('deviceSerial');
  });

  it('returns SKIPPED when no resolved config', async () => {
    const p = new KeKraTransmissionProvider();
    const result = await p.transmit([], {} as never, {} as never, 'key', log, undefined);
    expect(result.status).toBe('SKIPPED');
    expect(result.notes.some((n) => n.includes('ke-kra'))).toBe(true);
  });
});
