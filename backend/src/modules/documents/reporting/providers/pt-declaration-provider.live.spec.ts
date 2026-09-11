/**
 * REAL round-trip against the AT (Autoridade Tributária e Aduaneira) "comunicação de faturas" test
 * webservice — root TODO, PT/"déclaration" wave (rank 10, TODO_FEATURES.md).
 *
 * Gated `PT_AT_LIVE=1` + `PT_AT_USERNAME`/`PT_AT_PASSWORD`/`PT_AT_PUBLIC_KEY_PEM`/
 * `PT_AT_CLIENT_CERTIFICATE_BASE64`/`PT_AT_CLIENT_CERTIFICATE_PASSWORD` (`../../transports/live-gate.ts`,
 * the same shape every sibling channel's own live spec uses — see e.g. `nav.live.spec.ts`):
 *
 *   PT_AT_LIVE=1 PT_AT_USERNAME=... PT_AT_PASSWORD=... PT_AT_PUBLIC_KEY_PEM=... \
 *     PT_AT_CLIENT_CERTIFICATE_BASE64=... PT_AT_CLIENT_CERTIFICATE_PASSWORD=... \
 *     npx jest pt-declaration-provider.live --no-coverage
 *
 * HONEST STATUS AT THE END OF THIS TASK: **skipped, always** — this checkout holds no real AT
 * "subutilizador" credential, no real AT Sistema de Autenticação public key, and no AT-signed mTLS
 * client certificate. Obtaining all three requires (per the two official manuals this task actually
 * read — see `pt-at-client.ts`'s own header):
 *   1) a subutilizador created in the Portal das Finanças, under a REAL Portuguese NIF, with the
 *      "WFA – Webservice de Comunicação de dados de faturas" profile (Aspetos Genéricos §2.2/§2.1.4);
 *   2) the AT Sistema de Autenticação's own public key AND a test-environment SSL certificate,
 *      obtained by emailing `asi-cd@at.gov.pt` directly with the NIF/name of a real software producer
 *      (§2.1.1) — no self-service developer sandbox exists, the same "no headless path found" gap
 *      `nav.live.spec.ts`'s own header already documents for NAV's own registration;
 *   3) that same AT-signed certificate integrated into a PKCS#12 (§2.3.1-2.3.3).
 * This task found no indication that a non-Portuguese entity, or one without a genuine NIF-holding
 * taxpayer relationship with AT, could obtain even a TEST-environment credential set without going
 * through this exact chain. No attempt was made to register (there is no Portuguese NIF to register
 * with here, and — per this file's own header — this client's mTLS wiring itself is not even
 * finished yet, see `pt-at-client.ts`'s own "EXTRAPOLATED / not wired" section).
 *
 * A REACHABILITY-ONLY, credential-free probe (the pattern `nav.live.spec.ts`'s own header
 * establishes) is DELIBERATELY NOT included here: unlike NAV's `tokenExchange` (a GET-adjacent,
 * effectively stateless endpoint that answers even a garbage POST with a real, informative error),
 * AT's `fatcorews` endpoint requires a valid mTLS client certificate to complete the TLS HANDSHAKE
 * itself (see `pt-at-client.ts`'s own header) — an unauthenticated probe from this environment would
 * only prove "TLS negotiation fails without a client certificate", which the manual already states in
 * plain language and which running network diagnostics against a real government endpoint for zero
 * additional information would not be a proportionate thing to do.
 */
import { buildPtAtClient, PtAtCredentials, resolvePtAtBaseUrl } from './pt-at-client';
import { liveDescribe } from '../../transports/live-gate';

const describeLive = liveDescribe('PT_AT_LIVE', [
  'PT_AT_USERNAME',
  'PT_AT_PASSWORD',
  'PT_AT_PUBLIC_KEY_PEM',
  'PT_AT_CLIENT_CERTIFICATE_BASE64',
  'PT_AT_CLIENT_CERTIFICATE_PASSWORD',
]);

describeLive('AT comunicação de faturas — live round-trip (test environment)', () => {
  it('RegisterInvoiceRequest against the real AT test endpoint returns a real, parseable CodigoResposta', async () => {
    const credentials: PtAtCredentials = {
      username: process.env.PT_AT_USERNAME!,
      password: process.env.PT_AT_PASSWORD!,
      authPublicKeyPem: process.env.PT_AT_PUBLIC_KEY_PEM!,
      clientCertificateBase64: process.env.PT_AT_CLIENT_CERTIFICATE_BASE64!,
      clientCertificatePassword: process.env.PT_AT_CLIENT_CERTIFICATE_PASSWORD!,
    };
    const baseUrl = resolvePtAtBaseUrl('TEST');
    const client = buildPtAtClient(credentials, baseUrl);

    // A minimal, deliberately fixture-shaped request — this task holds no real subutilizador to test
    // a genuinely accepted invoice against; a HARD SUCCESS spec (the model `sdicoop.live.spec.ts`/
    // `pdp.live.spec.ts` set) would assert a real, accepted CodigoResposta 0 — never written here,
    // since this block is not expected to ever actually run (see this file's own header), and — per
    // `pt-at-client.ts`'s own header — this client's mTLS is not wired, so this call would fail the
    // TLS handshake before ever reaching AT's own WS-Security/business validation regardless.
    const result = await client.registerInvoice({
      'doc:eFaturaMDVersion': '0.0.1',
      'doc:AuditFileVersion': '1.04_01',
      'doc:TaxRegistrationNumber': '222222222',
      'doc:TaxEntity': 'Global',
      'doc:SoftwareCertificateNumber': '0',
      'doc:InvoiceData': {
        'doc:InvoiceNo': 'FT 1/1',
        'doc:ATCUD': '0',
        'doc:InvoiceDate': '2026-09-11',
        'doc:InvoiceType': 'FT',
        'doc:SelfBillingIndicator': '0',
        'doc:CustomerTaxID': '111111111',
        'doc:CustomerTaxIDCountry': 'PT',
        'doc:DocumentStatus': {
          'doc:InvoiceStatus': 'N',
          'doc:InvoiceStatusDate': '2026-09-11T11:12:13',
        },
        'doc:HashCharacters': '0',
        'doc:CashVATSchemeIndicator': '0',
        'doc:PaperLessIndicator': '1',
        'doc:SystemEntryDate': '2026-09-11T11:12:13',
        'doc:LineSummary': [
          {
            'doc:TaxPointDate': '2026-09-11',
            'doc:DebitCreditIndicator': 'C',
            'doc:Amount': '100.00',
            'doc:Tax': {
              'doc:TaxType': 'IVA',
              'doc:TaxCountryRegion': 'PT',
              'doc:TaxCode': 'NOR',
              'doc:TaxPercentage': '23.00',
            },
          },
        ],
        'doc:DocumentTotals': {
          'doc:TaxPayable': '23.00',
          'doc:NetTotal': '100.00',
          'doc:GrossTotal': '123.00',
        },
      },
    });

    // Hard-success contract (`live-gate.ts`'s own header): a rejected/erroring result must fail the
    // test, never be treated as an acceptable outcome to silently swallow.
    expect(result.codigoResposta).toBe(0);
    expect(result.dataOperacao?.trim().length ?? 0).toBeGreaterThan(0);
  }, 30000);
});
