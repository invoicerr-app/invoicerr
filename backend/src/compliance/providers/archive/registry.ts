import { ArchivalPolicy } from '../../profiles/schema';
import { ComplianceLogger, defaultLogger } from '../../execution/logger';
import { ArchiveReceipt, SignedArtifact } from '../../execution/types';
import { ArchiveProvider } from './archive-provider';
import { LocalArchiveProvider, WormS3ArchiveProvider } from './providers';

export class ArchiveProviderRegistry {
  private readonly providers: ArchiveProvider[];

  constructor(providers?: ArchiveProvider[]) {
    this.providers = providers ?? [new WormS3ArchiveProvider(), new LocalArchiveProvider()];
  }

  /** Pick a provider whose regions satisfy the residency requirement (else the default). */
  select(policy: ArchivalPolicy): ArchiveProvider {
    if (policy.residency) {
      const regional = this.providers.find((p) => p.regions.includes(policy.residency!));
      if (regional) return regional;
    }
    return this.providers[0];
  }

  store(
    artifacts: SignedArtifact[],
    policy: ArchivalPolicy,
    log: ComplianceLogger = defaultLogger,
  ): ArchiveReceipt {
    return this.select(policy).store(artifacts, policy, log);
  }
}

export const defaultArchiveRegistry = new ArchiveProviderRegistry();
