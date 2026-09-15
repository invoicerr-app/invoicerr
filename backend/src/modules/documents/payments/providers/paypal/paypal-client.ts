import { randomUUID } from 'node:crypto';

import { decimalsFor, fromMinor } from '@/utils/financial';

import { CreateCheckoutSessionInput, CreateCheckoutSessionResult } from '../../provider';

export type PayPalEnvironment = 'sandbox' | 'live';

export interface PayPalCredentials {
  clientId: string;
  clientSecret: string;
  /** The webhook's own id, issued by PayPal when a company registers this app's webhook URL in their
   *  PayPal developer dashboard — required by `verify-webhook-signature` (see `paypal-provider.ts`'s
   *  own header). Bring-your-own, same as `clientId`/`clientSecret` — never a value this app invents. */
  webhookId: string;
  environment: PayPalEnvironment;
}

/** What `PayPalProvider.parseWebhookEvent` hands the client for a signature check — the five headers
 *  PayPal's own `verify-webhook-signature` endpoint requires, plus the exact parsed event body (PayPal
 *  verifies against the JSON OBJECT, not the raw bytes — unlike Stripe's byte-exact HMAC). */
export interface PayPalWebhookVerificationInput {
  transmissionId: string;
  transmissionTime: string;
  certUrl: string;
  authAlgo: string;
  transmissionSig: string;
  webhookEvent: unknown;
}

export interface PayPalClient {
  createOrder(
    credentials: PayPalCredentials,
    input: CreateCheckoutSessionInput,
  ): Promise<CreateCheckoutSessionResult>;
  /** Idempotent by construction — see `RealPayPalClient.captureOrder`'s own header on
   *  `ORDER_ALREADY_CAPTURED`: a second capture attempt for an order already captured (a lost race
   *  between the `CHECKOUT.ORDER.APPROVED`-triggered capture and any other trigger) succeeds as a
   *  no-op, never a thrown error. */
  captureOrder(credentials: PayPalCredentials, orderId: string): Promise<{ status: string }>;
  verifyWebhookSignature(
    credentials: PayPalCredentials,
    input: PayPalWebhookVerificationInput,
  ): Promise<boolean>;
}

const PAYPAL_API_BASE: Record<PayPalEnvironment, string> = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  live: 'https://api-m.paypal.com',
};

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

/**
 * Hand-rolled `fetch`, never a PayPal SDK — the brief's own instruction, and correct independent of it:
 * PayPal deprecated its official Node SDKs (`paypal-rest-sdk`, `@paypal/checkout-server-sdk`) years
 * ago in favor of documenting the raw REST calls directly, so there is no current, maintained SDK to
 * reach for even if this codebase's own "no dependency for something this focused" convention
 * (`stripe-checkout-client.ts`'s own header) allowed it. Three calls: OAuth token, create order,
 * capture order, plus the signature-verification endpoint — all plain JSON/form REST, the same shape
 * every other channel client here already holds.
 *
 * THIS CLASS HAS NEVER BEEN RUN AGAINST A REAL PAYPAL SANDBOX APP — no `PAYPAL_CLIENT_ID`/
 * `PAYPAL_CLIENT_SECRET` exist for this task (see this feature's own brief). Exercised only by unit
 * tests that stub `fetch` (`paypal-client.spec.ts`) and, in every offline environment, replaced by
 * `FakePayPalClient` below.
 */
export class RealPayPalClient implements PayPalClient {
  private readonly tokenCache = new Map<string, CachedToken>();

  private async getAccessToken(credentials: PayPalCredentials): Promise<string> {
    const cacheKey = `${credentials.environment}:${credentials.clientId}`;
    const cached = this.tokenCache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.accessToken;
    }

    const basicAuth = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64');
    const response = await fetch(`${PAYPAL_API_BASE[credentials.environment]}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(15_000),
    });

    const payload = (await response.json().catch(() => null)) as {
      access_token?: string;
      expires_in?: number;
      error_description?: string;
    } | null;

    if (!response.ok || !payload?.access_token) {
      const message = payload?.error_description ?? `HTTP ${response.status}`;
      throw new Error(`PayPal OAuth token request failed: ${message}`);
    }

    // Refresh 60s BEFORE the real expiry — never let an in-flight order-creation call race a token
    // that expires mid-request; PayPal's own `expires_in` is typically 32400s (9h).
    const expiresAt = now + (payload.expires_in ?? 0) * 1000 - 60_000;
    this.tokenCache.set(cacheKey, { accessToken: payload.access_token, expiresAt });
    return payload.access_token;
  }

  async createOrder(
    credentials: PayPalCredentials,
    input: CreateCheckoutSessionInput,
  ): Promise<CreateCheckoutSessionResult> {
    const accessToken = await this.getAccessToken(credentials);
    const base = PAYPAL_API_BASE[credentials.environment];
    // PayPal, unlike Mollie's own fixed-two-decimals quirk, genuinely requires the currency's OWN
    // decimal precision (0 for JPY/HUF-style currencies, 2 for most, 3 for a handful) — the same
    // `decimalsFor()` this codebase's own `paypal.descriptor.ts` classic-link builder already uses.
    const value = fromMinor(input.amountMinor, input.currency).toFixed(decimalsFor(input.currency));

    const response = await fetch(`${base}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        // Idempotent order creation at PayPal's OWN layer — deterministic per (company, document,
        // amount), never random, so a genuine client-side retry (this app's own `fetch` timing out
        // after PayPal actually processed the first attempt) reuses the SAME order instead of minting
        // a second one this app would then have two competing sessions for.
        'PayPal-Request-Id': `order:${input.metadata.companyId}:${input.metadata.documentId}:${input.amountMinor}`,
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          { amount: { currency_code: input.currency.toUpperCase(), value }, description: input.description },
        ],
        application_context: {
          return_url: input.successUrl,
          cancel_url: input.cancelUrl,
          user_action: 'PAY_NOW',
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const payload = (await response.json().catch(() => null)) as {
      id?: string;
      links?: { rel: string; href: string }[];
      message?: string;
    } | null;

    const approveLink = payload?.links?.find((link) => link.rel === 'approve')?.href;
    if (!response.ok || !payload?.id || !approveLink) {
      const message = payload?.message ?? `HTTP ${response.status}`;
      throw new Error(`PayPal order creation failed: ${message}`);
    }

    return { providerSessionId: payload.id, checkoutUrl: approveLink };
  }

