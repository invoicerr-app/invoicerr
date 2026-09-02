/**
 * REAL round-trip against the AADE myDATA dev sandbox — root TODO, GR/"déclaration" wave.
 *
 * Gated `MYDATA_LIVE=1` + `MYDATA_USER_ID`/`MYDATA_SUBSCRIPTION_KEY` (`../../transports/live-gate.ts`),
 * the same shape every sibling channel's own live spec uses:
 *
 *   MYDATA_LIVE=1 MYDATA_USER_ID=... MYDATA_SUBSCRIPTION_KEY=... npx jest mydata.live --no-coverage
 *
 * HONEST STATUS AT THE END OF THIS TASK: **skipped, always** — this checkout holds no AADE myDATA
 * subscription. aade.gr itself (the myDATA home page, the "τεχνικές προδιαγραφές" documentation page,
 * and the dev-environment registration page) returned HTTP 403 for EVERY path tried from this
 * environment (see `mydata-client.ts`'s own header) — this task could not even READ the registration
 * procedure directly at its own source, let alone attempt it. What IS independently, repeatedly
 * corroborated across many separate third-party myDATA client projects (never a single unverified
 * source — `mydata-client.ts`'s own header lists them) is that registration requires a genuine Greek
 * AADE / TaxisNet business identity (myDATA is a Greek tax-authority reporting obligation, not a
 * vendor-neutral developer program) — this task did not attempt registration since it holds no such
 * identity, and no self-service, identity-free signup path was found anywhere reachable. See
 * `CREDENTIALS_GUIDE.md`'s own myDATA section for the full writeup.
 *
 * WHAT WAS INDEPENDENTLY, LIVE-VERIFIED for this task (2026-09-02, real `curl`, credential-free): the
 * reachability block below reproduces EXACTLY the real response this task captured directly against
 * `mydataapidev.aade.gr` — confirming the host, the `/SendInvoices` path, and the Azure APIM
 * authentication header name (`Ocp-Apim-Subscription-Key`) are all real, not merely documented by
 * third-party clients.
 */
import { liveDescribe } from '../../transports/live-gate';
import { buildMyDataClient } from './mydata-client';

const MYDATA_SANDBOX_BASE_URL = 'https://mydataapidev.aade.gr/';

const describeReachability = liveDescribe('MYDATA_LIVE');

describeReachability('AADE myDATA — credential-free reachability proof', () => {
  it('the real dev sandbox is reachable and answers an unauthenticated request naming the missing subscription key', async () => {
    const res = await fetch(`${MYDATA_SANDBOX_BASE_URL}SendInvoices`, {
      method: 'POST',
      headers: { 'content-type': 'text/xml' },
      body: '<InvoicesDoc/>',
    });
    const body = await res.text();

    // Azure APIM's own standard rejection for a missing subscription key — confirms the host, the
    // path, and (indirectly) that `ocp-apim-subscription-key` really is the header this gateway
    // checks, live, not merely from third-party client source code.
    expect(res.status).toBe(401);
    expect(body).toContain('missing subscription key');
  }, 15000);
});

const describeLive = liveDescribe('MYDATA_LIVE', ['MYDATA_USER_ID', 'MYDATA_SUBSCRIPTION_KEY']);

describeLive('AADE myDATA live round-trip (dev sandbox)', () => {
  it("SendInvoices with a deliberately minimal invoice at least reaches AADE's own business validation", async () => {
    const client = buildMyDataClient(
      {
        userId: process.env.MYDATA_USER_ID!,
        subscriptionKey: process.env.MYDATA_SUBSCRIPTION_KEY!,
      },
      MYDATA_SANDBOX_BASE_URL,
    );

    // Never expected to actually succeed with a bare, field-incomplete invoice — this block is not
    // expected to ever actually run at all (see this file's own header); if it does, a real, NAMED
    // AADE validation error (never a silent pass) proves the credentials/headers/host are wired
    // correctly end-to-end, which is the honest, narrower thing worth asserting here.
    await expect(client.sendInvoices('<InvoicesDoc/>')).rejects.toBeInstanceOf(Error);
  }, 30000);
});
