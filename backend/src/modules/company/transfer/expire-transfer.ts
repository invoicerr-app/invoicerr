/**
 * The ONE "move a PENDING transfer to EXPIRED and tell the initiating owner" step — shared by the
 * sweep (`transfer-expiry-sweep-runner.ts`, the normal path) and `transfer.service.ts#acceptTransfer`
 * (a defensive, lazy path: a recipient clicking Accept on a row the sweep has not yet reached this
 * tick must still see "expired", never a false ACCEPTED on a row whose own window already lapsed).
 * Both callers get the identical transition and the identical mail, so there is exactly one place that
 * decides what "expired" means for this feature.
 */
import { logger } from '@/logger/logger.service';
import { MailService } from '@/mail/mail.service';
import { buildOwnershipTransferEndedEmail } from '@/mail/system-email-templates';
import prisma from '@/prisma/prisma.service';

import { CompanyOwnershipTransfer } from '../../../../prisma/generated/prisma/client';

/**
 * Guarded on `status: 'PENDING'` — a concurrent accept or cancel may have already moved this exact
 * row past PENDING between the caller's own read and this call; in that case `count` comes back `0`
 * and this function sends no mail (the row's real fate was decided by whichever write actually won).
 * Returns whether THIS call is the one that made the row EXPIRED.
 */
export async function expireOwnershipTransfer(
  transfer: Pick<CompanyOwnershipTransfer, 'id' | 'companyId' | 'fromUserId' | 'toEmail'>,
  mailService: MailService,
  appUrl: string = process.env.APP_URL || 'http://localhost:3000',
): Promise<boolean> {
  const { count } = await prisma.companyOwnershipTransfer.updateMany({
    where: { id: transfer.id, status: 'PENDING' },
    data: { status: 'EXPIRED' },
  });
  if (count === 0) return false;

  try {
    const company = await prisma.company.findUnique({
      where: { id: transfer.companyId },
      select: { name: true },
    });
    const fromUser = await prisma.user.findUnique({
      where: { id: transfer.fromUserId },
      select: { email: true },
    });
    if (company && fromUser) {
      const email = buildOwnershipTransferEndedEmail({
        appUrl,
        companyName: company.name,
        toEmail: transfer.toEmail,
        reason: 'expired',
      });
      await mailService.sendForCompany(transfer.companyId, {
        to: fromUser.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
      });
    }
  } catch (error) {
    // Never lets a mail-send hiccup undo (or retry-loop) the transition itself — the row is already
    // EXPIRED, same "the state change is the source of truth, a failed notice is merely logged" posture
    // every sweep in this codebase already holds (e.g. `billing-lifecycle-sweep-runner.ts`'s own
    // `zipFailed` counter is the one deliberate exception, because THAT mail carries irreplaceable data).
    logger.warn('Failed to notify the owner of an expired ownership transfer', {
      category: 'company-transfer',
      companyId: transfer.companyId,
      details: { transferId: transfer.id, error: error instanceof Error ? error.message : String(error) },
    });
  }

  return true;
}