  async captureOrder(credentials: PayPalCredentials, orderId: string): Promise<{ status: string }> {
    const accessToken = await this.getAccessToken(credentials);
    const base = PAYPAL_API_BASE[credentials.environment];

    const response = await fetch(`${base}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': `capture:${orderId}`,
      },
      signal: AbortSignal.timeout(15_000),
    });

    const payload = (await response.json().catch(() => null)) as {
      status?: string;
      details?: { issue?: string }[];
    } | null;

    if (response.ok && payload?.status) {
      return { status: payload.status };
    }
    // `ORDER_ALREADY_CAPTURED` — PayPal's own named issue for exactly the race this integration
    // deliberately allows (`paypal-provider.ts`'s own header: capture is triggered from
    // `CHECKOUT.ORDER.APPROVED`, PayPal's webhooks are at-least-once, so two overlapping captures for
    // the SAME order are an expected, not exceptional, outcome). Treated as success, never a failure.
    if (payload?.details?.some((detail) => detail.issue === 'ORDER_ALREADY_CAPTURED')) {
      return { status: 'COMPLETED' };
    }

    const message = payload?.details?.[0]?.issue ?? `HTTP ${response.status}`;
    throw new Error(`PayPal order capture failed (id=${orderId}): ${message}`);
  }

  async verifyWebhookSignature(
    credentials: PayPalCredentials,
    input: PayPalWebhookVerificationInput,
  ): Promise<boolean> {
    const accessToken = await this.getAccessToken(credentials);
    const base = PAYPAL_API_BASE[credentials.environment];

    const response = await fetch(`${base}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transmission_id: input.transmissionId,
        transmission_time: input.transmissionTime,
        cert_url: input.certUrl,
        auth_algo: input.authAlgo,
        transmission_sig: input.transmissionSig,
        webhook_id: credentials.webhookId,
        webhook_event: input.webhookEvent,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const payload = (await response.json().catch(() => null)) as { verification_status?: string } | null;
    return response.ok && payload?.verification_status === 'SUCCESS';
  }
}

/**
 * Network-free stand-in for `NODE_ENV=test`. `createOrder`/`captureOrder` track state in an in-memory
 * `Map` (alive for the life of the process, the same singleton lifetime every provider here gets from
 * `documents-core.module.ts`) — `captureOrder` on an unknown order id throws the same shape a real
 * PayPal 404 would. `verifyWebhookSignature` NEVER checks the five transmission headers cryptographically
 * (there is no real PayPal cert to check against offline) — instead it recognizes only an order id THIS
 * instance itself minted via `createOrder`/`captureOrder`, extracted from the event body the same way
 * the real provider does (`resource.id` for an order-level event, `resource.supplementary_data.
 * related_ids.order_id` for a capture-level one). A forged/foreign event — one naming an order id this
 * fake never created — fails verification exactly like a real bad signature would, which is what makes
 * the e2e "connect PayPal, open a session, a forged webhook must never touch the balance" test
 * meaningful with no account, the same property `FakeMollieClient`'s own header claims for Mollie.
 */
export class FakePayPalClient implements PayPalClient {
  private readonly orders = new Set<string>();

  async createOrder(
    _credentials: PayPalCredentials,
    input: CreateCheckoutSessionInput,
  ): Promise<CreateCheckoutSessionResult> {
    const providerSessionId = `EC-TEST-FAKE-${randomUUID()}`;
    this.orders.add(providerSessionId);
    // `input.successUrl` echoed back as a query param — see `stripe-checkout-client.ts`'s own
    // `FakeStripeCheckoutClient` header for why: test-only observability of the return URL this
    // session was actually opened with, never anything a real PayPal approve URL carries.
    const successUrl = encodeURIComponent(input.successUrl);
    return {
      providerSessionId,
      checkoutUrl: `https://mock-paypal.invalid/checkoutnow?token=${providerSessionId}&success_url=${successUrl}`,
    };
  }

  async captureOrder(_credentials: PayPalCredentials, orderId: string): Promise<{ status: string }> {
    if (!this.orders.has(orderId)) {
      throw new Error(`PayPal order capture failed (id=${orderId}): HTTP 404 (not found)`);
    }
    return { status: 'COMPLETED' };
  }

  async verifyWebhookSignature(
    _credentials: PayPalCredentials,
    input: PayPalWebhookVerificationInput,
  ): Promise<boolean> {
    const resource = (
      input.webhookEvent as {
        resource?: { id?: string; supplementary_data?: { related_ids?: { order_id?: string } } };
      } | null
    )?.resource;
    const orderId = resource?.supplementary_data?.related_ids?.order_id ?? resource?.id;
    return typeof orderId === 'string' && this.orders.has(orderId);
  }
}
