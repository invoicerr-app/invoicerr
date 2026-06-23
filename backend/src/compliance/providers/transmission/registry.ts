import { TransactionContext } from '../../canonical/canonical-document';
import { CompliancePlan } from '../../engine/compliance-engine';
import { ComplianceLogger, defaultLogger } from '../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../execution/types';
import { ChannelType } from '../../types';
import { TransmissionProvider } from './transmission-provider';
import {
  EmailTransmissionProvider,
  GovPortalTransmissionProvider,
  OseTransmissionProvider,
  PacTransmissionProvider,
  PdpTransmissionProvider,
  PeppolTransmissionProvider,
  PrintTransmissionProvider,
  SdiTransmissionProvider,
} from './providers';

export class TransmissionProviderRegistry {
  private readonly byChannel = new Map<ChannelType, TransmissionProvider>();

  constructor(providers?: TransmissionProvider[]) {
    const list = providers ?? [
      new EmailTransmissionProvider(),
      new PeppolTransmissionProvider(),
      new PdpTransmissionProvider(),
      new PacTransmissionProvider(),
      new SdiTransmissionProvider(),
      new GovPortalTransmissionProvider(),
      new OseTransmissionProvider(),
      new PrintTransmissionProvider(),
    ];
    for (const p of list) this.byChannel.set(p.channel, p);
  }

  get(channel: ChannelType): TransmissionProvider | null {
    return this.byChannel.get(channel) ?? null;
  }

  /** Transmit over every channel in the plan (ordered; each is attempted with an idempotency key). */
  transmitAll(
    artifacts: SignedArtifact[],
    ctx: TransactionContext,
    plan: CompliancePlan,
    idempotencyKeyBase: string,
    log: ComplianceLogger = defaultLogger,
  ): TransmissionResult[] {
    return plan.channels.map((c, i) => {
      const provider = this.get(c.type);
      if (!provider) {
        log.warn('transmission', `no provider for channel ${c.type}`);
        return { channel: c.type, status: 'SKIPPED' as const, notes: ['no provider'] };
      }
      return provider.transmit(artifacts, ctx, plan, `${idempotencyKeyBase}:${c.type}:${i}`, log);
    });
  }
}

export const defaultTransmissionRegistry = new TransmissionProviderRegistry();
