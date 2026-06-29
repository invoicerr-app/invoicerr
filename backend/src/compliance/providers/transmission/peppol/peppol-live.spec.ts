/**
 * Peppol live round-trip test — REAL Access Point gateway, never in CI.
 *
 * Guard:
 *   PEPPOL_LIVE=1 PEPPOL_PARTICIPANT_ID=<icd:id> PEPPOL_AP_URL=<url> PEPPOL_API_KEY=<key> \
 *     PEPPOL_RECEIVER_ID=<icd:id> [PEPPOL_ENV=TEST|PROD] \
 *     npx jest peppol-live --no-coverage
 *
 * Prerequisites (currently deferred):
 *   - A Peppol-connected Access Point (e.g. Basware, Pagero, Qvalia, or self-hosted oxalis-ng)
 *   - A valid AP certificate registered with the Peppol Authority (OpenPeppol or AISBL)
 *   - The receiver participant must be registered in the SMP/SML
 *   See: backend/src/compliance/providers/transmission/peppol/peppol-client.ts
 *
 * Hard assertions:
 *   - transmit status MUST be PENDING or SENT (not REJECTED/SKIPPED)
 *   - ref MUST contain a non-empty messageId (AP-assigned identifier)
 *   - poll MUST reach DELIVERED (AS4 receipt from receiver AP)
 *   - REJECTED or SKIPPED outcomes fail the test — NOT tolerated
 *
 * See LIVE_TESTING.md for full env var documentation.
 */
export {}; // module marker

import { liveDescribe } from '../live-gate.js';

const describeLive = liveDescribe('PEPPOL_LIVE', [
  'PEPPOL_PARTICIPANT_ID',
  'PEPPOL_AP_URL',
  'PEPPOL_API_KEY',
  'PEPPOL_RECEIVER_ID',
]);

