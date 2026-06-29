/**
 * KSeF live round-trip test — REAL API, REAL token, never in CI.
 *
 * Guard: KSEF_LIVE=1 KSEF_AUTH_TOKEN=<token> [KSEF_NIP=<nip>] npx jest ksef-live --no-coverage
 *
 * Two runs:
 *   Run A — crypto guard: plaintext placeholder (proves encryption round-trip, no 435)
 *   Run B — valid FA(2) via buildFaVat: proves real invoice acceptance → CLEARED + ksefNumber
 *
 * Never logs token, XML, or accessToken.
 *
 * See LIVE_TESTING.md for full env var documentation.
 */
import { liveDescribe } from '../live-gate.js';

// KSEF_AUTH_TOKEN is the canonical cred; KSEF_TOKEN is the legacy alias.
// The gate checks KSEF_AUTH_TOKEN; if only KSEF_TOKEN is set the beforeAll will surface it.
const describeLive = liveDescribe('KSEF_LIVE', ['KSEF_AUTH_TOKEN']);

/** Minimal plaintext for Run A — crypto round-trip guard. */
const CRYPTO_GUARD_XML =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<Faktura xmlns="http://crd.gov.pl/wzor/2023/06/29/12648/">' +
  '<Naglowek><KodFormularza kodSystemowy="FA (2)" wersjaSchemy="1-0E">FA</KodFormularza>' +
  '<WariantFormularza>2</WariantFormularza>' +
  '<DataWytworzeniaFa>2026-06-28T12:00:00</DataWygenerowaniaFa>' +
  '<SystemInfo>invoicerr-crypto-guard</SystemInfo></Naglowek>' +
  '<Podmiot1><PrefiksPodatnika>PL</PrefiksPodatnika>' +
  '<DaneIdentyfikacyjne><NIP>1234567802</NIP><Nazwa>Test Seller</Nazwa></DaneIdentyfikacyjne>' +
  '<Adres><KodKraju>PL</KodKraju><AdresL1>ul. Testowa 1</AdresL1></Adres></Podmiot1>' +
  '<Podmiot2><DaneIdentyfikacyjne><NIP>1234567803</NIP><Nazwa>Test Buyer</Nazwa></DaneIdentyfikacyjne>' +
  '<Adres><KodKraju>PL</KodKraju><AdresL1>ul. Kupiecka 2</AdresL1></Adres></Podmiot2>' +
  '<Fa><KodWaluty>PLN</KodWaluty><P_1>2026-06-28</P_1><P_2>INV-CRYPTO-001</P_2>' +
  '<P_13_1>100.00</P_13_1><P_14_1>23.00</P_14_1><P_15>123.00</P_15>' +
  '<Adnotacje><P_16>2</P_16><P_17>2</P_17><P_18>2</P_18><P_18A>2</P_18A>' +
  '<Zwolnienie><P_19N>1</P_19N></Zwolnienie>' +
  '<NoweSrodkiTransportu><P_22N>1</P_22N></NoweSrodkiTransportu>' +
  '<P_23>2</P_23><PMarzy><P_PMarzyN>1</P_PMarzyN></PMarzy></Adnotacje>' +
  '<RodzajFaktury>VAT</RodzajFaktury>' +
  '<FaWiersz><NrWierszaFa>1</NrWierszaFa><P_7>Test item</P_7><PKWiU>00</PKWiU>' +
  '<P_8A>szt.</P_8A><P_8B>1</P_8B><P_9A>100</P_9A><P_11>100.00</P_11><P_12>23</P_12>' +
  '</FaWiersz></Fa></Faktura>';

