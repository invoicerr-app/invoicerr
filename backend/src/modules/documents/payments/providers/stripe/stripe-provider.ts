import {
  CreateCheckoutSessionInput,
  CreateCheckoutSessionResult,
  PaymentProvider,
  PaymentProviderEvent,
  PaymentWebhookVerificationError,
} from '../../provider';
import { StripeCheckoutClient } from './stripe-checkout-client';
import { verifyStripeSignature } from './stripe-signature';

export interface StripeCredentials {
  secretKey: string;
  webhookSecret: string;
}

/** Extracts and validates the two fields this provider actually needs out of a resolved
 *  `CompanyChannelConfig` — the same "shared by every caller so neither can drift" shape
 *  `pdp-transport.ts#extractPdpCredentials` already holds for its own three fields. A `publishableKey`
 *  is deliberately NOT required here (or read at all): it is only ever needed by a browser-side Stripe
 *  Elements integration, which this app does not build — see `provider.ts`'s own header, "the payment
 *  page is the provider's own hosted surface". */
export function extractStripeCredentials(config: Record<string, unknown>): StripeCredentials | null {
  const { secretKey, webhookSecret } = config;
  if (typeof secretKey !== 'string' || !secretKey) return null;
  if (typeof webhookSecret !== 'string' || !webhookSecret) return null;
  return { secretKey, webhookSecret };
}

/**
 * Stripe Checkout — the FIRST (and, today, only) `PaymentProvider`. `checkoutClient` is injected
 * rather than constructed here (see `stripe-checkout-client.ts`'s own header): production wires the
 * real, network-calling one; every offline environment (`NODE_ENV=test` — jest AND the e2e backend)
 * wires the deterministic fake instead, chosen ONCE, at `documents-core.module.ts`'s own wiring site,
 * never branched on inside this class.
 *
 * `parseWebhookEvent` is the one method this class NEVER fakes, in any environment — see
 * `stripe-signature.ts`'s own header: it is pure, network-free, and exercises the exact cryptographic
 * check a real Stripe webhook is verified with, so a green jest/e2e run here is genuine evidence about
 * THIS integration's security boundary, not merely about its wiring.
 */
export class StripeProvider implements PaymentProvider {
  readonly id = 'stripe';

  constructor(private readonly checkoutClient: StripeCheckoutClient) {}

  async createCheckoutSession(
    credentials: Record<string, unknown>,
    input: CreateCheckoutSessionInput,
  ): Promise<CreateCheckoutSessionResult> {
    const stripeCredentials = extractStripeCredentials(credentials);
    if (!stripeCredentials) {
      throw new Error('Stripe is not fully configured for this company (missing secretKey/webhookSecret).');
    }
    return this.checkoutClient.createSession(stripeCredentials.secretKey, input);
  }

  // `async` only to satisfy `PaymentProvider`'s shared signature — see this class's own header. No
  // `await` below: Stripe's signature check is genuinely synchronous, unlike Mollie's/PayPal's.
  async parseWebhookEvent(
    rawBody: Buffer | string,
    headers: Record<string, string | string[] | undefined>,
    credentials: Record<string, unknown>,
  ): Promise<PaymentProviderEvent> {
    const stripeCredentials = extractStripeCredentials(credentials);
    // A signature can never be checked without a secret to check it against — refused the SAME way
    // `verifyStripeSignature` refuses an empty secret handed to it directly (its own defensive guard),
    // reached here first since a company with no `webhookSecret` on file has no business receiving
    // webhooks at all.
    if (!stripeCredentials) {
      throw new PaymentWebhookVerificationError(
        'Stripe is not configured for this company — cannot verify this webhook.',
      );
    }

    // Stripe's header is always a single value in practice (Express only ever produces an array for a
    // header repeated across multiple raw lines, which Stripe's own client never does) — an array here
    // would mean something is already wrong upstream, treated as "no usable signature" rather than
    // guessed at.
    const signatureHeader = headers['stripe-signature'];
    const event = verifyStripeSignature(
      rawBody,
      typeof signatureHeader === 'string' ? signatureHeader : undefined,
      stripeCredentials.webhookSecret,
    );
    const object = event.data.object;
    const providerSessionId = typeof object.id === 'string' ? object.id : null;

    if (event.type === 'checkout.session.completed' && object.payment_status === 'paid') {
      return { type: 'checkout.completed', providerSessionId };
    }
    if (event.type === 'checkout.session.expired' || event.type === 'payment_intent.payment_failed') {
      return { type: 'checkout.failed', providerSessionId };
    }
    // Every other event type Stripe fans out over this same endpoint (dozens of them —
    // `customer.created`, `invoice.paid` in STRIPE's own sense, etc.) — see `provider.ts`'s own header
    // on why this is a deliberate, logged no-op rather than an error.
    return { type: 'ignored', providerSessionId };
  }
}
