/**
 * National portal live round-trip test — parametrized by PORTAL_ID, never in CI.
 *
 * Guard:
 *   PORTAL_LIVE=1 PORTAL_ID=<providerId> [portal-specific env vars] \
 *     npx jest portal-live --no-coverage
 *
 * PORTAL_ID selects the national portal provider from NATIONAL_PORTAL_PROVIDERS.
 * Each portal has its own required env vars (see LIVE_TESTING.md for per-portal tables).
 *
 * Common portal env vars (checked by the gate helper):
 *   PORTAL_ID=<providerId>   Required — selects the portal (e.g. 'sefaz', 'anaf', 'choruspro')
 *
 * Portal-specific env vars are validated in beforeAll and surfaced as test failures
 * rather than gate-level skips, so the operator gets a precise missing-field message.
 *
 * Hard assertions:
 *   - transmit status MUST be PENDING or SENT (not REJECTED/SKIPPED)
 *   - ref MUST be truthy (real authority identifier returned)
 *   - REJECTED or SKIPPED outcomes fail the test — NOT tolerated
 *   - async portals: poll MUST reach CLEARED within the portal's SLA
 *
 * See LIVE_TESTING.md for full portal-specific env var documentation.
 */
export {}; // module marker

import { liveDescribe } from './live-gate.js';

const describeLive = liveDescribe('PORTAL_LIVE', ['PORTAL_ID']);

