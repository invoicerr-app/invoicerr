/**
 * The French accredited-platform (PA) declaration channel  -  the ONE legal channel France's
 * e-reporting obligation names (CGI art. 290: "transmises [...] par la plateforme agréée choisie par
 * la personne assujettie"). It is deliberately named after the channel, never after an operator:
 * SuperPDP is only the first adapter behind it, and Iopole, Billit or Invopop become one catalogue
 * flag plus one adapter, never a new provider id and never a vendor name in a country file.
 *
 * The provider does two things:
 * 1. resolve WHICH connected operator the company chose, from `operators/` (`capabilities.eReporting`)
 *    and the company's own active channel rows;
 * 2. delegate to that transport's adapter.
 *
 * No connected operator, no adapter, or no usable credential is `ChannelNotConnectedError`: the
 * runner journals `report:blocked` with its reason and never retries it. A declaration is never
 * silently skipped because a channel is missing.
 */
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import { resolveCompanyCountryCode, resolveCompanyProfile } from '../../country-policy/country-policy';
import { defaultOperatorCatalog, OperatorCatalog } from '../../operators/registry';
import {
  ChannelNotConnectedError,
  DeclarationProvider,
  DeclaredInvoice,
  DeclaredPayment,
  DeclarationResult,
} from '../declaration-provider';
import { EReportingAdapterRegistry } from '../ereporting-adapter';

export const FRENCH_PA_PROVIDER_ID = 'fr-pa';

export interface FrenchPaDeclarationProviderDeps {
  channelCredentials: ChannelCredentialsService;
  adapters: EReportingAdapterRegistry;
  operators?: OperatorCatalog;
}

export function buildFrenchPaDeclarationProvider(deps: FrenchPaDeclarationProviderDeps): DeclarationProvider {
  const operators = deps.operators ?? defaultOperatorCatalog;

  /**
   * The first active channel whose operator offering declares `capabilities.eReporting` for this
   * company's own country. A connected transport with no catalogued e-reporting capability is not a
   * candidate; an active candidate with no adapter in this build is a NAMED refusal, never a fallback
   * to another vendor the company did not choose.
   */
  async function resolveAdapter(companyId: string) {
    const [channels, countryCode, profile] = await Promise.all([
      deps.channelCredentials.listCompanyChannels(companyId),
      resolveCompanyCountryCode(companyId),
      resolveCompanyProfile(companyId),
    ]);

    const candidates = channels.filter((channel) => channel.isActive);
    for (const channel of candidates) {
      const matches = operators.matchesForTransportId(channel.providerId);
      const offering = matches.find(
        (match) =>
          match.offering.capabilities.eReporting &&
          (!countryCode || match.offering.countries.includes(countryCode)),
      );
      if (!offering) continue;

      const adapter = deps.adapters.resolve(channel.providerId);
      if (!adapter) {
        throw new ChannelNotConnectedError(
          `The connected operator "${offering.operator.name}" declares e-reporting support, but this ` +
            'build has no adapter for its API. Nothing was declared; connect an operator this ' +
            'version can speak to, or upgrade.',
        );
      }
      return { adapter, profile };
    }

    throw new ChannelNotConnectedError(
      'No connected operator can declare e-reporting for this company. Connect an accredited ' +
        'platform in company settings (Channels) first.',
    );
  }

  /** The platform's declaration schedule depends on these two facts; send them before declaring so a
   *  changed regime is never applied one declaration late. */
  async function syncProfile(
    adapter: Awaited<ReturnType<typeof resolveAdapter>>['adapter'],
    companyId: string,
    profile: Record<string, string>,
  ): Promise<void> {
    if (!adapter.syncCompanyProfile) return;
    await adapter.syncCompanyProfile(companyId, {
      vatRegime: profile.vatRegime ?? '',
      vatOnDebits: profile.vatDebitsOption === 'EXERCISED',
    });
  }

  return {
    providerId: FRENCH_PA_PROVIDER_ID,

    async declare(companyId: string, invoice: DeclaredInvoice): Promise<DeclarationResult> {
      const { adapter, profile } = await resolveAdapter(companyId);
      await syncProfile(adapter, companyId, profile);
      return adapter.declareTransaction(companyId, invoice);
    },

    async declarePayment(companyId: string, payment: DeclaredPayment): Promise<DeclarationResult> {
      const { adapter, profile } = await resolveAdapter(companyId);
      await syncProfile(adapter, companyId, profile);
      return adapter.declarePayment(companyId, payment);
    },
  };
}
