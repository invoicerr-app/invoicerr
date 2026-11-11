/**
 * Pushes a company's settings answers that decide a platform's own declaration schedule (VAT regime,
 * option for VAT on debits) to the connected channel that carries its reporting obligation.
 *
 * Called best-effort from the company settings write so a changed answer applies before the next
 * declaration. A platform outage must never turn a settings save into a 500; a company with no
 * reporting obligation, no connected channel, or a channel with no profile endpoint has nothing to do.
 */
import { logger } from '@/logger/logger.service';
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import { resolveCompanyCountryCode } from '../country-policy/country-policy';
import { DeclarationProviderRegistry } from './declaration-provider';
import { buildDeclarationProviderRegistry } from './providers/build-registry';
import { defaultReportingObligationCatalog, ReportingObligationCatalog } from './registry';

export interface DeclaredProfileSyncDeps {
  catalog?: ReportingObligationCatalog;
  buildRegistry?: () => DeclarationProviderRegistry;
}

export async function syncDeclaredCompanyProfile(
  companyId: string,
  deps: DeclaredProfileSyncDeps = {},
): Promise<void> {
  const catalog = deps.catalog ?? defaultReportingObligationCatalog;
  try {
    const countryCode = await resolveCompanyCountryCode(companyId);
    if (!countryCode) return;

    const declarativeFacts = catalog.factsFor(countryCode).filter((fact) => fact.dischargedBy === 'provider');
    if (declarativeFacts.length === 0) return;
    const providerIds = new Set(declarativeFacts.map((fact) => fact.providerId));

    const registry = deps.buildRegistry
      ? deps.buildRegistry()
      : buildDeclarationProviderRegistry(new ChannelCredentialsService());
    for (const providerId of providerIds) {
      const provider = registry.resolve(providerId);
      if (!provider?.syncCompanyProfile) continue;
      try {
        await provider.syncCompanyProfile(companyId);
      } catch (error) {
        logger.warn(`Could not sync the company profile to "${providerId}" after a settings change`, {
          category: 'documents',
          details: {
            companyId,
            providerId,
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }
  } catch (error) {
    logger.warn('Could not sync a company profile change to its declaration channel', {
      category: 'documents',
      details: { companyId, message: error instanceof Error ? error.message : String(error) },
    });
  }
}
