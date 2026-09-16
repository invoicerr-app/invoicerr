import { randomUUID } from 'node:crypto';

import { fromMinor } from '@/utils/financial';

import { CreateCheckoutSessionInput, CreateCheckoutSessionResult } from '../../provider';

/**
 * The two Mollie Payments API v2 calls this integration needs — kept behind this narrow interface for
 * the exact same reason `stripe-checkout-client.ts#StripeCheckoutClient` is: `NODE_ENV=test` (every
 * jest run, and the e2e backend) swaps in `FakeMollieClient` below, never touching `api.mollie.com`.
 *
 * UNLIKE Stripe, BOTH methods here are faked under `NODE_ENV=test` — not just session creation. Mollie
 * sends no webhook signature at all (see `mollie-provider.ts`'s own header): the only way to verify an
 * inbound webhook is `getPayment`, an authenticated network call. Stripe's own signature check needs no
 * network and is therefore NEVER faked (`stripe-signature.ts`'s own header) — that asymmetry does not
 * exist for Mollie, so this file's `getPayment` is exactly as fake-able (and exactly as necessarily
 * faked offline) as `createPayment` is.
 */
export interface MolliePaymentStatus {
  /** Mollie's own payment status vocabulary — 'open' | 'pending' | 'authorized' | 'paid' | 'canceled'
   *  | 'expired' | 'failed', verbatim, never narrowed here: `mollie-provider.ts` does the mapping to
   *  this app's own `PaymentProviderEventType`, so this interface stays a faithful passthrough. */
  status: string;
}

export interface MollieClient {
  createPayment(
    apiKey: string,
    input: CreateCheckoutSessionInput,
    webhookUrl: string,
  ): Promise<CreateCheckoutSessionResult>;
  getPayment(apiKey: string, paymentId: string): Promise<MolliePaymentStatus>;
}

const MOLLIE_API_BASE = 'https://api.mollie.com/v2';

/**
 * Hand-rolled `fetch`, not the official `@mollie/api-client` SDK — a deliberate choice, spelled out
 * here since the brief explicitly asked to justify it. The SDK is a full REST client (typed models for
 * every Mollie resource — payments, subscriptions, mandates, refunds, orders — retries, pagination
 * helpers) for what this integration actually needs: exactly TWO calls, `POST /v2/payments` and
 * `GET /v2/payments/{id}`. That is a SMALLER surface than `stripe-checkout-client.ts`'s own single call,
 * and this codebase's own established answer for "one or two focused REST calls" is a plain `fetch`
 * client, not a dependency — see that file's own header, and every national channel client in
 * `transports/` (`pdp-client.ts`, `ksef-client.ts`): none of them pull in a vendor SDK either. Adding
 * `@mollie/api-client` would also mean a `package.json`/`package-lock.json` change on a branch two other
 * agents are actively working on in parallel (Polar billing, Cypress specs) — a real, avoidable
 * merge-conflict surface for zero functional gain, since `fetch` already covers everything this
 * provider needs.
 *
 * THIS CLASS HAS NEVER BEEN RUN AGAINST A REAL MOLLIE ACCOUNT — no `MOLLIE_API_KEY` exists for this
 * task (see this feature's own brief: "no sandbox key is available yet"). It is exercised
 * only by unit tests that stub `fetch` (`mollie-client.spec.ts`) and, in every offline environment,
 * replaced outright by `FakeMollieClient` below. Say so here, not just in a test file — the same
 * discipline `stripe-checkout-client.ts`'s own header holds for the identical, honest gap.
 */
