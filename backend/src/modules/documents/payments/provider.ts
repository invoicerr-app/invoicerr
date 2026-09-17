/**
 * Online payment ("paiement en ligne") — the narrow interface a payment provider implements,
 * and nothing more. Modeled on `transports/transport-registry.ts`'s own `DocumentTransport` (a
 * provider registers itself under an id, the caller never branches on which one it got) rather than
 * an INSTANCE-WIDE, single-active-provider toggle flipped from a Settings screen — see
 * `documentation/docs/developer-guide/plugin-system.md`, "the narrow-interface-at-the-core pattern"
 * (the in-app plugin mechanism that pattern replaced, signing/storage stored in one `Plugin` table,
 * was removed entirely 2026-09-17). A payment provider needs a PER-COMPANY credential (a company
 * brings its own Stripe account — see `payment-sessions.service.ts`'s own header on that decision) and
 * it is reached from TWO directions a single instance-wide toggle was never built for (a
 * company-authenticated "open a checkout session" call, and an unauthenticated, signature-verified
 * provider webhook) — exactly the shape `TransportRegistry`/`AuthorityStatusPollerRegistry`/
 * `DeclarationProviderRegistry` already hold for the identical
 * "a provider registers itself under an id, credentials come from `ChannelCredentialsService`" problem.
 *
 * Stripe was first (`providers/stripe/stripe-provider.ts`); Mollie (`providers/mollie/`) and PayPal
 * (`providers/paypal/`) followed the same shape — a provider is exactly one more file implementing
 * this interface plus one more `PaymentProviderRegistry.register()` call, never a change to
 * `PaymentSessionsService` or either controller that calls it.
 *
 * `parseWebhookEvent` WIDENED for Mollie/PayPal (originally Stripe-only, synchronous, one signature
 * header): it is now `Promise`-returning and takes the FULL inbound header map, not one named header.
 * Two reasons, both real, neither Stripe-specific machinery leaking in:
 *  1. Stripe's own scheme needs exactly one header (`Stripe-Signature`) and no network call — a pure,
 *     synchronous function. PayPal's `verify-webhook-signature` needs FIVE headers (`PAYPAL-
 *     TRANSMISSION-ID/-TIME/-CERT-URL/-AUTH-ALGO/-TRANSMISSION-SIG`) plus an OAuth-authenticated POST
 *     to PayPal's own API — a single named "signature header" parameter has no way to carry that.
 *  2. Mollie sends NO signature at all — a webhook is a bare `POST` body `id=tr_xxx`; the OFFICIAL
 *     verification is re-reading the payment via an AUTHENTICATED `GET /v2/payments/{id}` with this
 *     company's own API key and trusting THAT response, never the webhook body itself (see
 *     `mollie-provider.ts`'s own header). That is unavoidably a network call, so this method being
 *     synchronous stopped being true the moment Mollie needed to implement it.
 * `StripeProvider.parseWebhookEvent` itself does no I/O even now — it is declared `async` purely to
 * satisfy this shared signature, not because Stripe suddenly needs a network round trip.
 */

/** What a caller asks a provider to open — deliberately narrow: no card fields, no bank details, ever
 *  (see this module's own hard rule — `payment-sessions.service.ts`'s header — "this app holds a
 *  session id and a status, nothing more"). `amountMinor`/`currency` are ALREADY the resolved,
 *  server-computed outstanding figure (`settlement/compute-settlement.ts`) by the time this is called —
 *  a provider implementation never re-derives or second-guesses them. */
export interface CreateCheckoutSessionInput {
  amountMinor: number;
  currency: string;
  /** A human label for the provider's own hosted line item — e.g. "Invoice INV-2026-014". Plain text,
   *  not an i18n key, the same convention `DocumentTransportContext.label` already holds. */
  description: string;
  /** Where the provider's own hosted page redirects on success/cancel — both point back at the client
   *  portal; neither is ever trusted as a signal that payment actually succeeded (see
   *  `payment-sessions.service.ts`'s own header: only a verified webhook does that). */
  successUrl: string;
  cancelUrl: string;
  /** Opaque key-value pairs a provider echoes back on its own webhook event — how
   *  `PaymentSessionsService` correlates an inbound event to the `PaymentCheckoutSession` row that
   *  requested it, WITHOUT trusting the echoed values themselves (the row is looked up by
   *  `providerSessionId`, never by re-reading this metadata back out of the event — see
   *  `payment-sessions.service.ts#handleWebhookEvent`). */
  metadata: Record<string, string>;
}