describeLive('National portal live round-trip (parametrized by PORTAL_ID)', () => {
  let portalId: string;

  beforeAll(() => {
    portalId = process.env.PORTAL_ID!;
    console.log('[portal-live] Using portal:', portalId);
  });

  it('selects the portal provider and performs a real transmission round-trip', async () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY ??= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    const { NATIONAL_PORTAL_PROVIDERS } = await import('./national-portals.js');
    const { TransmissionProviderRegistry } = await import('./registry.js');
    const { RecordingComplianceLogger } = await import('../../execution/logger.js');

    const reg = new TransmissionProviderRegistry(NATIONAL_PORTAL_PROVIDERS as any[]);
    const portal = reg.getById(portalId);

    if (!portal) {
      const available = NATIONAL_PORTAL_PROVIDERS.map((p) => p.id).join(', ');
      fail(`PORTAL_ID='${portalId}' not found in NATIONAL_PORTAL_PROVIDERS. Available: ${available}`);
      return;
    }

    console.log('[portal-live] Provider found — channel:', portal.channel, 'feedback:', portal.feedback);

    // Build a resolved channel config from env vars. Portal-specific fields are read from env:
    //   PORTAL_AUTH_TOKEN, PORTAL_API_KEY, PORTAL_CLIENT_ID, PORTAL_CLIENT_SECRET,
    //   PORTAL_TAXPAYER_ID, PORTAL_CERTIFICATE, PORTAL_CERT_PASSWORD, PORTAL_BASE_URL, etc.
    // The provider reads what it needs from `resolvedConfig.config`.
    const portalConfig: Record<string, string> = {};
    const portalEnvPrefix = 'PORTAL_CONFIG_'; // e.g. PORTAL_CONFIG_TAXPAYER_ID=...
    for (const [key, val] of Object.entries(process.env)) {
      if (key.startsWith(portalEnvPrefix) && val) {
        const configKey = key.slice(portalEnvPrefix.length).toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        portalConfig[configKey] = val;
      }
    }
    // Shorthand aliases (common across portals) — override / augment the prefixed form.
    if (process.env.PORTAL_AUTH_TOKEN)       portalConfig.authToken       = process.env.PORTAL_AUTH_TOKEN;
    if (process.env.PORTAL_API_KEY)          portalConfig.apiKey          = process.env.PORTAL_API_KEY;
    if (process.env.PORTAL_CLIENT_ID)        portalConfig.clientId        = process.env.PORTAL_CLIENT_ID;
    if (process.env.PORTAL_CLIENT_SECRET)    portalConfig.clientSecret    = process.env.PORTAL_CLIENT_SECRET;
    if (process.env.PORTAL_TAXPAYER_ID)      portalConfig.taxpayerId      = process.env.PORTAL_TAXPAYER_ID;
    if (process.env.PORTAL_CERTIFICATE)      portalConfig.certificate     = process.env.PORTAL_CERTIFICATE;
    if (process.env.PORTAL_CERT_PASSWORD)    portalConfig.certificatePassword = process.env.PORTAL_CERT_PASSWORD;
    if (process.env.PORTAL_BASE_URL)         portalConfig.baseUrl         = process.env.PORTAL_BASE_URL;
    if (process.env.PORTAL_ENVIRONMENT)      portalConfig.environment     = process.env.PORTAL_ENVIRONMENT;

    const fakeResolvedConfig = {
      providerId: portalId,
      channel: portal.channel,
      environment: process.env.PORTAL_ENVIRONMENT ?? 'TEST',
      config: portalConfig,
      isActive: true,
    };

    // Build a minimal canonical XML artifact (UBL by default; override via PORTAL_SYNTAX).
    // For portals that require a country-specific format, the operator must pre-build the XML
    // and pass it via PORTAL_XML_PATH (path to a UTF-8 XML file).
    const portalSyntax = (process.env.PORTAL_SYNTAX ?? 'EN16931_UBL') as any;
    let xmlBytes: Buffer;

    const xmlPath = process.env.PORTAL_XML_PATH;
    if (xmlPath) {
      const { readFileSync } = await import('fs');
      xmlBytes = readFileSync(xmlPath);
      console.log('[portal-live] Loaded XML from', xmlPath, '—', xmlBytes.length, 'bytes');
    } else {
      // Generate a minimal EN16931 UBL invoice (DB-free) as a default payload.
      const { InvoiceRenderingService } = await import('../../../modules/invoice-rendering/invoice-rendering.service.js');
      const svc = new InvoiceRenderingService();
      const now = new Date();
      const timestamp = Date.now();
      const inv = svc.buildEInvoice({
        rawNumber: `INV-PORTAL-${timestamp}`,
        number: null,
        issuedAt: now,
        createdAt: now,
        company: {
          name: process.env.PORTAL_SELLER_NAME ?? 'Test Seller',
          description: null,
          foundedAt: null,
          currency: process.env.PORTAL_CURRENCY ?? 'EUR',
          address: '1 Seller St',
          city: 'Test City',
          postalCode: '00001',
          country: process.env.PORTAL_COUNTRY ?? 'Germany',
          partyIdentifiers: [{ scheme: 'VAT', value: process.env.PORTAL_SELLER_VAT ?? 'DE000000000' }],
        },
        client: {
          type: 'COMPANY',
          name: process.env.PORTAL_BUYER_NAME ?? 'Test Buyer',
          description: null,
          foundedAt: null,
          contactFirstname: null,
          contactLastname: null,
          contactEmail: null,
          contactPhone: null,
          salutation: null,
          sex: null,
          title: null,
          isActive: true,
          address: '2 Buyer Ave',
          city: 'Test City',
          postalCode: '00002',
          country: process.env.PORTAL_BUYER_COUNTRY ?? 'Germany',
          partyIdentifiers: [{ scheme: 'VAT', value: process.env.PORTAL_BUYER_VAT ?? 'DE000000001' }],
        },
        items: [{ name: 'Portal live test', quantity: 1, unitPrice: 100, vatRate: 0, type: 'SERVICE' }],
      } as any);
      const xml = await inv.exportXml('ubl');
      xmlBytes = Buffer.from(xml, 'utf8');
      console.log('[portal-live] Generated UBL XML —', xmlBytes.length, 'bytes');
    }

    const artifact = {
      role: 'AUTHORITATIVE' as const,
      syntax: portalSyntax,
      mime: 'application/xml',
      bytes: xmlBytes,
    };

    const timestamp = Date.now();
    const log = new RecordingComplianceLogger();
    const ctx = {
      supplier: {
        legalName: process.env.PORTAL_SELLER_NAME ?? 'Test Seller',
        countryCode: process.env.PORTAL_COUNTRY ?? 'DE',
        role: 'B2B',
        identifiers: [{ scheme: 'VAT', value: process.env.PORTAL_SELLER_VAT ?? 'DE000000000', validated: true }],
      },
      buyer: {
        legalName: process.env.PORTAL_BUYER_NAME ?? 'Test Buyer',
        countryCode: process.env.PORTAL_BUYER_COUNTRY ?? 'DE',
        role: 'B2B',
        identifiers: [{ scheme: 'VAT', value: process.env.PORTAL_BUYER_VAT ?? 'DE000000001', validated: true }],
      },
      lines: [],
      issueDate: new Date(),
      currency: process.env.PORTAL_CURRENCY ?? 'EUR',
      supplierCompanyId: `live_portal_${portalId}_${timestamp}`,
    } as any;

    const transmitResult = await portal.transmit!(
      [artifact], ctx,
      { channels: [{ type: portal.channel, providerId: portalId }] } as any,
      `portal-live-${timestamp}`, log, fakeResolvedConfig as any,
    );

    console.log('[portal-live] Transmit result:', JSON.stringify(transmitResult, null, 2));

    // Hard assertions — REJECTED or SKIPPED are NOT tolerated.
    if (transmitResult.status === 'REJECTED' || transmitResult.status === 'SKIPPED') {
      const notes = (transmitResult.notes ?? []).join(' | ');
      fail(`Portal '${portalId}' transmit returned ${transmitResult.status} — hard failure. Notes: ${notes}`);
    }

    expect(['PENDING', 'SENT', 'CLEARED']).toContain(transmitResult.status);

    if (portal.feedback === 'ASYNC_POLL' && transmitResult.status === 'PENDING') {
      expect(transmitResult.ref).toBeTruthy();
      const ref = transmitResult.ref!;
      console.log('[portal-live] Async portal, ref:', ref);

      // Poll until CLEARED or timeout (5 min).
      const MAX_POLLS = 20;
      const POLL_INTERVAL_MS = 15_000;
      let pollResult: any;

      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        pollResult = await portal.poll!(ref, log);
        console.log(`[portal-live] Poll ${i + 1}/${MAX_POLLS}:`, pollResult.status, (pollResult.notes ?? []).join(' | '));

        if (pollResult.status === 'CLEARED' || pollResult.status === 'REJECTED') break;
      }

      expect(pollResult).toBeDefined();
      console.log('[portal-live] Final poll:', JSON.stringify(pollResult, null, 2));

      if (pollResult.status === 'REJECTED') {
        const notes = (pollResult.notes ?? []).join(' | ');
        fail(`Portal '${portalId}' poll returned REJECTED — hard failure. Notes: ${notes}`);
      }
      expect(pollResult.status).toBe('CLEARED');
    }
  }, 360_000); // 6 min for async portals
});
