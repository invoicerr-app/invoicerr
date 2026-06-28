import { TransactionContext } from '../../canonical/canonical-document';
import { CompliancePlan } from '../../engine/compliance-engine';
import { ComplianceLogger, defaultLogger } from '../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../execution/types';
import { ChannelSpec } from '../../profiles/schema';
import { ChannelType } from '../../types';
import { ChannelCredentialsPort, ResolvedChannelConfig } from './channel-credentials-port';
import { InvoiceMailPort } from './invoice-mail-port';
import { TransmissionProvider } from './transmission-provider';
import {
  EmailTransmissionProvider,
  GovPortalTransmissionProvider,
  KsefTransmissionProvider,
  OseTransmissionProvider,
  PacTransmissionProvider,
  PdpTransmissionProvider,
  PeppolTransmissionProvider,
  PrintTransmissionProvider,
  SdiTransmissionProvider,
} from './providers';
import { NATIONAL_PORTAL_PROVIDERS } from './national-portals';

export class TransmissionProviderRegistry {
  private readonly byChannel = new Map<ChannelType, TransmissionProvider>();
  private readonly byId = new Map<string, TransmissionProvider>();
  readonly credentials?: ChannelCredentialsPort;

  constructor(providers?: TransmissionProvider[] | { mail?: InvoiceMailPort; credentials?: ChannelCredentialsPort }) {
    let list: TransmissionProvider[];
    if (Array.isArray(providers)) {
      list = providers;
      this.credentials = undefined;
    } else {
      this.credentials = providers?.credentials;
      list = [
        new EmailTransmissionProvider(providers?.mail),
        new PeppolTransmissionProvider(),
        new PdpTransmissionProvider(),
        new PacTransmissionProvider(),
        new SdiTransmissionProvider(),
        new GovPortalTransmissionProvider(),
        new KsefTransmissionProvider(providers?.credentials),
        new OseTransmissionProvider(),
        new PrintTransmissionProvider(),
        // Dedicated national portals — selected by ChannelSpec.providerId. Registered AFTER the
        // generics so 'gov-portal' stays the default for a bare GOV_PORTAL_API channel.
        ...NATIONAL_PORTAL_PROVIDERS,
      ];
    }
    for (const p of list) {
      this.byId.set(p.id, p);
      // First registered for a channel becomes the generic default for that channel.
      if (!this.byChannel.has(p.channel)) this.byChannel.set(p.channel, p);
    }
  }

  get(channel: ChannelType): TransmissionProvider | null {
    return this.byChannel.get(channel) ?? null;
  }

  getById(id: string): TransmissionProvider | null {
    return this.byId.get(id) ?? null;
  }

  /** All registered providers (deduplicated by id). */
  allProviders(): TransmissionProvider[] {
    return Array.from(this.byId.values());
  }

  /** Exact provider id wins over the generic channel default (e.g. 'ksef' vs GOV_PORTAL_API). */
  resolve(spec: ChannelSpec): TransmissionProvider | null {
    if (spec.providerId) {
      const byId = this.byId.get(spec.providerId);
      if (byId) return byId;
    }
    return this.byChannel.get(spec.type) ?? null;
  }

  async transmitAll(
    artifacts: SignedArtifact[],
    ctx: TransactionContext,
    plan: CompliancePlan,
    idempotencyKeyBase: string,
    log: ComplianceLogger = defaultLogger,
  ): Promise<TransmissionResult[]> {
    const results: TransmissionResult[] = [];
    for (let i = 0; i < plan.channels.length; i++) {
      const spec = plan.channels[i];
      const provider = this.resolve(spec);
      if (!provider) {
        log.warn('transmission', `no provider for channel ${spec.type}${spec.providerId ? `/${spec.providerId}` : ''}`);
        results.push({ channel: spec.type, status: 'SKIPPED', notes: ['no provider'] });
        continue;
      }

      // Resolve credentials when the provider declares a configSchema and the ctx carries a company id.
      let resolvedConfig: ResolvedChannelConfig | undefined;
      if (provider.configSchema && this.credentials && ctx.supplierCompanyId) {
        const providerId = spec.providerId ?? provider.id;
        const resolved = await this.credentials.resolveActive(ctx.supplierCompanyId, providerId);
        if (!resolved || !resolved.isActive) {
          log.info('transmission', `channel not configured for company (${providerId}) — skipping`);
          results.push({ channel: spec.type, status: 'SKIPPED', notes: [`channel ${providerId} not configured for company`] });
          continue;
        }
        resolvedConfig = resolved;
      }

      results.push(await provider.transmit(artifacts, ctx, plan, `${idempotencyKeyBase}:${provider.id}:${i}`, log, resolvedConfig));
    }
    return results;
  }
}

export const defaultTransmissionRegistry = new TransmissionProviderRegistry();
