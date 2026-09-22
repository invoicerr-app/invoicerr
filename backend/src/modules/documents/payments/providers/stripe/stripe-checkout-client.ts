import { randomUUID } from 'node:crypto';

import { CreateCheckoutSessionInput, CreateCheckoutSessionResult } from '../../provider';

/**
 * The ONE network-calling piece of this integration — everything else in `providers/stripe/` (the
 * webhook signature check, the provider glue) is pure and network-free. Kept behind this narrow
 * interface, rather than called directly from `StripeProvider`, for exactly the reason
 * `stripe-provider.ts`'s own header names: `NODE_ENV=test` swaps in `FakeStripeCheckoutClient` below,
 * the same "a test double stands in for the one thing jest/e2e cannot do offline" discipline
 * `clients.module.ts`'s own `NullVatValidationClient` already holds for VIES.
 */
export interface StripeCheckoutClient {
  createSession(secretKey: string, input: CreateCheckoutSessionInput): Promise<CreateCheckoutSessionResult>;
}

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

/**
 * A hand-rolled REST call, not the `stripe` npm SDK — the same "no dependency for something this
 * focused" reasoning `stripe-signature.ts`'s own header gives for the webhook check, and the same
 * shape every OTHER national channel client in this codebase already holds (`pdp/pdp-client.ts`,
 * `ksef/ksef-client.ts`: a plain `fetch` call, form/JSON body, bearer or basic auth). Stripe's
 * Checkout Sessions API takes `application/x-www-form-urlencoded`, with bracket notation for nested
 * objects/arrays (`line_items[0][price_data][currency]`) — there is exactly one call this client ever
 * makes, so a generic form-encoder would be more machinery than the four fields below need.
 *
 * THIS CLASS HAS NEVER BEEN RUN AGAINST A REAL STRIPE ACCOUNT — no such account exists for this
 * project (see `payments-webhook.controller.ts`'s own header and `stripe.live.spec.ts`, gated
 * `STRIPE_LIVE=1`, which skips cleanly today). It is exercised only by unit tests that stub `fetch`
 * (`stripe-checkout-client.spec.ts`) and, in every offline environment (dev, CI, e2e), replaced
 * outright by `FakeStripeCheckoutClient` below — see `stripe-provider.ts`'s own factory. Say so here,
 * not just in a test file, because this is the one class in this feature a real account would
 * actually have to prove.
 */
export class RealStripeCheckoutClient implements StripeCheckoutClient {
  async createSession(
    secretKey: string,
    input: CreateCheckoutSessionInput,
  ): Promise<CreateCheckoutSessionResult> {
    const body = new URLSearchParams();
    body.set('mode', 'payment');
    body.set('success_url', input.successUrl);
    body.set('cancel_url', input.cancelUrl);
    body.set('line_items[0][quantity]', '1');
    body.set('line_items[0][price_data][currency]', input.currency.toLowerCase());
    body.set('line_items[0][price_data][unit_amount]', String(input.amountMinor));
    body.set('line_items[0][price_data][product_data][name]', input.description);
    for (const [key, value] of Object.entries(input.metadata)) {
      body.set(`metadata[${key}]`, value);
    }

    const response = await fetch(`${STRIPE_API_BASE}/checkout/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(15_000),
    });

    const payload = (await response.json().catch(() => null)) as {
      id?: string;
      url?: string;
      error?: { message?: string };
    } | null;

    if (!response.ok || !payload?.id || !payload.url) {
      const message = payload?.error?.message ?? `HTTP ${response.status}`;
      throw new Error(`Stripe checkout session creation failed: ${message}`);
    }

    return { providerSessionId: payload.id, checkoutUrl: payload.url };
  }
}

/**
 * Network-free stand-in for `NODE_ENV=test` (every jest run, and the e2e backend — `.env.test` sets
 * `NODE_ENV=test`, exactly the same gate `clients.module.ts#vatValidationClient` already uses for
 * VIES). Deterministic and clearly fake (the `checkoutUrl` host, `mock-stripe.invalid`, is not a real
 * domain) — never mistaken for a real Stripe response by anything reading it.
 *
 * This is what makes "connect Stripe with test credentials, click Pay, the mocked provider reports
 * success" runnable with NO account and NO network call: this class only ever proves the WIRING (the
 * session is persisted, correlated by its own id, and a webhook against it drives `record-payment`
 * exactly once) — never that a real card would actually be charged. Say so again at the one call site
 * that matters: `stripe-provider.ts`'s own header, and `stripe.live.spec.ts`'s.
 */
export class FakeStripeCheckoutClient implements StripeCheckoutClient {
  async createSession(
    _secretKey: string,
    input: CreateCheckoutSessionInput,
  ): Promise<CreateCheckoutSessionResult> {
    const providerSessionId = `cs_test_fake_${randomUUID()}`;
    // `input.successUrl` echoed back as a query param — NOT anything a real Stripe checkout URL ever
    // carries (the real one is `https://checkout.stripe.com/...`, opaque, and never reveals the return
    // URL it was configured with). This exists ONLY so an offline test can observe, end to end through
    // a real HTTP response, which `successUrl` `PortalService.createInvoiceCheckoutSession` actually
    // built for THIS session — see that method's own header on why it now embeds the caller's raw
    // portal token — without a new persisted column (`PaymentCheckoutSession` stores `checkoutUrl`
    // only, never the return URLs that produced it).
    const returnUrl = new URLSearchParams({ success_url: input.successUrl });
    return {
      providerSessionId,
      checkoutUrl: `https://mock-stripe.invalid/checkout/${providerSessionId}?${returnUrl}`,
    };
  }
}
