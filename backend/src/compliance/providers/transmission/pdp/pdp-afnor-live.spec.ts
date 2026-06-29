/**
 * PDP-AFNOR live round-trip test — REAL superpdp sandbox (AFNOR-style API), never in CI.
 *
 * Guard:
 *   PDP_AFNOR_LIVE=1 PDP_BASE_URL=<url> PDP_CLIENT_ID=<id> PDP_CLIENT_SECRET=<secret> \
 *     [PDP_SELLER_ROUTING=<id>] [PDP_BUYER_ROUTING=<id>] \
 *     npx jest pdp-afnor-live --no-coverage
 *
 * Uses apiStyle='afnor' → POST /afnor-flow/v1/flows (proven live: flowId i_90103 assigned).
 *
 * Hard assertions:
 *   - transmit status MUST be PENDING (not REJECTED/SKIPPED)
 *   - ref MUST contain a non-empty flowId (real authority reference from superpdp)
 *   - REJECTED or SKIPPED outcomes fail the test — NOT tolerated
 *
 * Note: AFNOR content validation in the superpdp sandbox may reject certain test invoices
 * (known diagnostics pending). The transport layer must succeed (PENDING + flowId).
 *
 * See LIVE_TESTING.md for full env var documentation.
 */
export {}; // module marker — dynamic imports only

import { liveDescribe } from '../live-gate.js';

const describeLive = liveDescribe('PDP_AFNOR_LIVE', ['PDP_BASE_URL', 'PDP_CLIENT_ID', 'PDP_CLIENT_SECRET']);

// Sandbox routing addresses (superpdp: pdp_siren=315143296, Burger Queen=1422, Tricatel=1421)
const DEFAULT_SELLER_ROUTING = '315143296_1422';
const DEFAULT_BUYER_ROUTING  = '315143296_1421';

