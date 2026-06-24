import { TransactionContext } from '../../canonical/canonical-document';
import { CompliancePlan } from '../../engine/compliance-engine';
import { ComplianceLogger, defaultLogger } from '../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../execution/types';
import { ChannelSpec } from '../../profiles/schema';
import { ChannelType } from '../../types';
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

  constructor(providers?: TransmissionProvider[]) {
    const list = providers ?? [
      new EmailTransmissionProvider(),
      new PeppolTransmissionProvider(),
      new PdpTransmissionProvider(),
      new PacTransmissionProvider(),
      new SdiTransmissionProvider(),
      new GovPortalTransmissionProvider(),
      new KsefTransmissionProvider(),
      new OseTransmissionProvider(),
      new PrintTransmissionProvider(),
      // Dedicated national portals — selected by ChannelSpec.providerId. Registered AFTER the
      // generics so 'gov-portal' stays the default for a bare GOV_PORTAL_API channel.
      ...NATIONAL_PORTAL_PROVIDERS,
    ];
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

  /** Exact provider id wins over the generic channel default (e.g. 'ksef' vs GOV_PORTAL_API). */
  resolve(spec: ChannelSpec): TransmissionProvider | null {
    if (spec.providerId) {
      const byId = this.byId.get(spec.providerId);
      if (byId) return byId;
    }
    return this.byChannel.get(spec.type) ?? null;
  }

  transmitAll(
    artifacts: SignedArtifact[],
    ctx: TransactionContext,
    plan: CompliancePlan,
    idempotencyKeyBase: string,
    log: ComplianceLogger = defaultLogger,
  ): TransmissionResult[] {
    return plan.channels.map((spec, i) => {
      const provider = this.resolve(spec);
      if (!provider) {
        log.warn('transmission', `no provider for channel ${spec.type}${spec.providerId ? `/${spec.providerId}` : ''}`);
        return { channel: spec.type, status: 'SKIPPED' as const, notes: ['no provider'] };
      }
      return provider.transmit(artifacts, ctx, plan, `${idempotencyKeyBase}:${provider.id}:${i}`, log);
    });
  }
}

export const defaultTransmissionRegistry = new TransmissionProviderRegistry();
