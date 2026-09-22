import { PaymentProvider } from './provider';

/**
 * A provider registers itself under an id — the same minimal shape
 * `reporting/declaration-provider.ts#DeclarationProviderRegistry` already holds for the identical
 * "exactly one real implementation per process, resolved by an id read off a `CompanyChannelConfig`
 * row" problem. See `provider.ts`'s own header for why this is its own small registry rather than
 * an instance-wide, single-active-provider toggle, or `TransportRegistry` itself.
 */
export class PaymentProviderRegistry {
  private readonly providers = new Map<string, PaymentProvider>();

  register(provider: PaymentProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`A payment provider for "${provider.id}" is already registered.`);
    }
    this.providers.set(provider.id, provider);
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
