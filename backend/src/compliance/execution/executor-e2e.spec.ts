/**
 * Executor end-to-end routing tests (mocked providers).
 * Proves: executor.execute() → builds correct artifacts → resolves credentials → provider.transmit() called.
 * No HTTP calls. Pure integration of executor + format registry + transmission registry.
 */
import { ComplianceExecutor } from './executor';
import { FormatProviderRegistry } from '../providers/format/registry';
import { TransmissionProviderRegistry } from '../providers/transmission/registry';
import { ChannelCredentialsPort, ResolvedChannelConfig } from '../providers/transmission/channel-credentials-port';
import { TransmissionProvider } from '../providers/transmission/transmission-provider';
import { TransactionContext } from '../canonical/canonical-document';
import { CompliancePlan } from '../engine/compliance-engine';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeFrPlan(companyId: string): CompliancePlan {
  return {
    supplier: { country: 'FR', confidence: 'OFFICIAL' },
    buyer: { country: 'FR', confidence: 'OFFICIAL' },
    classification: { buyerRole: 'B2B', crossBorder: false, supplyTypes: ['SERVICES'] },
    tax: { kind: 'VAT', rate: 20, lines: [], totals: { net: 10000, tax: 2000, gross: 12000 } } as any,
    taxSystemKind: 'VAT',
    regime: { model: 'DECENTRALIZED_CTC', blocking: false },
    artifacts: [
      { role: 'AUTHORITATIVE', syntax: 'EN16931_CII' },
      { role: 'HUMAN', syntax: 'FACTURX' },
    ],
    channels: [{ type: 'PDP', providerId: 'pdp' }],
    numbering: { model: 'GAPLESS_SELF', seriesScope: 'ENTITY' },
    lifecycle: { immutableAfter: 'ISSUE', correctionModel: 'CREDIT_NOTE', cancellation: { allowed: true, requiresAuthorityAck: false } },
    archival: { retentionYears: 10, archivedForm: 'BOTH', integrity: 'HASH_CHAIN' },
    reporting: [],
    confidence: 'OFFICIAL',
    warnings: [],
  };
}

function makePlPlan(companyId: string): CompliancePlan {
  return {
    supplier: { country: 'PL', confidence: 'OFFICIAL' },
    buyer: { country: 'PL', confidence: 'OFFICIAL' },
    classification: { buyerRole: 'B2B', crossBorder: false, supplyTypes: ['GOODS'] },
    tax: { kind: 'VAT', rate: 23, lines: [], totals: { net: 10000, tax: 2300, gross: 12300 } } as any,
    taxSystemKind: 'VAT',
    regime: { model: 'CLEARANCE', blocking: true },
    artifacts: [
      { role: 'AUTHORITATIVE', syntax: 'FA_VAT' },
      { role: 'HUMAN', syntax: 'PLAIN_PDF' },
    ],
    channels: [{ type: 'GOV_PORTAL_API', providerId: 'ksef' }],
    numbering: { model: 'GAPLESS_SELF', seriesScope: 'ENTITY' },
    lifecycle: { immutableAfter: 'CLEARANCE', correctionModel: 'CORRECTIVE_INVOICE', cancellation: { allowed: false, requiresAuthorityAck: true } },
    archival: { retentionYears: 10, archivedForm: 'BOTH', integrity: 'SIGNED' },
    reporting: [],
    confidence: 'OFFICIAL',
    warnings: [],
  };
}

function makeCtx(companyId: string, country: string): TransactionContext {
  return {
    supplier: { legalName: 'Test Co', countryCode: country, role: 'B2B', identifiers: [] },
    buyer: { legalName: 'Buyer Co', countryCode: country, role: 'B2B', identifiers: [] },
    lines: [{ id: 'l1', description: 'test', quantity: 1, unitNetMinor: 10000, supplyType: 'GOODS' }],
    issueDate: new Date('2027-01-15'),
    currency: country === 'FR' ? 'EUR' : 'PLN',
    supplierCompanyId: companyId,
    externalRef: `INV-TEST-${companyId}`,
  } as TransactionContext;
}