export class RealMollieClient implements MollieClient {
  async createPayment(
    apiKey: string,
    input: CreateCheckoutSessionInput,
    webhookUrl: string,
  ): Promise<CreateCheckoutSessionResult> {
    const body = {
      amount: {
        currency: input.currency.toUpperCase(),
        // Mollie's own documented quirk (this feature's own brief names it explicitly): the amount
        // VALUE is always a two-decimal string, regardless of the currency's own subdivision — unlike
        // `decimalsFor()` elsewhere in this codebase (JPY 0, KWD 3, …), which governs how THIS app
        // rounds/displays an amount, never what Mollie's own wire format expects.
        value: fromMinor(input.amountMinor, input.currency).toFixed(2),
      },
      description: input.description,
      // ONE redirect URL for every outcome (paid, canceled, expired) — Mollie's Payments API has no
      // separate `cancelUrl` the way Stripe/PayPal do; the buyer always returns here, and the actual
      // outcome is learned by asking Mollie (`getPayment`), never by trusting which query string
      // parameters happen to be present on return (see `provider.ts`'s own hard rule: a redirect is
      // never trusted as a success/failure signal either way). `input.cancelUrl` is therefore
      // deliberately unused here — not an oversight, Mollie's own API has nowhere to put it.
      redirectUrl: input.successUrl,
      webhookUrl,
      metadata: input.metadata,
    };

    const response = await fetch(`${MOLLIE_API_BASE}/payments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    const payload = (await response.json().catch(() => null)) as {
      id?: string;
      _links?: { checkout?: { href?: string } };
      detail?: string;
    } | null;

    const checkoutUrl = payload?._links?.checkout?.href;
    if (!response.ok || !payload?.id || !checkoutUrl) {
      const message = payload?.detail ?? `HTTP ${response.status}`;
      throw new Error(`Mollie payment creation failed: ${message}`);
    }

    return { providerSessionId: payload.id, checkoutUrl };
  }

  async getPayment(apiKey: string, paymentId: string): Promise<MolliePaymentStatus> {
    const response = await fetch(`${MOLLIE_API_BASE}/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });

    const payload = (await response.json().catch(() => null)) as { status?: string; detail?: string } | null;
    if (!response.ok || !payload?.status) {
      const message = payload?.detail ?? `HTTP ${response.status}`;
      throw new Error(`Mollie payment re-fetch failed (id=${paymentId}): ${message}`);
    }

    return { status: payload.status };
  }
}

/**
 * Network-free stand-in for `NODE_ENV=test` — see this file's own header for why BOTH methods are
 * faked here, unlike Stripe. `getPayment` recognizes only a `paymentId` THIS instance itself minted via
 * `createPayment` (an in-memory `Set`, alive for the life of the process — the same singleton lifetime
 * `documents-core.module.ts` gives every provider it wires): a payment id this fake never created
 * throws, mapped by `MolliePaymentStatus`'s own caller (`mollie-provider.ts`) to a refused webhook,
 * exactly like a bad Stripe signature would be. This is what makes the e2e "connect Mollie, open a
 * (faked) checkout session, a simulated webhook settles it" flow meaningful with NO account: a webhook
 * naming a payment id this backend never opened a session for is refused, not rubber-stamped.
 *
 * Deliberately ALWAYS reports 'paid' for a known id — the same "always succeeds" optimism
 * `FakeStripeCheckoutClient` already holds for session creation. The failed/canceled/expired MAPPING
 * (this provider's own job, not this client's) is exercised at `MollieProvider`'s own unit-test level
 * with a bare stubbed `MollieClient`, never through this class — see `mollie-provider.spec.ts`.
 */
export class FakeMollieClient implements MollieClient {
  private readonly createdPaymentIds = new Set<string>();

  async createPayment(
    _apiKey: string,
    input: CreateCheckoutSessionInput,
    _webhookUrl: string,
  ): Promise<CreateCheckoutSessionResult> {
    const providerSessionId = `tr_test_fake_${randomUUID()}`;
    this.createdPaymentIds.add(providerSessionId);
    // `input.successUrl` echoed back as a query param — see `stripe-checkout-client.ts`'s own
    // `FakeStripeCheckoutClient` header for why: test-only observability of the return URL this
    // session was actually opened with, never anything a real Mollie checkout URL carries.
    const returnUrl = new URLSearchParams({ success_url: input.successUrl });
    return {
      providerSessionId,
      checkoutUrl: `https://mock-mollie.invalid/checkout/${providerSessionId}?${returnUrl}`,
    };
  }

  async getPayment(_apiKey: string, paymentId: string): Promise<MolliePaymentStatus> {
    if (!this.createdPaymentIds.has(paymentId)) {
      // The exact shape a real 404 from Mollie's own API would produce for a payment id owned by a
      // DIFFERENT account (or simply invented) — see `RealMollieClient.getPayment`'s own error shape.
      throw new Error(`Mollie payment re-fetch failed (id=${paymentId}): HTTP 404 (not found)`);
    }
    return { status: 'paid' };
  }
}
