/**
 * SdI (Sistema di Interscambio) live round-trip test — REAL AdE API, never in CI.
 *
 * Guard:
 *   SDI_LIVE=1 SDI_ID_TRASMITTENTE=<IT+11digits> SDI_CERTIFICATE=<base64-pfx> \
 *     SDI_CERT_PASSWORD=<pass> [SDI_CHANNEL=SDICoop|PEC] \
 *     npx jest sdi-live --no-coverage
 *
 * Prerequisites (currently deferred):
 *   - AdE (Agenzia delle Entrate) intermediary accreditation
 *   - A qualified PFX/P12 digital certificate issued to the intermediary
 *   - A real SdiHttpPort implementation (SDICoop SOAP or PEC transport)
 *   See: backend/src/compliance/providers/transmission/sdi/sdi-client.ts
 *
 * Hard assertions:
 *   - transmit status MUST be PENDING (not REJECTED/SKIPPED)
 *   - ref MUST contain a non-empty idSdI (real SdI identifier)
 *   - poll MUST eventually reach CLEARED (RC notifica from SdI) within 5 min
 *   - REJECTED or SKIPPED outcomes fail the test — NOT tolerated
 *
 * See LIVE_TESTING.md for full env var documentation.
 */
export {}; // module marker

import { liveDescribe } from '../live-gate.js';

const describeLive = liveDescribe('SDI_LIVE', [
  'SDI_ID_TRASMITTENTE',
  'SDI_CERTIFICATE',
  'SDI_CERT_PASSWORD',
]);

