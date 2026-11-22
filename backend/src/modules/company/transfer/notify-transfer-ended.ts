/**
 * The "this transfer ended without completing" mail to the INITIATING owner, built and sent the same
 * way whether the row expired (`expire-transfer.ts`) or that owner canceled it
 * (`transfer.service.ts#cancelTransfer`). Throws whatever the reads or the send throw: each caller
 * wraps it in its own try/catch and logs its own warning, because the transition it just wrote is
 * the source of truth and a failed notice must never undo it.
 */
import { MailService } from '@/mail/mail.service';
import { buildOwnershipTransferEndedEmail } from '@/mail/system-email-templates';
import { resolveUserLanguage } from '@/modules/documents/rendering/language/resolve-user-language';
import prisma from '@/prisma/prisma.service';

import { CompanyOwnershipTransfer } from '../../../../prisma/generated/prisma/client';

/** Sends nothing when the company or the initiating user no longer exists. */
export async function notifyTransferEnded(
  mailService: MailService,
  transfer: Pick<CompanyOwnershipTransfer, 'companyId' | 'fromUserId' | 'toEmail'>,
  reason: 'expired' | 'canceled',
  appUrl: string,
): Promise<void> {
  const company = await prisma.company.findUnique({
    where: { id: transfer.companyId },
    select: { name: true, language: true },
  });
  const fromUser = await prisma.user.findUnique({
    where: { id: transfer.fromUserId },
    select: { email: true, locale: true },
  });
  if (!company || !fromUser) return;

  const email = buildOwnershipTransferEndedEmail({
    appUrl,
    companyName: company.name,
    toEmail: transfer.toEmail,
    reason,
    // The initiating owner's own preference, falling back to their company's: the same chain every
    // other mail of this module resolves through (for a cancel, it is that owner's own receipt).
    language: resolveUserLanguage(fromUser.locale, company.language),
  });
  await mailService.sendForCompany(transfer.companyId, {
    to: fromUser.email,
    subject: email.subject,
    text: email.text,
    html: email.html,
  });
}
