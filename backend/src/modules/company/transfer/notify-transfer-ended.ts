/**
 * The "this transfer ended without completing" mail to the INITIATING owner, built and sent the same
 * way whether the row expired (`expire-transfer.ts`) or that owner canceled it
 * (`transfer.service.ts#cancelTransfer`). Throws whatever the reads or the send throw: each caller
 * wraps it in its own try/catch and logs its own warning, because the transition it just wrote is
 * the source of truth and a failed notice must never undo it.
 *
 * Also home to the reads and the send every mail of this module that goes to an existing account
 * shares (`loadMailTargets`, `sendTransferMail`), so the finalize mails of
 * `transfer.service.ts#acceptTransfer` resolve their recipients exactly the same way.
 */
import { appOrigin } from '@/utils/app-origin';
import { MailService } from '@/mail/mail.service';
import { buildOwnershipTransferEndedEmail } from '@/mail/system-email-templates';
import { resolveUserLanguage } from '@/modules/documents/rendering/language/resolve-user-language';
import { RenderLanguage } from '@/modules/documents/rendering/language/supported-languages';
import prisma from '@/prisma/prisma.service';

import { CompanyOwnershipTransfer } from '../../../../prisma/generated/prisma/client';

/** One recipient of a transfer mail: their address and the language their mail is written in. */
export interface TransferMailRecipient {
  email: string;
  language: RenderLanguage;
}

/**
 * Reads the company, then each user in the order given, and resolves each user's language (their own
 * preference, falling back to the company's: the same chain every other mail of this module resolves
 * through). All or nothing: `null` when the company or ANY of the users no longer exists, so a caller
 * that mails several people never sends one mail out of two.
 */
export async function loadMailTargets(
  companyId: string,
  userIds: string[],
): Promise<{ companyName: string; recipients: TransferMailRecipient[] } | null> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { name: true, language: true },
  });
  const users: ({ email: string; locale: string | null } | null)[] = [];
  for (const userId of userIds) {
    users.push(
      await prisma.user.findUnique({ where: { id: userId }, select: { email: true, locale: true } }),
    );
  }
  if (!company) return null;
  const recipients: TransferMailRecipient[] = [];
  for (const user of users) {
    if (!user) return null;
    recipients.push({ email: user.email, language: resolveUserLanguage(user.locale, company.language) });
  }
  return { companyName: company.name, recipients };
}

/** Sends one built transfer mail through the company's own mail provider. */
export async function sendTransferMail(
  mailService: MailService,
  companyId: string,
  to: string,
  email: { subject: string; text: string; html: string },
): Promise<void> {
  await mailService.sendForCompany(companyId, {
    to,
    subject: email.subject,
    text: email.text,
    html: email.html,
  });
}

/** Sends nothing when the company or the initiating user no longer exists. */
export async function notifyTransferEnded(
  mailService: MailService,
  transfer: Pick<CompanyOwnershipTransfer, 'companyId' | 'fromUserId' | 'toEmail'>,
  reason: 'expired' | 'canceled',
): Promise<void> {
  const targets = await loadMailTargets(transfer.companyId, [transfer.fromUserId]);
  if (!targets) return;
  const [fromUser] = targets.recipients;

  const email = buildOwnershipTransferEndedEmail({
    appUrl: appOrigin(),
    companyName: targets.companyName,
    toEmail: transfer.toEmail,
    reason,
    // The initiating owner's own preference, falling back to their company's (for a cancel, it is
    // that owner's own receipt).
    language: fromUser.language,
  });
  await sendTransferMail(mailService, transfer.companyId, fromUser.email, email);
}