describeLive('PDP-AFNOR live round-trip (superpdp AFNOR-style flow)', () => {
  let baseUrl: string;
  let clientId: string;
  let clientSecret: string;
  let sellerRouting: string;
  let buyerRouting: string;

  beforeAll(() => {
    baseUrl       = process.env.PDP_BASE_URL!;
    clientId      = process.env.PDP_CLIENT_ID!;
    clientSecret  = process.env.PDP_CLIENT_SECRET!;
    sellerRouting = process.env.PDP_SELLER_ROUTING ?? DEFAULT_SELLER_ROUTING;
    buyerRouting  = process.env.PDP_BUYER_ROUTING  ?? DEFAULT_BUYER_ROUTING;
    // Secrets are never logged — only non-sensitive identifiers.
    console.log('Routing — seller:', sellerRouting, 'buyer:', buyerRouting);
  });

  it('buildEInvoice → Factur-X (CII) → AFNOR flow → PENDING + real flowId', async () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY ??= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    const timestamp = Date.now();
    const companyId = 'live_pdp_afnor_' + timestamp;

    // ── Generate Factur-X (CII) invoice ──
    const { InvoiceRenderingService } = await import('../../../../modules/invoice-rendering/invoice-rendering.service.js');
    const service = new InvoiceRenderingService();
    const now = new Date();

    const inv = service.buildEInvoice({
      rawNumber: `INV-AFNOR-${timestamp}`,
      number: null,
      issuedAt: now,
      createdAt: now,
      company: {
        name: 'Burger Queen',
        description: null,
        foundedAt: null,
        currency: 'EUR',
        address: '809 avenue du Languedoc',
        city: 'Millau',
        postalCode: '12100',
        country: 'France',
        phone: '+33100000000',
        email: 'seller@example.fr',
        partyIdentifiers: [{ scheme: 'VAT', value: 'FR18000000002' }, { scheme: 'LEGAL_ID', value: '000000002' }],
      },
      client: {
        type: 'COMPANY',
        name: 'Tricatel',
        description: null,
        foundedAt: null,
        contactFirstname: null,
        contactLastname: null,
        contactEmail: 'buyer@example.fr',
        contactPhone: null,
        salutation: null,
        sex: null,
        title: null,
        isActive: true,
        address: '1 rue de Tricatel',
        city: 'Paris',
        postalCode: '75001',
        country: 'France',
        partyIdentifiers: [{ scheme: 'VAT', value: 'FR15000000001' }, { scheme: 'LEGAL_ID', value: '000000001' }],
      },
      items: [{ name: 'Prestation AFNOR test', quantity: 1, unitPrice: 100, vatRate: 20, type: 'SERVICE' }],
    } as any);

    const facturxXml = await inv.exportXml('cii');
    console.log('Factur-X XML length:', facturxXml.length);
    expect(facturxXml).toContain('CrossIndustryInvoice');

    // ── Transmit via PdpTransmissionProvider (apiStyle: 'afnor') ──
    const { PdpTransmissionProvider } = await import('../providers.js');
    const { TransmissionProviderRegistry } = await import('../registry.js');
    const { RecordingComplianceLogger } = await import('../../../execution/logger.js');

    const fakeResolvedConfig = {
      providerId: 'pdp',
      channel: 'PDP',
      environment: 'sandbox',
      config: {
        baseUrl,
        clientId,
        clientSecret,
        apiStyle: 'afnor',
        sellerEndpointId: sellerRouting,
        buyerEndpointId:  buyerRouting,
      },
      isActive: true,
    };

    const stubCredentials = {
      resolve: async () => fakeResolvedConfig,
      resolveActive: async () => fakeResolvedConfig,
    };
    const reg = new TransmissionProviderRegistry([new PdpTransmissionProvider(stubCredentials as any) as any]);
    const pdp = reg.getById('pdp')!;

    const artifact = {
      role: 'AUTHORITATIVE' as const,
      syntax: 'EN16931_CII' as const,
      mime: 'application/xml',
      bytes: Buffer.from(facturxXml, 'utf8'),
    };

    const log = new RecordingComplianceLogger();
    const ctx = {
      supplier: {
        legalName: 'Burger Queen',
        countryCode: 'FR',
        role: 'B2B',
        identifiers: [{ scheme: 'VAT', value: 'FR18000000002', validated: true }],
      },
      buyer: {
        legalName: 'Tricatel',
        countryCode: 'FR',
        role: 'B2B',
        identifiers: [{ scheme: 'VAT', value: 'FR15000000001', validated: true }],
      },
      lines: [],
      issueDate: now,
      currency: 'EUR',
      supplierCompanyId: companyId,
      externalRef: `INV-AFNOR-${timestamp}`,
    } as any;

    const transmitResult = await pdp.transmit!(
      [artifact], ctx,
      { channels: [{ type: 'PDP', providerId: 'pdp' }] } as any,
      'afnor-live-key', log, fakeResolvedConfig as any,
    );

    console.log('AFNOR transmit result:', JSON.stringify(transmitResult, null, 2));

    // Hard assertions — REJECTED or SKIPPED are NOT tolerated.
    if (transmitResult.status === 'REJECTED' || transmitResult.status === 'SKIPPED') {
      const notes = (transmitResult.notes ?? []).join(' | ');
      fail(`PDP-AFNOR transmit returned ${transmitResult.status} — hard failure. Notes: ${notes}`);
    }

    // PENDING is the expected outcome: AFNOR API accepted the flow and assigned a flowId.
    expect(transmitResult.status).toBe('PENDING');
    expect(transmitResult.ref).toBeTruthy();

    const [, flowId] = (transmitResult.ref ?? '').split('|');
    expect(flowId).toBeTruthy();
    console.log('AFNOR flowId:', flowId);

    // The flowId must be a non-empty string from the real authority (superpdp sandbox).
    expect(typeof flowId).toBe('string');
    expect(flowId.length).toBeGreaterThan(0);
  }, 60_000);
});
