/**
 * Runs `detectAndRecordNewLegalReleases` on EVERY backend boot, self-hosted included — registered as
 * a provider on `legal.module.ts`, the module already always imported into `AppModule`
 * (`LegalController`/`LegalService`'s own reasons for that apply here too: this history has to exist
 * on every instance regardless of the billing flag). Modeled on
 * `modules/documents/country-policy/boot-reseed.service.ts`'s own `OnModuleInit` shape: NEVER throws,
 * a transient DB hiccup here must not crash the whole app.
 *
 * The email step (`notifyUsersOfLegalReleases`, SaaS mode only) is DELIBERATELY NOT awaited: it can
 * mean one HTTP/SMTP round-trip per user of the instance, and Nest awaits every `OnModuleInit` before
 * the app finishes bootstrapping — awaiting it here would tie "how fast this app starts" to "how many
 * users the busiest instance has", which no other boot step in this codebase accepts (see
 * `billing-lifecycle-sweep-runner.ts` for the closest precedent, itself a QUEUE tick, never boot
 * itself). Fired with its own `.catch` and its own completion log line instead.
 *
 * CROSS-REPLICA MUTUAL EXCLUSION: the pass is now wrapped in `withLegalReleaseNotifyLock`
 * (`legal-release-lock.ts`) so at most ONE replica of a rolling deploy actually runs it at a time — see
 * that file's own header for the full guarantee (still at-least-once per user, same as always; the
 * lock removes the DUPLICATE sends a rolling deploy used to guarantee, not the retry-on-failure
 * behaviour that guarantee depends on). Every OTHER replica's own attempt around the same boot simply
 * observes the lock held and skips — it does NOT retry in a loop waiting for it, because
 * `notifyUsersOfLegalReleases` itself already re-derives "what changed, who still needs telling" from
 * the database on every call, so the NEXT replica that boots (or, for a single long-lived replica,
 * never — there is no periodic re-check outside boot) picks up anything still pending once the lock is
 * free again.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { isBillingEnabled } from '../modules/billing/billing-flag';
import { MailService } from '@/mail/mail.service';
import { LegalReleaseDetectionSummary, detectAndRecordNewLegalReleases } from './legal-release-detection';
import { createLegalReleaseLockRedisClient, withLegalReleaseNotifyLock } from './legal-release-lock';
import { notifyUsersOfLegalReleases } from './legal-release-notify';

@Injectable()
export class LegalReleaseBootService implements OnModuleInit {
  private readonly logger = new Logger(LegalReleaseBootService.name);

  constructor(private readonly mailService: MailService) {}

  async onModuleInit(): Promise<void> {
    const summary = await this.detectReleases();
    if (!summary) return;

    if (summary.bootstrapped.length > 0) {
      this.logger.log(
        `Legal document release history bootstrapped for: ${summary.bootstrapped
          .map((d) => d.slug)
          .join(', ')} (no notification sent — nothing changed from a user's point of view).`,
      );
    }

    if (summary.changed.length === 0) {
      this.logger.log('Legal documents already match their last recorded release — nothing to do.');
      return;
    }

    this.logger.warn(
      `Legal document(s) changed since their last recorded release: ${summary.changed
        .map((d) => d.slug)
        .join(', ')}.`,
    );

    if (!isBillingEnabled()) {
      this.logger.log('Self-hosted instance — release recorded, no notification email sent.');
      return;
    }

    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    // Deliberately not awaited — see this file's own header. The Redis client backing the lock is
    // opened here and quit once this ONE pass settles — this is a single boot-time cycle, not a
    // connection this service needs to hold open for the rest of the process's life.
    const lockClient = createLegalReleaseLockRedisClient();
    void withLegalReleaseNotifyLock(lockClient, () => notifyUsersOfLegalReleases(this.mailService, appUrl))
      .then((result) => {
        if (!result) {
          this.logger.log(
            'Legal document change notification: skipped — another replica already holds the ' +
              'cluster-wide lock for this pass.',
          );
          return;
        }
        this.logger.log(
          `Legal document change notification: ${result.releasesProcessed} release(s) processed, ` +
            `${result.usersNotified} user(s) emailed, ${result.usersFailed} failed (retried next boot).`,
        );
      })
      .catch((error) => {
        this.logger.error('Legal document change notification pass failed outright — retried next boot', {
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        lockClient.disconnect();
      });
  }

  private async detectReleases(): Promise<LegalReleaseDetectionSummary | undefined> {
    try {
      return await detectAndRecordNewLegalReleases();
    } catch (error) {
      this.logger.error('Failed to detect/record legal document releases at boot — retried next boot', {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }
}
