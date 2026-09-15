import {
  CreateCheckoutSessionInput,
  CreateCheckoutSessionResult,
  PaymentProvider,
  PaymentProviderEvent,
  PaymentWebhookVerificationError,
} from '../../provider';
import { MollieClient } from './mollie-client';

export interface MollieCredentials {
  /** `test_...` or `live_...` — Mollie's own single-key model (unlike PayPal, there is no separate
   *  clientId/secret pair, and unlike Stripe there is no separate webhook signing secret: this ONE key
   *  both creates payments and re-fetches them for verification — see this file's own header). */
  apiKey: string;
}

/** Extracts and validates the one field this provider needs out of a resolved `CompanyChannelConfig` —
 *  same shape as `stripe-provider.ts#extractStripeCredentials`. */
export function extractMollieCredentials(config: Record<string, unknown>): MollieCredentials | null {
  const { apiKey } = config;
  if (typeof apiKey !== 'string' || !apiKey) return null;
  return { apiKey };
}

/** Mollie's own terminal-failure vocabulary — everything else ('open', 'pending', 'authorized') is a
 *  genuine in-flight state, mapped to 'ignored' (this app's webhook is only ever asked once a payment
 *  reaches a TERMINAL state in practice — Mollie fires the webhook on every status change, including
 *  the intermediate ones, so 'ignored' here is the expected, silent no-op for those, not a bug). */
const FAILURE_STATUSES = new Set(['failed', 'canceled', 'expired']);

function webhookUrlFor(companyId: string): string {
  // Same `APP_URL` convention `webhooks.service.ts#generateWebhookUrl` already uses for building a
  // backend-hosted URL server-side (production is ONE public origin — nginx proxies `/api/*` to this
  // process on the same host, see CLAUDE.md's own "Deployment topology") — never `VITE_BACKEND_URL`,
  // which is a FRONTEND-only env var for the browser, not readable from here.
  const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  return `${appUrl}/api/public/payments/mollie/${companyId}/webhook`;
}

/**
 * Mollie Payments API v2 — the SECOND `PaymentProvider` (after Stripe). `client` is injected exactly
 * like `StripeProvider.checkoutClient` — see `mollie-client.ts`'s own header for what production wires
 * vs. `NODE_ENV=test`.
 *
 * THE STRUCTURAL DIFFERENCE FROM STRIPE, and why `parseWebhookEvent` looks nothing like
 * `stripe-provider.ts`'s own: Mollie's webhook carries NO signature at all — a bare
 * `application/x-www-form-urlencoded` POST body, `id=tr_xxx`, nothing else. Mollie's OWN documented
 * verification method is not "check a signature" but "re-fetch the payment via `GET /v2/payments/{id}`
 * using your own API key, and trust THAT response" (Mollie's docs call this out explicitly: never trust
 * the webhook body's own claims about status, since it makes none — it is only ever a ping). This
 * provider does exactly that, and refuses (throws `PaymentWebhookVerificationError`) if the re-fetch
 * itself fails for ANY reason — wrong/missing API key, a payment id belonging to a different Mollie
 * account (Mollie answers 404, since GET is scoped by the calling API key), or a network error. A 404
 * here is not "unknown session, ignore it" the way an unrecognized `providerSessionId` is handled
 * further up the stack (`payment-sessions.service.ts`) — it is treated as a VERIFICATION failure, the
 * same refusal a forged Stripe signature gets, because "Mollie will not vouch for this id under this
 * company's own key" is exactly as suspicious as a bad HMAC.
 */
export class MollieProvider implements PaymentProvider {
  readonly id = 'mollie';

  constructor(private readonly client: MollieClient) {}

  async createCheckoutSession(
    credentials: Record<string, unknown>,
    input: CreateCheckoutSessionInput,
  ): Promise<CreateCheckoutSessionResult> {
    const mollieCredentials = extractMollieCredentials(credentials);
    if (!mollieCredentials) {
      throw new Error('Mollie is not fully configured for this company (missing apiKey).');
    }

    // `input.metadata.companyId` — set by `PaymentSessionsService` on EVERY call (see `provider.ts`'s
    // own header on why metadata is never trusted for CORRELATION, a narrower claim than this: reading
    // it here to build Mollie's own required `webhookUrl` field is a plain, same-process read of a
    // value the caller itself just set, not trust placed in anything a webhook could later forge.
    const companyId = input.metadata.companyId;
    if (!companyId) {
      // Unreachable through `PaymentSessionsService` (always sets it) — refused loudly rather than
      // building a webhook URL Mollie could never actually reach back to the right company with.
      throw new Error('Cannot open a Mollie payment without a companyId in the session metadata.');
    }

    return this.client.createPayment(mollieCredentials.apiKey, input, webhookUrlFor(companyId));
  }

  // `_headers` unused: Mollie's webhook carries no signature header to read — see this class's own
  // header on why verification is an authenticated re-fetch instead.
  async parseWebhookEvent(
    rawBody: Buffer | string,
    _headers: Record<string, string | string[] | undefined>,
    credentials: Record<string, unknown>,
  ): Promise<PaymentProviderEvent> {
    const mollieCredentials = extractMollieCredentials(credentials);
    if (!mollieCredentials) {
      throw new PaymentWebhookVerificationError(
        'Mollie is not configured for this company — cannot verify this webhook.',
      );
    }

    const bodyText = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf-8');
    const paymentId = new URLSearchParams(bodyText).get('id');
    if (!paymentId) {
      throw new PaymentWebhookVerificationError(
        'Malformed Mollie webhook — expected a form-encoded "id" field.',
      );
    }

    let status: string;
    try {
      ({ status } = await this.client.getPayment(mollieCredentials.apiKey, paymentId));
    } catch (error) {
      // THE verification (see this class's own header) — a failed re-fetch IS a failed verification,
      // never partially trusted or logged-and-ignored.
      throw new PaymentWebhookVerificationError(
        `Could not verify Mollie payment "${paymentId}" against this company's own API key: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (status === 'paid') {
      return { type: 'checkout.completed', providerSessionId: paymentId };
    }
    if (FAILURE_STATUSES.has(status)) {
      return { type: 'checkout.failed', providerSessionId: paymentId };
    }
    // 'open' / 'pending' / 'authorized' — a genuine in-flight state, not yet terminal. See
    // `FAILURE_STATUSES`'s own header.
    return { type: 'ignored', providerSessionId: paymentId };
  }
}
