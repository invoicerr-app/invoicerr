import { ArchivalPolicy } from '../../profiles/schema';
import { ComplianceLogger } from '../../execution/logger';
import { ArchiveReceipt, SignedArtifact } from '../../execution/types';
import { ArchiveProvider } from './archive-provider';
import { computeContentHash, persistArtifacts } from './storage';

function retentionUntil(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString();
}

/**
 * WORM object storage with regional buckets for data-residency jurisdictions (MX, BR, SA…).
 *
 * Honesty note: this environment has no S3 credentials / Object Lock config, so it cannot perform
 * a real WORM PUT (mirrors the ProviderMaturity honesty pattern used by the transmission
 * providers — see transmission-provider.ts). Rather than fabricate an `s3://` URI and a fake hash
 * for bytes that were never actually sent anywhere (the previous stub's failure mode), this falls
 * back to the same durable local persistence LocalArchiveProvider uses: a real, verifiable store —
 * just not (yet) an immutable/regional S3 one — and says so via `log.todo` so operators can tell
 * "archived" from "archived with WORM guarantees" apart. The content hash is always real.
 */
export class WormS3ArchiveProvider implements ArchiveProvider {
  readonly id = 's3-worm';
  readonly regions = ['MX', 'BR', 'SA', 'EU', 'GLOBAL'];
  store(artifacts: SignedArtifact[], policy: ArchivalPolicy, log: ComplianceLogger): ArchiveReceipt {
    const region = policy.residency ?? 'GLOBAL';
    const contentHash = computeContentHash(artifacts);
    log.todo(
      'archive/s3-worm',
      `no S3 credentials configured — persisting ${artifacts.length} artifact(s) locally instead of ` +
        `a real WORM PUT [region ${region}], retain ${policy.retentionYears}y, integrity ${policy.integrity}`,
    );
    const dir = persistArtifacts(artifacts, region, contentHash, log, 'archive/s3-worm');
    return {
      providerId: this.id,
      region,
      uri: `file://${dir}`,
      retentionUntil: retentionUntil(policy.retentionYears),
      contentHash,
    };
  }
}

/**
 * Local filesystem archive (default / dev). Root: `COMPLIANCE_ARCHIVE_DIR` env var, defaulting to
 * `<cwd>/.compliance-archive`. Content-hash addressed (see storage.ts) so re-archiving identical
 * artifacts is idempotent — same path, no duplication.
 */
export class LocalArchiveProvider implements ArchiveProvider {
  readonly id = 'local';
  readonly regions = ['GLOBAL'];
  store(artifacts: SignedArtifact[], policy: ArchivalPolicy, log: ComplianceLogger): ArchiveReceipt {
    const contentHash = computeContentHash(artifacts);
    const dir = persistArtifacts(artifacts, 'GLOBAL', contentHash, log, 'archive/local');
    return {
      providerId: this.id,
      region: 'GLOBAL',
      uri: `file://${dir}`,
      retentionUntil: retentionUntil(policy.retentionYears),
      contentHash,
    };
  }
}