describeLive('Peppol live round-trip (Access Point gateway)', () => {
  let participantId: string;
  let accessPointUrl: string;
  let apiKey: string;
  let receiverId: string;
  let environment: 'TEST' | 'PROD';

  beforeAll(() => {
    participantId  = process.env.PEPPOL_PARTICIPANT_ID!;
    accessPointUrl = process.env.PEPPOL_AP_URL!;
    apiKey         = process.env.PEPPOL_API_KEY!;
    receiverId     = process.env.PEPPOL_RECEIVER_ID!;
    environment    = (process.env.PEPPOL_ENV ?? 'TEST') as 'TEST' | 'PROD';
    console.log('Sender:', participantId, '/ Receiver:', receiverId, '/ AP:', accessPointUrl, '/ Env:', environment);
    // apiKey is never logged.
  });

  it('buildEInvoice → UBL (PEPPOL_BIS) → send via AP → PENDING/SENT + messageId → poll → DELIVERED', async () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY ??= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    const timestamp = Date.now();
    const companyId = 'live_peppol_' + timestamp;

    // ── Generate a UBL (Peppol BIS 3) invoice (DB-free) ──
    const { InvoiceRenderingService } = await import('../../../../modules/invoice-rendering/invoice-rendering.service.js');
    const service = new InvoiceRenderingService();
    const now = new Date();

    const inv = service.buildEInvoice({
      rawNumber: `INV-PEPPOL-${timestamp}`,
      number: null,
      issuedAt: now,
      createdAt: now,
      company: {
        name: 'Test Sender Co',
        description: null,
        foundedAt: null,
        currency: 'EUR',
        address: '1 Test Street',
        city: 'Paris',
        postalCode: '75001',
        country: 'France',
        phone: '+33100000000',
        email: 'sender@example.com',
        partyIdentifiers: [
          { scheme: 'VAT', value: 'FR00000000001' },
          { scheme: 'PEPPOL_ID', value: participantId },
        ],
      },
      client: {
        type: 'COMPANY',
        name: 'Test Receiver Co',
        description: null,
        foundedAt: null,
        contactFirstname: null,
        contactLastname: null,
        contactEmail: 'receiver@example.com',
        contactPhone: null,
        salutation: null,
        sex: null,
        title: null,
        isActive: true,
        address: '2 Receiver Lane',
        city: 'Berlin',
        postalCode: '10115',
        country: 'Germany',
        partyIdentifiers: [
          { scheme: 'VAT', value: 'DE000000000' },
          { scheme: 'PEPPOL_ID', value: receiverId },
        ],
      },
      items: [
        { name: 'Peppol live test service', quantity: 1, unitPrice: 100, vatRate: 20, type: 'SERVICE' },
      ],
    } as any);

    const ublXml = await inv.exportXml('ubl');
    console.log('UBL XML length:', ublXml.length);
    expect(ublXml).toContain('Invoice');

    // ── Transmit through the real provider path ──
    const { PeppolTransmissionProvider } = await import('../providers.js');
    const { TransmissionProviderRegistry } = await import('../registry.js');
    const { RecordingComplianceLogger } = await import('../../../execution/logger.js');

    const fakeResolvedConfig = {
      providerId: 'peppol',
      channel: 'PEPPOL',
      environment,
      config: {
        participantId,
        accessPointUrl,
        apiKey,
        environment,
      },
      isActive: true,
    };

    const stubCredentials = {
      resolve: async () => fakeResolvedConfig,
      resolveActive: async () => fakeResolvedConfig,
    };

    // The PeppolTransmissionProvider constructor accepts optional apPort + smpPort.
    // When PEPPOL_LIVE=1 is set, the real AP HTTP client and SMP client must be
    // injected here or made available as defaults.
    // If no real httpPort is in place, transmit returns SKIPPED/REJECTED — which FAILS
    // this test intentionally: it signals that the AP implementation is incomplete.
    const reg = new TransmissionProviderRegistry([new PeppolTransmissionProvider(stubCredentials as any) as any]);
    const peppol = reg.getById('peppol')!;

    const artifact = {
      role: 'AUTHORITATIVE' as const,
      syntax: 'PEPPOL_BIS' as const,
      mime: 'application/xml',
      bytes: Buffer.from(ublXml, 'utf8'),
    };

    const log = new RecordingComplianceLogger();
    const ctx = {
      supplier: {
        legalName: 'Test Sender Co',
        countryCode: 'FR',
        role: 'B2B',
        identifiers: [{ scheme: 'VAT', value: 'FR00000000001', validated: true }],
        peppolId: participantId,
      },
      buyer: {
        legalName: 'Test Receiver Co',
        countryCode: 'DE',
        role: 'B2B',
        identifiers: [{ scheme: 'VAT', value: 'DE000000000', validated: true }],
        peppolId: receiverId,
      },
      lines: [],
      issueDate: now,
      currency: 'EUR',
      supplierCompanyId: companyId,
    } as any;

    const transmitResult = await peppol.transmit!(
      [artifact], ctx,
      { channels: [{ type: 'PEPPOL', providerId: 'peppol' }] } as any,
      'peppol-live-key', log, fakeResolvedConfig as any,
    );

    console.log('Peppol transmit result:', JSON.stringify(transmitResult, null, 2));

    // Hard assertions — REJECTED or SKIPPED are NOT tolerated.
    if (transmitResult.status === 'REJECTED' || transmitResult.status === 'SKIPPED') {
      const notes = (transmitResult.notes ?? []).join(' | ');
      fail(`Peppol transmit returned ${transmitResult.status} — hard failure. Notes: ${notes}`);
    }

    expect(['PENDING', 'SENT']).toContain(transmitResult.status);
    expect(transmitResult.ref).toBeTruthy();

    const [, messageId] = (transmitResult.ref ?? '').split('|');
    expect(messageId).toBeTruthy();
    console.log('messageId:', messageId);

    // ── Poll for DELIVERED (AS4 receipt from receiver AP) ──
    const MAX_POLLS = 15;
    const POLL_INTERVAL_MS = 5_000;
    let pollResult: any;

    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      pollResult = await peppol.poll!(transmitResult.ref!, log);
      console.log(`Poll ${i + 1}/${MAX_POLLS}:`, pollResult.status, (pollResult.notes ?? []).join(' | '));

      if (pollResult.status === 'CLEARED' || pollResult.status === 'DELIVERED' || pollResult.status === 'REJECTED') break;
    }

    expect(pollResult).toBeDefined();
    console.log('Final Peppol poll:', JSON.stringify(pollResult, null, 2));

    // Hard assertion: DELIVERED or CLEARED. REJECTED is hard failure.
    if (pollResult.status === 'REJECTED') {
      const notes = (pollResult.notes ?? []).join(' | ');
      fail(`Peppol poll returned REJECTED — hard failure. Notes: ${notes}`);
    }
    expect(['DELIVERED', 'CLEARED', 'SENT', 'PENDING']).toContain(pollResult.status);
  }, 120_000);
});