export interface CreateCheckoutSessionResult {
  /** The provider's OWN session id (Stripe's `cs_...`) — what its webhook event will name, and what
   *  `PaymentCheckoutSession.providerSessionId` stores verbatim. */
  providerSessionId: string;
  /** The provider's own hosted payment page. Never rendered, proxied, or embedded by this app — handed
   *  to the client's browser as-is (see this module's own hard rule). */
  checkoutUrl: string;
}

export type PaymentProviderEventType =
  | 'checkout.completed'
  | 'checkout.failed'
  /** Every OTHER event a provider's webhook endpoint receives (Stripe fans one endpoint out over
   *  dozens of event types) — `PaymentSessionsService` treats this as a deliberate, logged no-op, 200
   *  either way: a webhook endpoint that 4xx/5xx's on an event type it doesn't care about teaches the
   *  provider to retry forever for no reason, and eventually to disable the endpoint. */
  | 'ignored';

export interface PaymentProviderEvent {
  type: PaymentProviderEventType;
  /** Null only for `type: 'ignored'` when the event carries no session reference at all — every
   *  `'checkout.completed'`/`'checkout.failed'` event always has one. */
  providerSessionId: string | null;
}

/** Thrown by `parseWebhookEvent` for anything that fails signature/timestamp verification — a
 *  DISTINCT type from a parse error, so `PaymentSessionsService`/its controller can log "forged or
 *  stale webhook" precisely rather than lump it in with "this event type doesn't concern us". */
export class PaymentWebhookVerificationError extends Error {}

export interface PaymentProvider {
  /** This provider's own registered id — "stripe" today. Mirrors `DocumentTransport`'s implicit id
   *  (the key it registers under) being made explicit here since, unlike a transport, a provider also
   *  needs to name itself INSIDE an event payload it did not itself construct (`providerId` written
   *  onto `PaymentCheckoutSession` at creation time). */
  id: string;

  /** Opens a real checkout session against the provider's own API using this company's OWN credentials
   *  (already resolved and decrypted by the caller — see `ChannelCredentialsService`, never handled by
   *  this interface itself). Throws on any failure — a provider implementation never invents a session
   *  id or URL for a call that did not actually succeed (the same hard-success discipline
   *  `pdp-transport.ts`'s own header holds for a national channel deposit). */
  createCheckoutSession(
    credentials: Record<string, unknown>,
    input: CreateCheckoutSessionInput,
  ): Promise<CreateCheckoutSessionResult>;

  /**
   * Verifies the inbound webhook against `credentials`' own secret(s) — a signature check for Stripe/
   * PayPal, an authenticated re-fetch for Mollie (see this interface's own header) — and, only once
   * verified, parses it into the narrow event shape above. Throws `PaymentWebhookVerificationError` for
   * a missing/invalid/stale signature, an authenticated re-fetch that fails, or any other verification
   * failure — NEVER returns a "verified: false" flag a caller could forget to check (the same "make the
   * wrong thing impossible to express" discipline `channels.service.ts`'s own `ChannelConfigStatus`
   * holds for "never let a secret reach this shape at all" — here, "never let an unverified event reach
   * the caller at all").
   *
   * `headers` is the FULL inbound header map, lowercased keys (Express's own convention) — every
   * provider reads only the header(s) it actually needs (Stripe: `stripe-signature`; PayPal: the five
   * `paypal-transmission-*`/`paypal-cert-url`/`paypal-auth-algo` headers; Mollie: none, it verifies by
   * re-fetching instead).
   */
  parseWebhookEvent(
    rawBody: Buffer | string,
    headers: Record<string, string | string[] | undefined>,
    credentials: Record<string, unknown>,
  ): Promise<PaymentProviderEvent>;
}
