import { PaymentProvider } from './provider';
import { assertDemoSendingAllowed } from '@/modules/demo/demo-blocked';

/**
 * A provider registers itself under an id — the same minimal shape
 * `reporting/declaration-provider.ts#DeclarationProviderRegistry` already holds for the identical
 * "exactly one real implementation per process, resolved by an id read off a `CompanyChannelConfig`
 * row" problem. See `provider.ts`'s own header for why this is its own small registry rather than
 * an instance-wide, single-active-provider toggle, or `TransportRegistry` itself.
 */
export class PaymentProviderRegistry {
  private readonly providers = new Map<string, PaymentProvider>();

  /** Demo instance (issue #533): same "wrap the outbound call at registration" reasoning as
   *  `transports/transport-registry.ts#TransportRegistry.register`'s own header: a payment provider
   *  registered later is blocked automatically too. `parseWebhookEvent` is delegated through
   *  UNCHANGED, a real payment can never be opened in demo mode (`createCheckoutSession` is refused),
   *  so there is no legitimate inbound webhook to verify either way; leaving it wired would only
   *  complicate a provider webhook endpoint that already has nothing to receive.
   *
   *  Built as an explicit object literal, NEVER `{ ...provider, createCheckoutSession: ... }`: every
   *  real `PaymentProvider` (`StripeProvider`/`MollieProvider`/`PayPalProvider`) is a CLASS, and a
   *  class instance's methods live on its prototype, not as the instance's own enumerable properties,
   *  and an object spread only copies the latter. `{ ...provider }` silently produced a `guarded` object
   *  with NO `parseWebhookEvent` at all (`undefined`, not "delegates to the real one"), breaking every
   *  provider's webhook endpoint outright, demo mode or not: caught live by
   *  `71-online-payment-providers.cy.ts` failing on `cy.request()` once Mollie/PayPal's webhook calls
   *  hit an `undefined` method. Delegating each member explicitly, by name, is what makes this
   *  interface's own TypeScript shape (`PaymentProvider` above) catch a future member this file
   *  forgets to wire, instead of a spread silently dropping it. */
  register(provider: PaymentProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`A payment provider for "${provider.id}" is already registered.`);
    }
    const { id } = provider;
    const guarded: PaymentProvider = {
      id,
      createCheckoutSession: async (credentials, input) => {
        assertDemoSendingAllowed(`Opening a "${id}" checkout session`);
        return provider.createCheckoutSession(credentials, input);
      },
      parseWebhookEvent: (rawBody, headers, credentials) =>
        provider.parseWebhookEvent(rawBody, headers, credentials),
    };
    this.providers.set(id, guarded);
  }

  /** Every registered provider's own id — what the settings screen (and this codebase's own
   *  `ChannelsController`-shaped credential storage) offers to connect. */
  list(): string[] {
    return [...this.providers.keys()];
  }

  /** Never throws for an unknown id — `PaymentSessionsService` treats `undefined` as "this company
   *  picked (or was defaulted to) a provider nothing registered", the same "not connected" outcome an
   *  unresolvable `ChannelCredentialsService` config already produces, never a 500. */
  resolve(providerId: string): PaymentProvider | undefined {
    return this.providers.get(providerId);
  }
}
