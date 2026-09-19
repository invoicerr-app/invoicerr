/**
 * REAL round-trip against a Mollie TEST-mode API key. Gated the same way every other live spec is
 * (`MOLLIE_LIVE=1` + `MOLLIE_API_KEY` — `live-gate.ts`, reused verbatim):
 *
 *   MOLLIE_LIVE=1 MOLLIE_API_KEY=test_... npx jest mollie.live --no-coverage --runInBand
 *
 * WHAT A GREEN RUN OF THIS SPEC PROVES: that `RealMollieClient` (the ONE network-calling class in this
 * provider — see its own header) can authenticate with a genuine Mollie API key, that Mollie accepts
 * the exact request shape this codebase builds (two-decimal amount string, `redirectUrl`, `webhookUrl`),
 * handing back a real `tr_...` payment id and a `https://www.mollie.com/checkout/...` URL a real browser
 * could actually open — and that a freshly-created payment re-fetches as `status: "open"`, the exact
 * fact `MollieProvider.parseWebhookEvent` relies on to distinguish "not yet terminal" from "paid".
 *
 * WHAT IT DOES NOT PROVE — no jest spec, gated or not, can prove offline: that Mollie's own servers
 * actually deliver a webhook to this application's public URL, or that a human completing the checkout
 * page (or Mollie's own test-mode "simulate paid" button) drives the status to `paid` and this app's
 * webhook handler then calls `record-payment`. The day a publicly reachable instance + real account
 * exists, that is proven by: opening the `checkoutUrl` a real `createInvoiceCheckoutSession` call
 * returns, using Mollie's own test-mode payment-status buttons, then confirming
 * `GET /api/payments/:documentId/sessions` shows `status: "COMPLETED"`.
 *
 * Say so here, not just in this feature's own report: a green MOCKED suite (`mollie-client.spec.ts`,
 * `mollie-provider.spec.ts`) proves the WIRING — request shape, response parsing, the verification
 * refusal path — never that a real payment was ever created or a real webhook ever delivered.
 */
import { liveDescribe } from '../../../transports/live-gate';
import { RealMollieClient } from './mollie-client';

const describeLive = liveDescribe('MOLLIE_LIVE', ['MOLLIE_API_KEY']);

describeLive('Mollie live round-trip (test-mode API key) — payment created and re-read', () => {
  it('creates a real payment and reads back a usable id/checkout url, then re-fetches it as "open"', async () => {
    const apiKey = process.env.MOLLIE_API_KEY ?? '';
    const client = new RealMollieClient();

    const created = await client.createPayment(
      apiKey,
      {
        amountMinor: 100,
        currency: 'EUR',
        description: 'invoicerr live spec — safe to ignore/expire',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        metadata: { source: 'invoicerr-live-spec' },
      },
      // A webhook URL Mollie will never actually be able to reach from this test run — harmless,
      // Mollie accepts any well-formed https URL at creation time and only ever POSTs to it later.
      'https://example.com/api/public/payments/mollie/live-spec/webhook',
    );

    // HARD-SUCCESS CONTRACT (documentation/docs/developer-guide/live-testing.md): never tolerate an
    // empty/missing id or a URL that isn't Mollie's own hosted domain.
    if (!created.providerSessionId || !created.checkoutUrl.startsWith('https://www.mollie.com/')) {
      throw new Error(
        `Mollie did not return a usable payment — hard failure. Raw: ${JSON.stringify(created)}`,
      );
    }
    expect(created.providerSessionId).toMatch(/^tr_/);

    const reFetched = await client.getPayment(apiKey, created.providerSessionId);
    if (reFetched.status !== 'open') {
      throw new Error(`Expected a freshly-created payment to re-fetch as "open", got "${reFetched.status}".`);
    }

    console.log(
      'Mollie payment created — open manually to inspect (never auto-completed):',
      created.checkoutUrl,
    );
  }, 15_000);
});
