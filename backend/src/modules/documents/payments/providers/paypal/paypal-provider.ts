import {
  CreateCheckoutSessionInput,
  CreateCheckoutSessionResult,
  PaymentProvider,
  PaymentProviderEvent,
  PaymentWebhookVerificationError,
} from '../../provider';
import { PayPalClient, PayPalCredentials, PayPalEnvironment } from './paypal-client';

/** Extracts and validates the four fields this provider needs out of a resolved `CompanyChannelConfig`
 *  — same shape as `stripe-provider.ts#extractStripeCredentials`/`mollie-provider.ts
 *  #extractMollieCredentials`. `environment` lives INSIDE this blob (not read off `CompanyChannelConfig.
 *  environment`, the TEST/PROD column every OTHER provider's own `ChannelEnvironment` already carries)
 *  because `PaymentProvider.createCheckoutSession`/`parseWebhookEvent` only ever receive the decrypted
 *  `config` object, never the row's own `environment` column (see `payment-sessions.service.ts`:
 *  `provider.createCheckoutSession(config.config, …)`) — and PayPal, unlike Stripe/Mollie, genuinely
 *  needs to know sandbox vs live BEFORE making a call (two different hostnames, not just a key prefix).
 *  The settings screen sets this field alongside the shared TEST/PROD selector — see
 *  `payments.settings.tsx`'s own header. */
export function extractPayPalCredentials(config: Record<string, unknown>): PayPalCredentials | null {
  const { clientId, clientSecret, webhookId, environment } = config;
  if (typeof clientId !== 'string' || !clientId) return null;
  if (typeof clientSecret !== 'string' || !clientSecret) return null;
  if (typeof webhookId !== 'string' || !webhookId) return null;
  if (environment !== 'sandbox' && environment !== 'live') return null;
  return { clientId, clientSecret, webhookId, environment: environment as PayPalEnvironment };
}

const REQUIRED_TRANSMISSION_HEADERS = [
  'paypal-transmission-id',
  'paypal-transmission-time',
  'paypal-cert-url',
  'paypal-auth-algo',
  'paypal-transmission-sig',
] as const;

function headerString(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * PayPal Orders API v2 — the THIRD `PaymentProvider`.
 *
 * THE STRUCTURAL DIFFERENCE FROM STRIPE: a Stripe Checkout Session auto-charges the instant the buyer
 * completes it. A PayPal Order (intent `CAPTURE`) does NOT — the buyer's approval alone moves no money;
 * this app's own server must call `POST /v2/checkout/orders/{id}/capture` afterwards, or nothing is ever
 * charged. This feature's own brief asks for that capture to happen "at return" (the buyer's browser
 * landing back on `successUrl`) — this provider does NOT implement a bespoke return-triggered HTTP
 * endpoint for that. Instead, it captures from `CHECKOUT.ORDER.APPROVED`, a webhook PayPal fires
 * server-to-server the moment the buyer approves, independent of whether their BROWSER ever actually
 * makes it back to this app (closed tab, lost connection, an ad-blocker eating the redirect — none of
 * those affect PayPal's own webhook delivery). This is a deliberate substitution, not an oversight —
 * flagged here for review: it is MORE robust than a return-only capture (which strands an approved-but-
 * uncaptured order if the browser never returns) and needs no new controller route/frontend wiring, at
 * the cost of depending on this company's own PayPal webhook subscription being live and reachable
 * (the exact same dependency Stripe/Mollie already have for THEIR completion signal).
 *
 * The actual CREDIT to the invoice still happens ONLY on a separately verified `PAYMENT.CAPTURE.
 * COMPLETED` event — `CHECKOUT.ORDER.APPROVED` triggers the capture but is itself mapped to 'ignored',
 * preserving `provider.ts`'s own hard rule ("only a verified webhook credits the invoice", never a
 * browser redirect or an intermediate event).
 *
 * WEBHOOK VERIFICATION: PayPal's own `POST /v1/notifications/verify-webhook-signature` — see
 * `paypal-client.ts`'s own header for the five transmission headers and the OAuth token it needs. A
 * missing header, a failed verification call, or a `verification_status !== "SUCCESS"` response are ALL
 * refused identically (`PaymentWebhookVerificationError`) — never a webhook accepted without it, per
 * this feature's own hard requirement.
 */
export class PayPalProvider implements PaymentProvider {
  readonly id = 'paypal';

  constructor(private readonly client: PayPalClient) {}

