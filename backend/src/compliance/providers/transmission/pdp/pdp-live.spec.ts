/**
 * PDP (France) live round-trip test — REAL superpdp sandbox, REAL credentials, never in CI.
 *
 * Guard: PDP_LIVE=1 (+ PDP_BASE_URL / PDP_CLIENT_ID / PDP_CLIENT_SECRET in the env, e.g.
 *   `set -a; . ./.env.pdp.local; set +a` then run).
 *
 * Proves: buildEInvoice → Factur-X (CII) → transmit to superpdp → real invoice id → poll fr:* status.
 * Never logs the client secret or the access token.
 */
export {}; // make this file a module (dynamic imports only → otherwise treated as a global script)

const LIVE = !!process.env.PDP_LIVE;

// eslint-disable-next-line no-restricted-properties
const describeLive = LIVE ? describe : describe.skip;

describeLive('PDP live round-trip (superpdp sandbox)', () => {
  let baseUrl: string;
  let clientId: string;
  let clientSecret: string;
  let apiStyle: string;

  beforeAll(() => {
    baseUrl = process.env.PDP_BASE_URL ?? '';
    clientId = process.env.PDP_CLIENT_ID ?? '';
    clientSecret = process.env.PDP_CLIENT_SECRET ?? '';
    apiStyle = process.env.PDP_API_STYLE ?? 'superpdp';
    if (!baseUrl || !clientId || !clientSecret) {
      throw new Error('PDP_LIVE=1 requires PDP_BASE_URL, PDP_CLIENT_ID, PDP_CLIENT_SECRET in the env.');
    }
  });

  it('buildEInvoice → Factur-X → submit → poll fr:* status', async () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY ??= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    const timestamp = Date.now();
    const companyId = 'live_pdp_' + timestamp;

    // ── Generate a Factur-X (CII) invoice via the production renderer (DB-free) ──
    const { InvoiceRenderingService } = await import('../../../../modules/invoice-rendering/invoice-rendering.service.js');
    const service = new InvoiceRenderingService();
    const now = new Date();
    const inv = service.buildEInvoice({
      rawNumber: `INV-${timestamp}`,
      number: null,
      issuedAt: now,
      createdAt: now,
      company: {
        name: 'Test Live Seller SARL',
        description: null,
        foundedAt: null,
        currency: 'EUR',
        address: '1 rue de Test',
        city: 'Paris',
        postalCode: '75001',
        country: 'France',
        phone: '+33100000000',
        email: 'seller@example.fr',
        partyIdentifiers: [{ scheme: 'VAT', value: 'FR00315143296' }, { scheme: 'LEGAL_ID', value: '315143296' }],
      },
      client: {
        type: 'COMPANY',
        name: 'Test Live Buyer SAS',
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
        address: '2 avenue du Client',
        city: 'Lyon',
        postalCode: '69002',
        country: 'France',
        partyIdentifiers: [{ scheme: 'VAT', value: 'FR23334173221' }, { scheme: 'LEGAL_ID', value: '552081317' }],
      },
      items: [
        { name: 'Prestation de test', quantity: 1, unitPrice: 100, vatRate: 20, type: 'SERVICE' },
      ],
    } as any);

    const facturxXml = await inv.exportXml('facturx');
    console.log('Factur-X XML length:', facturxXml.length);
    console.log('XML has SIREN 315143296:', facturxXml.includes('315143296'), '| has SpecifiedLegalOrganization:', facturxXml.includes('SpecifiedLegalOrganization'));
    expect(facturxXml).toContain('CrossIndustryInvoice');

    // ── Transmit through the real provider path ──
    const { PdpTransmissionProvider } = await import('../providers.js');
    const { TransmissionProviderRegistry } = await import('../registry.js');
    const { RecordingComplianceLogger } = await import('../../../execution/logger.js');

    const fakeResolvedConfig = {
      providerId: 'pdp',
      channel: 'PDP',
      environment: 'sandbox',
      config: { baseUrl, clientId, clientSecret, apiStyle },
      isActive: true,
    };

    // Stub credentials port so poll() can re-resolve + re-authenticate (mirrors prod registry).
    const stubCredentials = { resolve: async () => fakeResolvedConfig, resolveActive: async () => fakeResolvedConfig };
    const reg = new TransmissionProviderRegistry([new PdpTransmissionProvider(stubCredentials as any) as any]);
    const pdp = reg.getById('pdp')!;

    const artifact = {
      role: 'AUTHORITATIVE' as const,
      syntax: 'FACTURX' as const,
      mime: 'application/xml',
      bytes: Buffer.from(facturxXml, 'utf8'),
    };

    const log = new RecordingComplianceLogger();
    const ctx = {
      supplier: { legalName: 'Test Live Seller SARL', countryCode: 'FR', role: 'B2B', identifiers: [{ scheme: 'VAT', value: 'FR40303265045', validated: true }] },
      buyer: { legalName: 'Test Live Buyer SAS', countryCode: 'FR', role: 'B2B', identifiers: [{ scheme: 'VAT', value: 'FR23334173221', validated: true }] },
      lines: [], issueDate: now, currency: 'EUR', supplierCompanyId: companyId, externalRef: `INV-${timestamp}`,
    } as any;

    const transmitResult = await pdp.transmit!(
      [artifact], ctx,
      { channels: [{ type: 'PDP', providerId: 'pdp' }] } as any,
      'pdp-live-key', log, fakeResolvedConfig as any,
    );
    console.log('Transmit result:', JSON.stringify(transmitResult, null, 2));

    // Real proof: must reach superpdp and come back with a deposit/invoice ref — a local error
    // (auth, format, network) surfaces as REJECTED with notes → FAILURE, not a tolerated outcome.
    expect(transmitResult.status).toBe('PENDING');
    expect(transmitResult.ref).toBeTruthy();
    const [, depositId] = transmitResult.ref!.split('|');
    expect(depositId).toBeTruthy();
    console.log('Deposit/invoice id:', depositId);

    // ── Poll for the real fr:* lifecycle status ──
    await new Promise((r) => setTimeout(r, 4000));
    let pollResult = await pdp.poll!(transmitResult.ref!, log);
    for (let i = 0; i < 8 && pollResult.status === 'PENDING'; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      pollResult = await pdp.poll!(transmitResult.ref!, log);
    }
    console.log('Poll result:', JSON.stringify(pollResult, null, 2));

    const noteStr = (pollResult.notes ?? []).join(' ');
    expect(noteStr).not.toMatch(/error|ENOENT|no credentials/i);
    expect(['PENDING', 'SENT', 'DELIVERED', 'CLEARED', 'REJECTED']).toContain(pollResult.status);
  }, 90_000);
});
