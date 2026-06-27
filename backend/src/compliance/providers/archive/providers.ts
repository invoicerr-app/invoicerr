import { ArchivalPolicy } from '../../profiles/schema';
import { ComplianceLogger } from '../../execution/logger';
import { ArchiveReceipt, SignedArtifact } from '../../execution/types';
import { ArchiveProvider } from './archive-provider';

function retentionUntil(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString();
}

/** WORM object storage with regional buckets for data-residency jurisdictions (MX, BR, SA…). */
export class WormS3ArchiveProvider implements ArchiveProvider {
  readonly id = 's3-worm';
  readonly regions = ['MX', 'BR', 'SA', 'EU', 'GLOBAL'];
  store(artifacts: SignedArtifact[], policy: ArchivalPolicy, log: ComplianceLogger): ArchiveReceipt {
    const region = policy.residency ?? 'GLOBAL';
    log.todo('archive/s3-worm', `PUT ${artifacts.length} artifact(s) to WORM bucket [${region}], retain ${policy.retentionYears}y, integrity ${policy.integrity}`);
    return {
      providerId: this.id,
      region,
      uri: `s3://compliance-archive-${region.toLowerCase()}/stub`,
      retentionUntil: retentionUntil(policy.retentionYears),
      contentHash: 'stub-sha256',
    };
  }
}

/** Local filesystem archive (default / dev). */
export class LocalArchiveProvider implements ArchiveProvider {
  readonly id = 'local';
  readonly regions = ['GLOBAL'];
  store(artifacts: SignedArtifact[], policy: ArchivalPolicy, log: ComplianceLogger): ArchiveReceipt {
    log.todo('archive/local', `write ${artifacts.length} artifact(s) to local storage, retain ${policy.retentionYears}y`);
    return {
      providerId: this.id,
      region: 'GLOBAL',
      uri: 'file:///var/compliance-archive/stub',
      retentionUntil: retentionUntil(policy.retentionYears),
      contentHash: 'stub-sha256',
    };
  }
}