  async createCheckoutSession(
    credentials: Record<string, unknown>,
    input: CreateCheckoutSessionInput,
  ): Promise<CreateCheckoutSessionResult> {
    const paypalCredentials = extractPayPalCredentials(credentials);
    if (!paypalCredentials) {
      throw new Error(
        'PayPal is not fully configured for this company (missing clientId/clientSecret/webhookId/environment).',
      );
    }
    return this.client.createOrder(paypalCredentials, input);
  }

  async parseWebhookEvent(
    rawBody: Buffer | string,
    headers: Record<string, string | string[] | undefined>,
    credentials: Record<string, unknown>,
  ): Promise<PaymentProviderEvent> {
    const paypalCredentials = extractPayPalCredentials(credentials);
    if (!paypalCredentials) {
      throw new PaymentWebhookVerificationError(
        'PayPal is not configured for this company — cannot verify this webhook.',
      );
    }

    const bodyText = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf-8');
    let webhookEvent: Record<string, unknown>;
    try {
      webhookEvent = JSON.parse(bodyText) as Record<string, unknown>;
    } catch {
      throw new PaymentWebhookVerificationError('PayPal webhook body is not valid JSON.');
    }

    const missing = REQUIRED_TRANSMISSION_HEADERS.filter((name) => !headerString(headers, name));
    if (missing.length > 0) {
      throw new PaymentWebhookVerificationError(
        `Missing PayPal transmission header(s): ${missing.join(', ')} — cannot verify this webhook.`,
      );
    }

    let verified: boolean;
    try {
      verified = await this.client.verifyWebhookSignature(paypalCredentials, {
        transmissionId: headerString(headers, 'paypal-transmission-id')!,
        transmissionTime: headerString(headers, 'paypal-transmission-time')!,
        certUrl: headerString(headers, 'paypal-cert-url')!,
        authAlgo: headerString(headers, 'paypal-auth-algo')!,
        transmissionSig: headerString(headers, 'paypal-transmission-sig')!,
        webhookEvent,
      });
    } catch (error) {
      throw new PaymentWebhookVerificationError(
        `PayPal signature verification call failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    // NEVER a webhook accepted without this check passing — see this class's own header.
    if (!verified) {
      throw new PaymentWebhookVerificationError(
        'PayPal webhook signature verification returned FAILURE — refusing the event.',
      );
    }

    const eventType = typeof webhookEvent.event_type === 'string' ? webhookEvent.event_type : undefined;
    const resource = (webhookEvent.resource ?? {}) as {
      id?: string;
      supplementary_data?: { related_ids?: { order_id?: string } };
    };

    if (eventType === 'CHECKOUT.ORDER.APPROVED') {
      const orderId = typeof resource.id === 'string' ? resource.id : null;
      if (orderId) {
        try {
          // See this class's own header: THE capture trigger, server-driven. Idempotent
          // (`captureOrder`'s own `ORDER_ALREADY_CAPTURED` handling) — a redundant capture from a
          // redelivered `CHECKOUT.ORDER.APPROVED` (PayPal's webhooks are at-least-once, same as
          // Stripe's/Mollie's) is a harmless no-op, never a second charge.
          await this.client.captureOrder(paypalCredentials, orderId);
        } catch (error) {
          // A genuine capture failure — NOT swallowed as "ignored": `PaymentsWebhookController` turns a
          // throw into a 5xx, and PayPal's own retry schedule is exactly the recovery mechanism this
          // needs, the same discipline `payment-sessions.service.ts#handleWebhookEvent`'s own header
          // holds for a failed "record-payment" call.
          throw new Error(
            `PayPal order capture (triggered by CHECKOUT.ORDER.APPROVED) failed: ` +
              `${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      // The credit itself is never applied here — see this class's own header.
      return { type: 'ignored', providerSessionId: orderId };
    }

    if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
      const orderId = resource.supplementary_data?.related_ids?.order_id;
      return { type: 'checkout.completed', providerSessionId: typeof orderId === 'string' ? orderId : null };
    }

    if (eventType === 'PAYMENT.CAPTURE.DENIED' || eventType === 'PAYMENT.CAPTURE.DECLINED') {
      const orderId = resource.supplementary_data?.related_ids?.order_id;
      return { type: 'checkout.failed', providerSessionId: typeof orderId === 'string' ? orderId : null };
    }

    // Every other event type PayPal fans out over this same endpoint — see `provider.ts`'s own header
    // on why this is a deliberate, logged no-op rather than an error.
    return { type: 'ignored', providerSessionId: null };
  }
}
