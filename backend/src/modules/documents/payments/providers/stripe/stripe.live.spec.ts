/**
 * REAL round-trip against a Stripe TEST-mode account. Gated the same way every other national channel's
 * own live spec is (`STRIPE_LIVE=1` + credential env vars — `live-gate.ts`, reused verbatim):
 *
 *   STRIPE_LIVE=1 STRIPE_SECRET_KEY=sk_test_... npx jest stripe.live --no-coverage --runInBand
 *
 * WHAT A GREEN RUN OF THIS SPEC PROVES: that `RealStripeCheckoutClient` (the ONE network-calling class
 * in this whole feature — see its own header) can authenticate with a genuine Stripe secret key and
 * that Stripe accepts the exact request shape this codebase builds, handing back a real `cs_test_...`
 * session id and a `https://checkout.stripe.com/...` URL a real browser could actually open.
 *
 * WHAT IT DOES NOT PROVE — and no jest spec, gated or not, can prove offline: that a human completing
 * that checkout page with a real (or Stripe's own test) card actually reaches this application as a
 * webhook, that THIS webhook secret is the one Stripe signs with, or that `record-payment` then runs.
 * `stripe-signature.ts`'s own header already explains why the CRYPTOGRAPHIC half of that (a genuine
 * HMAC-SHA256 over a real payload) is exercised for real by `stripe-signature.spec.ts` and by
 * `60-online-payment.cy.ts`'s own simulated webhook call — what remains unprovable without a live
 * account is the DELIVERY: that Stripe's own servers actually send the request, to the actual
 * `/api/public/payments/stripe/:companyId/webhook` URL, with a signature this company's own dashboard
 * secret produces. The day an account exists, that is proven by ONE of:
 *
 *   - completing a real (or Stripe test-mode) checkout in a browser against a company that has this
 *     app's own public URL registered as a webhook endpoint in the Stripe dashboard, then confirming
 *     `GET /api/payments/:documentId/sessions` shows `status: "COMPLETED"` and the invoice's own
 *     `GET /api/documents/:id/settlement` shows the balance moved; or
 *   - the Stripe CLI's own local-forwarding tool: `stripe listen --forward-to
 *     localhost:4000/api/public/payments/stripe/<companyId>/webhook` then `stripe trigger
 *     checkout.session.completed` — Stripe's own tool signs the event with the CLI's own ephemeral
 *     secret, which would need to be entered as this company's `webhookSecret` for the run.
 *
 * Say so here, not just in this feature's own report: a green MOCKED suite (`payment-sessions.
 * service.spec.ts`, `60-online-payment.cy.ts`) proves the WIRING — that a session is created, correlated,
 * and turned into a real `DocumentPayment` exactly once — never that a real card was ever charged.
 */
import { liveDescribe } from '../../../transports/live-gate';
import { RealStripeCheckoutClient } from './stripe-checkout-client';

const describeLive = liveDescribe('STRIPE_LIVE', ['STRIPE_SECRET_KEY']);

describeLive('Stripe live round-trip (test-mode account) — checkout session created', () => {
  it('creates a real Checkout Session and gets back a usable id + hosted URL', async () => {
    const secretKey = process.env.STRIPE_SECRET_KEY ?? '';
    const client = new RealStripeCheckoutClient();

    const result = await client.createSession(secretKey, {
      amountMinor: 100,
      currency: 'eur',
      description: 'invoicerr live spec — safe to ignore/expire',
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      metadata: { source: 'invoicerr-live-spec' },
    });

    // HARD-SUCCESS CONTRACT (documentation/docs/developer-guide/live-testing.md): never tolerate an
    // empty/missing id or a URL that isn't Stripe's own hosted domain — a soft `expect().toBeTruthy()`
    // could quietly pass on a shrugging response the same way this codebase's other live specs warn
    // against.
    if (!result.providerSessionId || !result.checkoutUrl.startsWith('https://checkout.stripe.com/')) {
      throw new Error(
        `Stripe did not return a usable session — hard failure. Raw: ${JSON.stringify(result)}`,
      );
    }
    expect(result.providerSessionId).toMatch(/^cs_test_/);
    console.log(
      'Stripe session created — open manually to inspect (never auto-completed):',
      result.checkoutUrl,
    );
  }, 15_000);
});
