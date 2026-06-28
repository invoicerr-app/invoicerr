/**
 * KSeF live round-trip test — REAL API, REAL token, never in CI.
 *
 * Guard: KSEF_LIVE=1 npx jest ksef-live.spec.ts --no-coverage
 *
 * Flow:
 * 1. Read test token from scratchpad/ksef-test-creds.local.env
 * 2. Build a resolved config as if resolveActive() returned it
 * 3. Execute transmit() via the provider (uses vendorized MF keys)
 * 4. Execute poll() to get KSeF status
 * 5. Assert real reference numbers and status
 *
 * Never logs token, XML, or accessToken.
 */
const LIVE = !!process.env.KSEF_LIVE;

// Minimal FA(2) XML — just enough structure for KSeF to accept (or reject semantically)
const MINIMAL_FA_VAT =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<Faktura xmlns="http://crd.gov.pl/wzor/2023/06/29/12648/">' +
  '<Naglowek><KodFormularza systemCode="FA" wersjaSchemy="1-0E">FA</KodFormularza>' +
  '<WariantFormularza>2</WariantFormularza>' +
  '<DataWygenerowania>2026-06-28</DataWygenerowania>' +
  '<SystemInfo>invoicerr-live-test</SystemInfo></Naglowek>' +
  '<Podmiot1><AdresPodmiotu><KodKraju>PL</KodKraju><NrNIP>0000000000</NrNIP>' +
  '<Nazwa>Test Live</Nazwa></AdresPodmiotu><NRAKtywnosciVAT>123456</NRAKtywnosciVAT>' +
  '<StatusCzynnyVAT>true</StatusCzynnyVAT></Podmiot1>' +
  '<Podmiot2><AdresPodmiotu><KodKraju>PL</KodKraju><NrNIP>0000000000</NrNIP>' +
  '<Nazwa>Test Buyer</Nazwa></AdresPodmiotu></Podmiot2>' +
  '<Fa><KodWaluty>PLN</KodWaluty><DataWystawienia>2026-06-28</DataWystawienia>' +
  '<DataZakupu>2026-06-28</DataZakupu><TerminPlatnosci>2026-07-28</TerminPlatnosci>' +
  '<FormaPlatnosci>przelew</FormaPlatnosci><PlatnoscZaliczkowaCzesciowa>false</PlatnoscZaliczkowaCzesciowa>' +
  '<PlatnoscCalkowita>false</PlatnoscCalkowita><KwotaRazem>123.00</KwotaRazem>' +
  '<FaWiersz><NrWierszaFa>1</NrWierszaFa><NazwaTowaruUslugi>Test item</NazwaTowaruUslugi>' +
  '<PKWiU>PKWiU 62.01</PKWiU><JednostkaMiary>szt.</JednostkaMiary>' +
  '<IloscJednostkowa>1</IloscJednostkowa><CenaJednostkowaBrutto>100.00</CenaJednostkowaBrutto>' +
  '<WartoscBrutto>100.00</WartoscBrutto></FaWiersz></Fa></Faktura>';

// eslint-disable-next-line no-restricted-properties
const describeLive = LIVE ? describe : describe.skip;

describeLive('KSeF live round-trip', () => {
  let testToken: string;
  let testNip: string;

  beforeAll(() => {
    // Credentials come from the environment (local export or GitHub CI secrets) — never the repo.
    testToken = process.env.KSEF_AUTH_TOKEN ?? process.env.KSEF_TOKEN ?? '';
    testNip = process.env.KSEF_NIP ?? '1234567890';

    if (!testToken) {
      throw new Error(
        'KSEF_LIVE=1 requires KSEF_AUTH_TOKEN (and optionally KSEF_NIP) in the environment. ' +
        'Locally: export them in your shell. In CI: set them as repository secrets and inject as env.',
      );
    }
  });

  it('transmits a real invoice to ksef-test.mf.gov.pl and polls its status', async () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY ??= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    const companyId = 'live_test_' + Date.now();

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
    const stubCredentials = {
      resolve: async () => fakeResolvedConfig,
      resolveActive: async () => fakeResolvedConfig,
    };
    const reg = new TransmissionProviderRegistry([new KsefTransmissionProvider(stubCredentials as any) as any]);
    const ksef = reg.getById('ksef')!;

    const faVatArtifact = {
      role: 'AUTHORITATIVE' as const,
      syntax: 'FA_VAT' as const,
      mime: 'application/xml',
      bytes: Buffer.from(MINIMAL_FA_VAT, 'utf8'),
    };

    const log = new RecordingComplianceLogger();

    const ctx = {
      supplier: {
        legalName: 'Live Test',
        countryCode: 'PL',
        role: 'B2B',
        identifiers: [{ scheme: 'VAT', value: 'PL' + testNip, validated: true }],
      },
      buyer: {
        legalName: 'Buyer',
        countryCode: 'PL',
        role: 'B2B',
        identifiers: [{ scheme: 'VAT', value: 'PL0000000000', validated: true }],
      },
      lines: [],
      issueDate: new Date('2026-06-28'),
      currency: 'PLN',
      supplierCompanyId: companyId,
    } as any;

    const transmitResult = await ksef.transmit!(
      [faVatArtifact],
      ctx,
      { channels: [{ type: 'GOV_PORTAL_API', providerId: 'ksef' }] } as any,
      'live-test-key',
      log,
      fakeResolvedConfig as any,
    );

    console.log('Transmit result:', JSON.stringify(transmitResult, null, 2));

    // Real proof: the invoice MUST have reached KSeF and come back with a session+invoice
    // reference. A local error (missing keys, network, auth) surfaces as a non-PENDING status
    // with notes — that is a FAILURE here, not a tolerated outcome (no false green).
    expect(transmitResult.status).toBe('PENDING');
    expect(transmitResult.ref).toBeTruthy();

    const parts = transmitResult.ref!.split('|');
    expect(parts.length).toBe(3);
    const [, sessionRef, invoiceRef] = parts;
    expect(sessionRef).toMatch(/^\d{8}-[A-Z]{2}-/);
    expect(invoiceRef).toBeTruthy();

    console.log('Session:', sessionRef, 'Invoice:', invoiceRef);

    // KSeF processes asynchronously — poll (each call re-authenticates) until terminal or timeout.
    await new Promise((r) => setTimeout(r, 4000));
    let pollResult = await ksef.poll!(transmitResult.ref!, log);
    for (let i = 0; i < 8 && pollResult.status === 'PENDING'; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      pollResult = await ksef.poll!(transmitResult.ref!, log);
    }
    console.log('Poll result:', JSON.stringify(pollResult, null, 2));

    // poll() must have actually reached KSeF and re-authenticated — never a local error.
    const noteStr = (pollResult.notes ?? []).join(' ');
    expect(noteStr).not.toMatch(/error|ENOENT|no credentials/i);
    // Crypto-pipeline regression guard: KSeF must be able to DECRYPT the invoice. A code-435
    // "Błąd odszyfrowania pliku" (decryption error) means the AES/session-key handling broke.
    // A semantic rejection (code 450) of the placeholder invoice is fine — it proves KSeF
    // decrypted + parsed the document.
    expect(noteStr).not.toMatch(/odszyfrowania|decryption|code 435/i);
    expect(['PENDING', 'CLEARED', 'REJECTED']).toContain(pollResult.status);
    if (pollResult.status === 'CLEARED') {
      expect(noteStr).toMatch(/ksefNumber/i);
    }
  }, 90_000);
});
