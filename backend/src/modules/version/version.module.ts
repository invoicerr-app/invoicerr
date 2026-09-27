import { Module } from '@nestjs/common';

import { FakeGithubReleaseClient } from './fake-github-release-client';
import { GithubReleaseClientPort, RealGithubReleaseClient } from './github-release-client';
import { VersionController } from './version.controller';
import { VersionService } from './version.service';

/**
 * `GITHUB_RELEASES_FAKE=1` (set only in `backend/.env.test`) swaps in the network-free fake — the
 * exact same factory-provider shape `clients.module.ts#vatValidationClient` already holds for
 * `VAT_VALIDATION_FAKE=1`. See `fake-github-release-client.ts`'s own header for why this exists.
 */
function githubReleaseClient(): GithubReleaseClientPort {
  if (process.env.GITHUB_RELEASES_FAKE === '1') return new FakeGithubReleaseClient();
  return new RealGithubReleaseClient();
}

/**
 * `GET /api/version` — issue #371. A single, stateless, always-present module: unlike
 * `BillingModule`/`BackupModule` there is no flag gating whether this even enters the graph, because
 * the feature is itself always safe to expose (see `version.service.ts`'s own header) — only the
 * OUTBOUND GitHub call it makes has an opt-out (`DISABLE_UPDATE_CHECK`, checked inside the service).
 */
@Module({
  controllers: [VersionController],
  providers: [VersionService, { provide: 'GITHUB_RELEASE_CLIENT', useFactory: githubReleaseClient }],
})
export class VersionModule {}
