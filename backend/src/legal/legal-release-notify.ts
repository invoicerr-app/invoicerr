/**
 * Mails every user of the instance "our legal documents have changed" for every slug whose recorded
 * release history has moved past a bootstrap (more than one `LegalDocumentRelease` row — see
 * `legal-release-detection.ts`'s own header on why the very first recorded release for a slug never
 * counts here). SaaS mode only (`isBillingEnabled()`, checked by the caller,
 * `legal-release-boot.service.ts`) — a self-hosted instance still records releases, it just never
 * reaches this function.
 *
 * Runs on EVERY boot, not only the one that first detected a change: idempotent per
 * `(userId, slug, contentHash)` via `LegalDocumentReleaseNotification`, and the notification row is
 * only written AFTER a successful send — so a user a previous boot failed to reach (a transient mail
 * provider outage) is picked up again here, for free, without this module needing any memory of "was
 * this the boot that found the change". Sent in small batches, concurrently within a batch, rather
 * than one giant `Promise.all` over every user at once, since a burst against the configured mail
 * provider (SMTP or Resend) is an avoidable spike this can absorb without a queue.
 */
import { MailService } from '@/mail/mail.service';
import { buildLegalDocumentChangedEmail } from '@/mail/system-email-templates';
import prisma from '@/prisma/prisma.service';
import { LegalDocument, listLegalDocuments } from './legal-documents';

const BATCH_SIZE = 25;

export interface LegalReleaseNotifySummary {
  /** Legal documents actually processed (i.e. past their bootstrap release) this pass. */
  releasesProcessed: number;
  /** (user, release) pairs actually mailed and recorded this pass. */
  usersNotified: number;
  /** (user, release) pairs whose mail send failed — never recorded, so the next boot retries them. */
  usersFailed: number;
}

export async function notifyUsersOfLegalReleases(
  mailService: MailService,
  appUrl: string,
): Promise<LegalReleaseNotifySummary> {
  const summary: LegalReleaseNotifySummary = { releasesProcessed: 0, usersNotified: 0, usersFailed: 0 };

  for (const doc of listLegalDocuments()) {
    const releaseCount = await prisma.legalDocumentRelease.count({ where: { slug: doc.slug } });
    // 0: detection hasn't recorded this slug yet (should not normally happen — retried next boot).
    // 1: only ever a bootstrap release — nothing has actually changed for a user yet.
    if (releaseCount <= 1) continue;

    summary.releasesProcessed++;
    await notifyUsersOfOneRelease(doc, mailService, appUrl, summary);
  }

  return summary;
}

async function notifyUsersOfOneRelease(
  doc: LegalDocument,
  mailService: MailService,
  appUrl: string,
  summary: LegalReleaseNotifySummary,
): Promise<void> {
  const email = buildLegalDocumentChangedEmail({
    appUrl,
    documentTitle: doc.title,
    version: doc.version,
    slug: doc.slug,
  });

  const users = await prisma.user.findMany({ select: { id: true, email: true } });

  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (user) => {
        const alreadyNotified = await prisma.legalDocumentReleaseNotification.findUnique({
          where: {
            userId_slug_contentHash: { userId: user.id, slug: doc.slug, contentHash: doc.contentHash },
          },
        });
        if (alreadyNotified) return;

        try {
          await mailService.sendMail({
            to: user.email,
            subject: email.subject,
            text: email.text,
            html: email.html,
          });
        } catch {
          summary.usersFailed++;
          return; // never recorded — the next boot's pass retries this exact user/release.
        }

        await prisma.legalDocumentReleaseNotification.create({
          data: { userId: user.id, slug: doc.slug, contentHash: doc.contentHash },
        });
        summary.usersNotified++;
      }),
    );
  }
}