function makeMockFormatProvider(syntax: string, bytes: Buffer) {
  return {
    id: `mock-${syntax}`,
    supports: jest.fn((s: string) => s === syntax),
    build: jest.fn().mockResolvedValue({ role: 'AUTHORITATIVE', syntax, mime: 'application/xml', bytes }),
    validate: jest.fn().mockReturnValue({ valid: true, errors: [], warnings: [] }),
  };
}

function makeMockTransmitProvider(id: string, channel: string, transmitResult: any): TransmissionProvider & { transmit: jest.Mock } {
  return {
    id,
    channel: channel as any,
    feedback: 'ASYNC_CALLBACK',
    configSchema: { fields: [{ type: 'text', name: 'dummy', label: 'Dummy', required: false }] },
    transmit: jest.fn().mockResolvedValue(transmitResult),
  } as any;
}

function mockCredentials(config: ResolvedChannelConfig | null): ChannelCredentialsPort {
  return {
    resolve: jest.fn().mockResolvedValue(null),
    resolveActive: jest.fn().mockResolvedValue(config),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

const CII_BYTES = Buffer.from('<?xml version="1.0"?><CrossIndustryInvoice/>', 'utf8');
const PDF_BYTES = Buffer.from('%PDF-1.4 fake facturx', 'utf8');
const FA_VAT_BYTES = Buffer.from('<?xml version="1.0"?><Faktura/>', 'utf8');
const PDF_PLAIN_BYTES = Buffer.from('%PDF-1.4 plain', 'utf8');

const FR_PDP_CONFIG: ResolvedChannelConfig = {
  providerId: 'pdp',
  channel: 'PDP',
  environment: 'sandbox',
  config: { baseUrl: 'https://api.superpdp.tech', clientId: 'id', clientSecret: 'secret', apiStyle: 'superpdp' },
  isActive: true,
};

const PL_KSEF_CONFIG: ResolvedChannelConfig = {
  providerId: 'ksef',
  channel: 'GOV_PORTAL_API',
  environment: 'test',
  config: { nip: '1234567890', authToken: 'test-token' },
  isActive: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('ComplianceExecutor — end-to-end channel routing', () => {
  const COMPANY_FR = 'company-fr-test';
  const COMPANY_PL = 'company-pl-test';

  // ── FR + PDP ─────────────────────────────────────────────────────────────

  describe('France → PDP', () => {
    it('routes EN16931_CII artifact to PDP provider when config is active', async () => {
      const ciiProvider = makeMockFormatProvider('EN16931_CII', CII_BYTES);
      const facturxProvider = makeMockFormatProvider('FACTURX', PDF_BYTES);
      const formatRegistry = new FormatProviderRegistry([ciiProvider as any, facturxProvider as any]);

      const pdpMock = makeMockTransmitProvider('pdp', 'PDP', { channel: 'PDP', status: 'PENDING', ref: `${COMPANY_FR}|99999`, notes: [] });
      const credentials = mockCredentials(FR_PDP_CONFIG);

      const txRegistry = new TransmissionProviderRegistry({ credentials });
      // Replace real PDP provider with mock by patching the internal maps
      (txRegistry as any).byId.set('pdp', pdpMock);
      (txRegistry as any).byChannel.set('PDP', pdpMock);

      const executor = new ComplianceExecutor({ formats: formatRegistry, transmission: txRegistry });

      const result = await executor.execute(makeCtx(COMPANY_FR, 'FR'), makeFrPlan(COMPANY_FR), { idempotencyKey: 'test-fr' });

      // credentials resolved for company + provider
      expect(credentials.resolveActive).toHaveBeenCalledWith(COMPANY_FR, 'pdp');

      // PDP provider transmit was called
      expect(pdpMock.transmit).toHaveBeenCalledTimes(1);
      const [calledArtifacts, , , , , calledConfig] = pdpMock.transmit.mock.calls[0];

      // EN16931_CII artifact is present (the CII bytes)
      const ciiArtifact = calledArtifacts.find((a: any) => a.syntax === 'EN16931_CII');
      expect(ciiArtifact).toBeTruthy();
      expect(Buffer.from(ciiArtifact.bytes)).toEqual(CII_BYTES);

      // resolvedConfig was passed
      expect(calledConfig).toMatchObject({ providerId: 'pdp', isActive: true });

      // Transmission result is PENDING
      expect(result.transmissions[0].status).toBe('PENDING');
    });

    it('SKIPS PDP when no company config exists', async () => {
      const ciiProvider = makeMockFormatProvider('EN16931_CII', CII_BYTES);
      const formatRegistry = new FormatProviderRegistry([ciiProvider as any]);

      const credentials = mockCredentials(null); // no active config
      const txRegistry = new TransmissionProviderRegistry({ credentials });

      const executor = new ComplianceExecutor({ formats: formatRegistry, transmission: txRegistry });

      const result = await executor.execute(makeCtx(COMPANY_FR, 'FR'), makeFrPlan(COMPANY_FR));

      expect(credentials.resolveActive).toHaveBeenCalledWith(COMPANY_FR, 'pdp');
      expect(result.transmissions[0].status).toBe('SKIPPED');
      expect(result.transmissions[0].notes.join(' ')).toMatch(/not configured for company/);
    });
  });

  // ── PL + KSeF ────────────────────────────────────────────────────────────

  describe('Poland → KSeF', () => {
    it('routes FA_VAT artifact to KSeF provider when config is active', async () => {
      const faVatProvider = makeMockFormatProvider('FA_VAT', FA_VAT_BYTES);
      const pdfProvider = makeMockFormatProvider('PLAIN_PDF', PDF_PLAIN_BYTES);
      const formatRegistry = new FormatProviderRegistry([faVatProvider as any, pdfProvider as any]);

      const ksefMock = makeMockTransmitProvider('ksef', 'GOV_PORTAL_API', { channel: 'GOV_PORTAL_API', status: 'PENDING', ref: `${COMPANY_PL}|session|inv`, notes: [] });
      const credentials = mockCredentials(PL_KSEF_CONFIG);

      const txRegistry = new TransmissionProviderRegistry({ credentials });
      (txRegistry as any).byId.set('ksef', ksefMock);

      const executor = new ComplianceExecutor({ formats: formatRegistry, transmission: txRegistry });

      const result = await executor.execute(makeCtx(COMPANY_PL, 'PL'), makePlPlan(COMPANY_PL), { idempotencyKey: 'test-pl' });

      expect(credentials.resolveActive).toHaveBeenCalledWith(COMPANY_PL, 'ksef');
      expect(ksefMock.transmit).toHaveBeenCalledTimes(1);

      const [calledArtifacts] = ksefMock.transmit.mock.calls[0];
      const faVatArtifact = calledArtifacts.find((a: any) => a.syntax === 'FA_VAT');
      expect(faVatArtifact).toBeTruthy();
      expect(Buffer.from(faVatArtifact.bytes)).toEqual(FA_VAT_BYTES);

      expect(result.transmissions[0].status).toBe('PENDING');
    });

    it('SKIPS KSeF when no company config exists', async () => {
      const faVatProvider = makeMockFormatProvider('FA_VAT', FA_VAT_BYTES);
      const formatRegistry = new FormatProviderRegistry([faVatProvider as any]);

      const credentials = mockCredentials(null);
      const txRegistry = new TransmissionProviderRegistry({ credentials });

      const executor = new ComplianceExecutor({ formats: formatRegistry, transmission: txRegistry });

      const result = await executor.execute(makeCtx(COMPANY_PL, 'PL'), makePlPlan(COMPANY_PL));

      expect(credentials.resolveActive).toHaveBeenCalledWith(COMPANY_PL, 'ksef');
      expect(result.transmissions[0].status).toBe('SKIPPED');
    });
  });
});
