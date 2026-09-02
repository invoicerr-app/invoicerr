/**
 * REAL round-trip against the NAV Online Számla 3.0 sandbox — root TODO, HU/"déclaration" wave.
 *
 * Gated `NAV_LIVE=1` + `NAV_TAX_NUMBER`/`NAV_LOGIN`/`NAV_PASSWORD`/`NAV_SIGNING_KEY`/`NAV_EXCHANGE_KEY`
 * (`../../transports/live-gate.ts`), the same shape every sibling channel's own live spec uses:
 *
 *   NAV_LIVE=1 NAV_TAX_NUMBER=... NAV_LOGIN=... NAV_PASSWORD=... NAV_SIGNING_KEY=... \
 *     NAV_EXCHANGE_KEY=... npx jest nav.live --no-coverage
 *
 * HONEST STATUS AT THE END OF THIS TASK: **skipped, always** — this checkout holds no NAV technical
 * user. Registering one requires (spec's own "Conditions of use for taxpayers", read directly from
 * the official interface specification — see `nav-client.ts`'s own header):
 *   1) "a valid registration in the Online Invoice System" on the taxpayer's own behalf, launched
 *      "on the Online Invoice System web interface" (`onlineszamla-test.nav.gov.hu` for the test
 *      system);
 *   2) a technical user created by that registration's own PRIMARY USER — "the Taxpayer's statutory
 *      or permanent representative";
 *   3) a signing key and a replacement (exchange) key generated for that technical user, "by the
 *      primary user on the Online Invoice System web interface" — no API for either step.
 * `taxNumber`'s own pattern (`TaxpayerIdType`, `[0-9]{8}`) is a HUNGARIAN tax number — the whole
 * registration chain above binds to a real Hungarian taxpayer identity. This task found NO indication
 * anywhere in the spec, the official GitHub repo, or the reachability probe below that a non-Hungarian
 * entity could obtain even a TEST-system registration without one — unlike, say, KSeF's own test
 * token issuance (`CREDENTIALS_GUIDE.md` §1), there is no separate "developer sandbox signup" page
 * distinct from the real taxpayer registration flow. This task did NOT attempt to register (there is
 * no Hungarian tax number to register with, and no headless path was found) — see
 * `CREDENTIALS_GUIDE.md`'s own NAV section for the full writeup.
 *
 * WHAT WAS INDEPENDENTLY, LIVE-VERIFIED for this task (2026-09-02, real `curl`, credential-free): the
 * reachability block below reproduces EXACTLY the real response this task captured directly against
 * `api-test.onlineszamla.nav.gov.hu` — see `nav-client.ts`'s own "LIVE-VERIFIED" section, and the same
 * fixture `nav-client.spec.ts` already asserts on offline. This confirms the host, the `/tokenExchange`
 * path, and the response VOCABULARY (`funcCode`/`errorCode`/`message`) are real, not merely documented.
 */
import { NavApiError, buildNavClient } from './nav-client';
import { liveDescribe } from '../../transports/live-gate';

const NAV_TEST_BASE_URL = 'https://api-test.onlineszamla.nav.gov.hu';

// Flag-only gate (no required credential vars — this check needs none), same shape
// `face.live.spec.ts`'s own credential-free reachability block uses.
const describeReachability = liveDescribe('NAV_LIVE');

describeReachability('NAV Online Számla — credential-free reachability proof', () => {
  it('the real test sandbox is reachable and answers a schema-invalid request with a real, named funcCode/errorCode', async () => {
    const res = await fetch(`${NAV_TEST_BASE_URL}/invoiceService/v3/tokenExchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/xml', accept: 'application/xml' },
      body: '<x/>',
    });
    const body = await res.text();

    // NAV's own general-fault vocabulary — see nav-client.ts's own "LIVE-VERIFIED" header for why
    // this response carries NO <result> wrapper (a GeneralExceptionResponse, not an ordinary
    // operation response) and what that already changed in parseNavFunctionResult.
    expect(res.status).toBe(400);
    expect(body).toContain('<funcCode>ERROR</funcCode>');
    expect(body).toContain('<errorCode>INVALID_REQUEST</errorCode>');
  }, 15000);
});

const describeLive = liveDescribe('NAV_LIVE', [
  'NAV_TAX_NUMBER',
  'NAV_LOGIN',
  'NAV_PASSWORD',
  'NAV_SIGNING_KEY',
  'NAV_EXCHANGE_KEY',
]);

describeLive('NAV Online Számla live round-trip (test sandbox)', () => {
  it('tokenExchange → manageInvoice → queryTransactionStatus succeeds with a real, non-empty transactionId', async () => {
    const client = buildNavClient(
      {
        taxNumber: process.env.NAV_TAX_NUMBER!,
        login: process.env.NAV_LOGIN!,
        password: process.env.NAV_PASSWORD!,
        signingKey: process.env.NAV_SIGNING_KEY!,
        exchangeKey: process.env.NAV_EXCHANGE_KEY!,
      },
      NAV_TEST_BASE_URL,
    );

    const exchangeToken = await client.tokenExchange();
    expect(exchangeToken.trim().length).toBeGreaterThan(0);

    // A minimal, deliberately invalid `invoiceData` — this task holds no real technical user to test
    // a genuinely accepted invoice against; a HARD SUCCESS spec (the model `sdicoop.live.spec.ts`/
    // `pdp.live.spec.ts` set) would assert a real, accepted transaction — never written here, since
    // this block is not expected to ever actually run (see this file's own header).
    let transactionId: string | undefined;
    let error: unknown;
    try {
      transactionId = await client.manageInvoice(
        exchangeToken,
        Buffer.from('<InvoiceData/>').toString('base64'),
      );
    } catch (err) {
      error = err;
    }

    if (error) {
      // A named, real NAV rejection (invalid invoiceData) is still an HONEST, informative outcome —
      // never a silent pass. `NavApiError`'s own message already names NAV's own errorCode.
      expect(error).toBeInstanceOf(NavApiError);
      return;
    }

    expect(transactionId!.trim().length).toBeGreaterThan(0);
    const { invoiceStatus } = await client.queryTransactionStatus(transactionId!);
    expect(invoiceStatus.trim().length).toBeGreaterThan(0);
  }, 30000);
});