describeLive('KSeF live round-trip', () => {
  let testToken: string;
  let testNip: string;

  beforeAll(() => {
    testToken = process.env.KSEF_AUTH_TOKEN ?? process.env.KSEF_TOKEN ?? '';
    testNip = process.env.KSEF_NIP ?? '1234567802';

    if (!testToken) {
      throw new Error(
        'KSEF_LIVE=1 requires KSEF_AUTH_TOKEN (and optionally KSEF_NIP) in the environment.',
      );
    }
  });

  it('Run A: crypto guard — encrypts and transmits without 435 (decryption error)', async () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY ??= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    const companyId = 'live_crypto_' + Date.now();
    const { KsefTransmissionProvider } = await import('../providers.js');
    const { TransmissionProviderRegistry } = await import('../registry.js');
    const { RecordingComplianceLogger } = await import('../../../execution/logger.js');

    const fakeResolvedConfig = {
      providerId: 'ksef',
      channel: 'GOV_PORTAL_API',
      environment: 'test',
      config: { nip: testNip, authToken: testToken },
      isActive: true,
    };

    // Stub credentials port so poll() can re-resolve + re-authenticate (mirrors production,
    // where the registry injects the real ChannelCredentialsPort into the provider).
    const stubCredentials = { resolve: async () => fakeResolvedConfig, resolveActive: async () => fakeResolvedConfig };
    const reg = new TransmissionProviderRegistry([new KsefTransmissionProvider(stubCredentials as any) as any]);
    const ksef = reg.getById('ksef')!;

    const faVatArtifact = {
      role: 'AUTHORITATIVE' as const,
      syntax: 'FA_VAT' as const,
      mime: 'application/xml',
      bytes: Buffer.from(CRYPTO_GUARD_XML, 'utf8'),
    };

    const log = new RecordingComplianceLogger();
    const ctx = {
      supplier: { legalName: 'Test', countryCode: 'PL', role: 'B2B', identifiers: [{ scheme: 'VAT', value: 'PL' + testNip, validated: true }] },
      buyer: { legalName: 'Buyer', countryCode: 'PL', role: 'B2B', identifiers: [{ scheme: 'VAT', value: 'PL1234567803', validated: true }] },
      lines: [], issueDate: new Date('2026-06-28'), currency: 'PLN', supplierCompanyId: companyId,
    } as any;

    const transmitResult = await ksef.transmit!(
      [faVatArtifact], ctx,
      { channels: [{ type: 'GOV_PORTAL_API', providerId: 'ksef' }] } as any,
      'crypto-guard', log, fakeResolvedConfig as any,
    );

    console.log('Run A transmit:', JSON.stringify(transmitResult, null, 2));

    // Crypto guard: must not fail with decryption error (435)
    // Accept PENDING (success) or REJECTED (semantic — expected for placeholder XML)
    expect(['PENDING', 'REJECTED']).toContain(transmitResult.status);
    const allNotes = (transmitResult.notes ?? []).join(' ');
    expect(allNotes).not.toMatch(/435|decrypt/i);
  });

  it('Run B: valid FA(2) via buildFaVat → CLEARED + ksefNumber', async () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY ??= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    const timestamp = Date.now();
    const companyId = 'live_valid_' + timestamp;
    const invoiceNumber = `INV-${timestamp}`;

    // ── Generate FA(2) via buildFaVat (DB-free) ──
    const { InvoiceRenderingService } = await import('../../../../modules/invoice-rendering/invoice-rendering.service.js');
    const { validateXsd } = await import('../../../schemas/validate.js');

    const service = new InvoiceRenderingService();
    const now = new Date();
    const fa2Xml = await service.buildFaVat({
      rawNumber: invoiceNumber,
      number: null,
      issuedAt: now,
      createdAt: now,
      company: {
        name: 'Test Live Seller',
        description: null,
        foundedAt: null,
        currency: 'PLN',
        address: 'ul. Testowa 1',
        city: 'Warszawa',
        postalCode: '00-001',
        country: 'Poland',
        partyIdentifiers: [{ scheme: 'VAT', value: 'PL' + testNip }],
      },
      client: {
        type: 'COMPANY',
        name: 'Test Live Buyer',
        description: null,
        foundedAt: null,
        contactFirstname: null,
        contactLastname: null,
        salutation: null,
        sex: null,
        title: null,
        isActive: true,
        address: 'ul. Kupiecka 2',
        city: 'Kraków',
        postalCode: '31-010',
        country: 'Poland',
        partyIdentifiers: [{ scheme: 'VAT', value: 'PL1234567803' }],
      },
      items: [
        { name: 'Usługa testowa (Test service)', quantity: 1, unitPrice: 100, vatRate: 23, type: 'SERVICE' },
      ],
    } as any);

    console.log('FA(2) XML length:', fa2Xml.length);
    expect(fa2Xml).toContain('Faktura');
    expect(fa2Xml).toContain(invoiceNumber);
    expect(fa2Xml).toContain(testNip);

    // ── XSD validation (fail fast before consuming KSeF) ──
    const xsdResult = await validateXsd(fa2Xml, 'pl/schemat_FA2.xsd');
    console.log('XSD validation:', xsdResult.valid ? 'PASS' : 'FAIL', xsdResult.errors);
    expect(xsdResult.valid).toBe(true);

    // ── Transmit to KSeF ──
    const { KsefTransmissionProvider } = await import('../providers.js');
    const { TransmissionProviderRegistry } = await import('../registry.js');
    const { RecordingComplianceLogger } = await import('../../../execution/logger.js');

    const fakeResolvedConfig = {
      providerId: 'ksef',
      channel: 'GOV_PORTAL_API',
      environment: 'test',
      config: { nip: testNip, authToken: testToken },
      isActive: true,
    };

    // Stub credentials port so poll() can re-resolve + re-authenticate (mirrors production,
    // where the registry injects the real ChannelCredentialsPort into the provider).
    const stubCredentials = { resolve: async () => fakeResolvedConfig, resolveActive: async () => fakeResolvedConfig };
    const reg = new TransmissionProviderRegistry([new KsefTransmissionProvider(stubCredentials as any) as any]);
    const ksef = reg.getById('ksef')!;

    const faVatArtifact = {
      role: 'AUTHORITATIVE' as const,
      syntax: 'FA_VAT' as const,
      mime: 'application/xml',
      bytes: Buffer.from(fa2Xml, 'utf8'),
    };

    const log = new RecordingComplianceLogger();
    const ctx = {
      supplier: { legalName: 'Test Live Seller', countryCode: 'PL', role: 'B2B', identifiers: [{ scheme: 'VAT', value: 'PL' + testNip, validated: true }] },
      buyer: { legalName: 'Test Live Buyer', countryCode: 'PL', role: 'B2B', identifiers: [{ scheme: 'VAT', value: 'PL1234567803', validated: true }] },
      lines: [], issueDate: now, currency: 'PLN', supplierCompanyId: companyId,
    } as any;

    const transmitResult = await ksef.transmit!(
      [faVatArtifact], ctx,
      { channels: [{ type: 'GOV_PORTAL_API', providerId: 'ksef' }] } as any,
      'valid-fa', log, fakeResolvedConfig as any,
    );

    console.log('Run B transmit:', JSON.stringify(transmitResult, null, 2));
    expect(transmitResult.status).toBe('PENDING');
    expect(transmitResult.ref).toBeTruthy();

    const parts = transmitResult.ref!.split('|');
    expect(parts.length).toBe(3);
    const [, sessionRef, invoiceRef] = parts;
    expect(sessionRef).toBeTruthy();
    expect(invoiceRef).toBeTruthy();
    console.log('Session:', sessionRef, 'Invoice:', invoiceRef);

    // ── Poll for CLEARED ──
    const MAX_POLLS = 15;
    const POLL_INTERVAL_MS = 3000;
    let pollResult: any;

    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      pollResult = await ksef.poll!(transmitResult.ref!, log);
      console.log(`Poll ${i + 1}/${MAX_POLLS}:`, pollResult.status, (pollResult.notes ?? []).join(' | '));

      if (pollResult.status === 'CLEARED') break;
      if (pollResult.status === 'REJECTED') break;
    }

    expect(pollResult).toBeDefined();
    console.log('Final poll result:', JSON.stringify(pollResult, null, 2));

    // The ultimate proof: CLEARED with a real ksefNumber from ksef-test.mf.gov.pl
    expect(pollResult.status).toBe('CLEARED');
    const ksefNumberNote = (pollResult.notes ?? []).find((n: string) => n.startsWith('ksefNumber:'));
    expect(ksefNumberNote).toBeTruthy();
    const ksefNumber = ksefNumberNote!.replace('ksefNumber: ', '');
    console.log('ksefNumber:', ksefNumber);
    // Real KSeF number format: {NIP}-{YYYYMMDD}-{hex}-{checksum}, e.g. 1234567802-20260628-8D1951000000-C8
    expect(ksefNumber).toMatch(/^\d{10}-\d{8}-[0-9A-F]+-[0-9A-F]{2}$/);
  }, 120_000);
});