describeLive('SdI live round-trip (AdE SDICoop)', () => {
  let idTrasmittente: string;
  let certificate: string;
  let certPassword: string;
  let transmitChannel: string;

  beforeAll(() => {
    idTrasmittente   = process.env.SDI_ID_TRASMITTENTE!;
    certificate      = process.env.SDI_CERTIFICATE!;
    certPassword     = process.env.SDI_CERT_PASSWORD!;
    transmitChannel  = process.env.SDI_CHANNEL ?? 'SDICoop';
    console.log('idTrasmittente:', idTrasmittente, '/ channel:', transmitChannel);
  });

  it('buildFatturaPa → FatturaPA XML → submit to SdI → PENDING + idSdI → poll → CLEARED', async () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY ??= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    const timestamp = Date.now();
    const companyId = 'live_sdi_' + timestamp;

    // ── Generate a FatturaPA 1.2 XML (DB-free) ──
    const { InvoiceRenderingService } = await import('../../../../modules/invoice-rendering/invoice-rendering.service.js');
    const service = new InvoiceRenderingService();
    const now = new Date();

    // Extract the IT VAT number (without IT prefix) for PIVA
    const vatNoPrefix = idTrasmittente.replace(/^IT/, '');

    const fatturapaXml = await service.buildFatturaPa({
      rawNumber: `FT-SDI-${timestamp}`,
      number: null,
      issuedAt: now,
      createdAt: now,
      company: {
        name: 'Test Cedente',
        description: null,
        foundedAt: null,
        currency: 'EUR',
        address: 'Via Test 1',
        city: 'Roma',
        postalCode: '00100',
        country: 'Italy',
        partyIdentifiers: [{ scheme: 'VAT', value: `IT${vatNoPrefix}` }],
      },
      client: {
        type: 'COMPANY',
        name: 'Test Cessionario',
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
        address: 'Via Acquirente 2',
        city: 'Milano',
        postalCode: '20100',
        country: 'Italy',
        partyIdentifiers: [{ scheme: 'VAT', value: 'IT98765432100' }],
      },
      items: [
        { name: 'Servizio test SdI', quantity: 1, unitPrice: 100, vatRate: 22, type: 'SERVICE' },
      ],
    } as any);

    console.log('FatturaPA XML length:', fatturapaXml.length);
    expect(fatturapaXml).toContain('FatturaElettronicaHeader');
    expect(fatturapaXml).toContain(vatNoPrefix);

    // ── Transmit through the real provider path ──
    const { SdiTransmissionProvider } = await import('../providers.js');
    const { TransmissionProviderRegistry } = await import('../registry.js');
    const { RecordingComplianceLogger } = await import('../../../execution/logger.js');

    const fakeResolvedConfig = {
      providerId: 'sdi',
      channel: 'SDI',
      environment: 'PROD',
      config: {
        idTrasmittente,
        transmitChannel,
        certificate,
        certificatePassword: certPassword,
      },
      isActive: true,
    };

    const stubCredentials = {
      resolve: async () => fakeResolvedConfig,
      resolveActive: async () => fakeResolvedConfig,
    };

    // The SdiTransmissionProvider constructor accepts an optional SdiHttpPort.
    // When SDI_LIVE=1 is set, the real SDICoop SOAP client must be injected here or
    // made available as the default (the current default stub throws clearly).
    // If no real httpPort is injected, the transmit will return REJECTED — which FAILS
    // this test intentionally: it signals that the implementation is incomplete.
    const reg = new TransmissionProviderRegistry([new SdiTransmissionProvider(stubCredentials as any) as any]);
    const sdi = reg.getById('sdi')!;

    const artifact = {
      role: 'AUTHORITATIVE' as const,
      syntax: 'FATTURAPA' as const,
      mime: 'application/xml',
      bytes: Buffer.from(fatturapaXml, 'utf8'),
    };

    const log = new RecordingComplianceLogger();
    const ctx = {
      supplier: {
        legalName: 'Test Cedente',
        countryCode: 'IT',
        role: 'B2B',
        identifiers: [{ scheme: 'VAT', value: `IT${vatNoPrefix}`, validated: true }],
      },
      buyer: {
        legalName: 'Test Cessionario',
        countryCode: 'IT',
        role: 'B2B',
        identifiers: [{ scheme: 'VAT', value: 'IT98765432100', validated: true }],
      },
      lines: [],
      issueDate: now,
      currency: 'EUR',
      supplierCompanyId: companyId,
    } as any;

    const transmitResult = await sdi.transmit!(
      [artifact], ctx,
      { channels: [{ type: 'SDI', providerId: 'sdi' }] } as any,
      'sdi-live-key', log, fakeResolvedConfig as any,
    );

    console.log('SdI transmit result:', JSON.stringify(transmitResult, null, 2));

    // Hard assertions — REJECTED or SKIPPED are NOT tolerated.
    if (transmitResult.status === 'REJECTED' || transmitResult.status === 'SKIPPED') {
      const notes = (transmitResult.notes ?? []).join(' | ');
      fail(`SdI transmit returned ${transmitResult.status} — hard failure. Notes: ${notes}`);
    }

    expect(transmitResult.status).toBe('PENDING');
    expect(transmitResult.ref).toBeTruthy();

    const parts = (transmitResult.ref ?? '').split('|');
    expect(parts.length).toBe(3);
    const [, idSdI] = parts;
    expect(idSdI).toBeTruthy();
    console.log('idSdI:', idSdI);

    // ── Poll for CLEARED (RC notifica from SdI — delivery receipt) ──
    const MAX_POLLS = 20;
    const POLL_INTERVAL_MS = 15_000; // SdI can take minutes to deliver
    let pollResult: any;

    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      pollResult = await sdi.poll!(transmitResult.ref!, log);
      console.log(`Poll ${i + 1}/${MAX_POLLS}:`, pollResult.status, (pollResult.notes ?? []).join(' | '));

      if (pollResult.status === 'CLEARED' || pollResult.status === 'REJECTED') break;
    }

    expect(pollResult).toBeDefined();
    console.log('Final SdI poll:', JSON.stringify(pollResult, null, 2));

    // Hard assertion: CLEARED (RC — Ricevuta di Consegna). REJECTED is hard failure.
    if (pollResult.status === 'REJECTED') {
      const notes = (pollResult.notes ?? []).join(' | ');
      fail(`SdI returned REJECTED — hard failure. Notes: ${notes}`);
    }
    expect(pollResult.status).toBe('CLEARED');
  }, 360_000); // 6 min — SdI delivery takes time
});
