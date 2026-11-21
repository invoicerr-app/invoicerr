/**
 * Builds the registry every declarative-reporting consumer resolves a provider from. Lives outside
 * `documents-core.module.ts` so a company settings write can reach the same wiring without importing
 * the module graph (`reporting/profile-sync.ts`).
 */
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import { DeclarationProviderRegistry } from '../declaration-provider';
import { EReportingAdapterRegistry } from '../ereporting-adapter';
import { buildFrenchPaDeclarationProvider } from './fr-pa-declaration-provider';
import { buildPtAtDeclarationProvider } from './pt-declaration-provider';
import { buildSuperPdpEReportingAdapter } from './superpdp-ereporting-adapter';

export function buildDeclarationProviderRegistry(
  channelCredentials: ChannelCredentialsService,
): DeclarationProviderRegistry {
  const registry = new DeclarationProviderRegistry();
  registry.register(buildPtAtDeclarationProvider({ channelCredentials }));

  // The French accredited-platform channel (CGI art. 290/290 A). The provider id names the legal
  // channel, never a vendor: `operators/` decides which connected operator can discharge it and
  // `EReportingAdapterRegistry` decides which API this build speaks.
  const adapters = new EReportingAdapterRegistry();
  adapters.register(buildSuperPdpEReportingAdapter({ channelCredentials }));
  registry.register(buildFrenchPaDeclarationProvider({ channelCredentials, adapters }));

  return registry;
}
