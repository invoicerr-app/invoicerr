/**
 * REAL round-trip against a PayPal SANDBOX app. Gated the same way every other live spec is
 * (`PAYPAL_LIVE=1` + `PAYPAL_CLIENT_ID`/`PAYPAL_CLIENT_SECRET` — `live-gate.ts`, reused verbatim):
 *
 *   PAYPAL_LIVE=1 PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... \
 *     [PAYPAL_ENVIRONMENT=sandbox] npx jest paypal.live --no-coverage --runInBand
 *
 * WHAT A GREEN RUN OF THIS SPEC PROVES: that `RealPayPalClient` (the ONE network-calling class in this
 * provider — see its own header) can authenticate via OAuth2 client_credentials with a genuine sandbox
 * app, that PayPal accepts the exact Orders v2 request shape this codebase builds, and hands back a real
 * order id plus an `approve` link a real browser could actually open.
 *
 * WHAT IT DOES NOT PROVE — no jest spec, gated or not, can prove offline: that a human (or PayPal's own
 * sandbox buyer account) actually approves the order, that PayPal's servers then deliver a
 * `CHECKOUT.ORDER.APPROVED` webhook to this application's public URL, that THIS webhook id is the one
 * `verify-webhook-signature` accepts, that the capture this provider triggers from it actually succeeds,
 * or that the resulting `PAYMENT.CAPTURE.COMPLETED` webhook is delivered and verified in turn. The day a
 * publicly reachable instance + a sandbox buyer account exist, that full chain is proven by: approving
 * the `checkoutUrl` this spec prints in a browser logged into a PayPal sandbox personal account, then
 * confirming `GET /api/payments/:documentId/sessions` shows `status: "COMPLETED"`.
 *
 * Say so here, not just in this feature's own report: a green MOCKED suite (`paypal-client.spec.ts`,
 * `paypal-provider.spec.ts`) proves the WIRING — OAuth caching, request shape, the capture-on-approval
 * trigger, the verification refusal path — never that a real order was ever approved or captured.
 */
import { liveDescribe } from '../../../transports/live-gate';
import { PayPalCredentials, RealPayPalClient } from './paypal-client';

const describeLive = liveDescribe('PAYPAL_LIVE', ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET']);

describeLive('PayPal live round-trip (sandbox app) — token acquired, order created', () => {
  it('gets an OAuth token and creates a real sandbox order with a usable approve link', async () => {
    const credentials: PayPalCredentials = {
      clientId: process.env.PAYPAL_CLIENT_ID ?? '',
      clientSecret: process.env.PAYPAL_CLIENT_SECRET ?? '',
      webhookId: process.env.PAYPAL_WEBHOOK_ID ?? '',
      environment: process.env.PAYPAL_ENVIRONMENT === 'live' ? 'live' : 'sandbox',
    };
    const client = new RealPayPalClient();

    const created = await client.createOrder(credentials, {
      amountMinor: 100,
      currency: 'EUR',
      description: 'invoicerr live spec — safe to ignore/void',
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      metadata: { companyId: 'live-spec', documentId: 'live-spec' },
    });

    // HARD-SUCCESS CONTRACT (documentation/docs/developer-guide/live-testing.md): never tolerate an
    // empty/missing id or an approve link that isn't PayPal's own domain.
    if (
      !created.providerSessionId ||
      !/^https:\/\/www\.(sandbox\.)?paypal\.com\//.test(created.checkoutUrl)
    ) {
      throw new Error(`PayPal did not return a usable order — hard failure. Raw: ${JSON.stringify(created)}`);
    }

    console.log(
      'PayPal sandbox order created — approve manually with a sandbox buyer account to inspect (never auto-approved):',
      created.checkoutUrl,
    );
  }, 15_000);
});
