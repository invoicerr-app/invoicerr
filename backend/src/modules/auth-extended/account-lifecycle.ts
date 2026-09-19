/**
 * The account-lifecycle logic behind the "Mon compte" page: changing a user's own email address, and
 * deleting their own account. Pulled out of `lib/auth.ts` — which only ever WIRES these functions into
 * better-auth's `user.changeEmail`/`user.deleteUser` config — for one reason: `lib/auth.ts` cannot be
 * imported under Jest at all (better-auth is ESM-only across nearly every subpath export; see
 * `lib/body-parser-auth-skip.ts`'s own header for the full account), so anything worth unit-testing
 * has to live somewhere Jest CAN load.
 *
 * Every function here takes plain data (`userId`, a mailer with just a `sendMail`) rather than a
 * better-auth `User`/session object, precisely so no test needs to construct one.
 */
import { CompanyRole } from '../../../prisma/generated/prisma/client';
import { mailT } from '@/mail/i18n';
import { MailOptions } from '@/mail/types';
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';
import { syncCompanyMemberOnMembershipChange } from '@/modules/billing/member-sync';
import { resolveUserLanguage } from '@/modules/documents/rendering/language/resolve-user-language';

// ===================== Change email =====================

/**
 * The one non-document system email this module sends — plain subject/html/text, no
 * `MailTemplate`/`{placeholder}` engine (`mail/system-email-templates.ts`): that engine's overrides are
 * keyed by `companyId`, and a user account belongs to no company, so there is nothing for a company to
 * override here. Translated via the shared `mails` catalog (`mail/i18n.ts`) — `language` is resolved by
 * the caller (`lib/auth.ts`, via `resolveUserLanguage(user.locale, ...)`) since this function takes
 * plain data only (see this file's own header on why).
 */
export function buildChangeEmailMail(params: {
  newEmail: string;
  url: string;
  appUrl: string;
  language?: string | null;
}): MailOptions {
  const { newEmail, url, appUrl } = params;
  // No `Company.language` fallback here (unlike `resolveRecipientLanguage`'s three-step chain for a
  // document's recipient) — a user account belongs to no company (see this file's own header), so
  // `resolveUserLanguage`'s second argument has nothing to resolve against.
  const t = mailT(resolveUserLanguage(params.language, undefined));
  return {
    to: newEmail,
    subject: t('changeEmail.subject'),
    text:
      `${t('layout.greeting')}\n\n` +
      `${t('changeEmail.textIntro')}\n\n` +
      `${url}\n\n` +
      `${t('changeEmail.ignoreNotice')}\n\n` +
      `${t('layout.signOffText')}\n\n` +
      `${t('layout.sentFrom').replace('{appUrl}', appUrl)}`,
    html:
      `<h2>${t('changeEmail.subject')}</h2><p>${t('layout.greeting')}</p><p>${t('changeEmail.htmlIntro')}</p>` +
      `<div style="text-align: center; margin: 30px 0;"><a href="${url}" style="background: #007bff; ` +
      'color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; ' +
      `display: inline-block;">${t('changeEmail.buttonLabel')}</a></div>` +
      `<p>${t('changeEmail.ignoreNotice')}</p><p>${t('layout.signOffHtml')}</p><hr>` +
      `<p style="font-size: 12px; color: #666;">${t('layout.sentFrom').replace('{appUrl}', appUrl)}</p>`,
  };
}

/** Narrower than `MailService` on purpose — `lib/auth.ts` hands this a plain `new MailService()`
 *  (the instance mail path, `sendMail`, never the per-company `sendForCompany` cascade: a user account
 *  belongs to no company), and a test hands it a bare jest mock. */
export interface AccountMailer {
  sendMail(options: MailOptions): Promise<unknown>;
}

/** Wired as better-auth's `emailVerification.sendVerificationEmail` (see `lib/auth.ts`'s own comment
 *  on that field for why THIS is the hook that actually fires for `changeEmail`, not a field literally
 *  named `sendChangeEmail*`). Sends to `newEmail` — the address that must be proven reachable before
 *  the change takes effect; the account's email does not change until that link is opened. */
export async function sendChangeEmailMail(
  mailer: AccountMailer,
  params: { newEmail: string; url: string; appUrl: string; language?: string | null },
): Promise<void> {
  await mailer.sendMail(buildChangeEmailMail(params));
  logger.info('Change-email confirmation sent', { category: 'auth', details: { newEmail: params.newEmail } });
}

// ===================== Delete account =====================

/** Named so `lib/auth.ts` (which converts it to a better-auth `APIError`) and tests can assert on it
 *  without string-matching the message. */
export const ACCOUNT_IS_SOLE_OWNER_CODE = 'ACCOUNT_IS_SOLE_OWNER';

export class SoleOwnerError extends Error {
  readonly code = ACCOUNT_IS_SOLE_OWNER_CODE;

  constructor(readonly companyNames: string[]) {
    super(
      `You are the only owner of ${companyNames.join(', ')}. Transfer ownership to another member, ` +
        `or delete ${companyNames.length > 1 ? 'those companies' : 'that company'}, before deleting ` +
        'your account.',
    );
    this.name = 'SoleOwnerError';
  }
}

export interface AccountMembership {
  companyId: string;
  companyName: string;
  role: CompanyRole;
}

async function listAccountMemberships(userId: string): Promise<AccountMembership[]> {
  const rows = await prisma.userCompany.findMany({
    where: { userId },
    select: { companyId: true, role: true, company: { select: { name: true } } },
  });
  return rows.map((row) => ({ companyId: row.companyId, companyName: row.company.name, role: row.role }));
}

/**
 * better-auth's `deleteUser.beforeDelete` — throwing here is what better-auth's own docs call out as
 * the way to interrupt deletion (`@better-auth/core`'s bundled type declarations, the only
 * documentation this dependency ships for that hook: "to interrupt with error you can throw
 * `APIError`"), which is why this throws a plain, better-auth-independent `SoleOwnerError` rather
 * than an `APIError` itself — `lib/
 * auth.ts` is the one place allowed to import `better-auth`'s error type, so the translation happens
 * there, one line, and this function stays importable under Jest.
 *
 * Mirrors `companies.service.ts#assertNotLastOwner`'s own "is there another OWNER of this company"
 * query — deliberately re-checked here rather than shared, since that one is scoped to a SINGLE company
 * a caller already has active, while this one has to walk every company the ACCOUNT belongs to.
 *
 * Returns the membership list on success — `lib/auth.ts` stashes it (see that file's own comment) so
 * `cleanupAfterUserDelete` below, called from `afterDelete`, knows which companies to seat-sync without
 * re-querying rows the DB's own cascade will already have removed by then.
 */
export async function assertNotSoleOwner(userId: string): Promise<AccountMembership[]> {
  const memberships = await listAccountMemberships(userId);

  const soleOwnerOf: string[] = [];
  for (const membership of memberships) {
    if (membership.role !== CompanyRole.OWNER) continue;
    const anotherOwner = await prisma.userCompany.count({
      where: { companyId: membership.companyId, role: CompanyRole.OWNER, userId: { not: userId } },
    });
    if (anotherOwner === 0) soleOwnerOf.push(membership.companyName);
  }

  if (soleOwnerOf.length > 0) {
    throw new SoleOwnerError(soleOwnerOf);
  }

  return memberships;
}

/** The deleted user's own identity, captured by the caller (`lib/auth.ts`'s `afterDelete` hook still
 *  has better-auth's own in-memory `user` object at this point, even though the DB row is already
 *  gone) — `syncCompanyMemberOnMembershipChange`'s OWN `prisma.user.findUnique` would return nothing
 *  post-cascade, so this function cannot re-derive it from `userId` alone. */
export interface DeletedAccountIdentity {
  id: string;
  email: string;
  name: string | null;
}

/**
 * better-auth's `deleteUser.afterDelete`. By the time this runs, `UserCompany.userId` and
 * `InvitationCode.createdById` have ALREADY cascaded away at the DB level (`ON DELETE CASCADE`,
 * confirmed in `prisma/migrations/20260705120000_add_multi_company_schema/migration.sql` and
 * `.../20251207132152_add_invitation_codes/migration.sql`) — better-auth's own
 * `internalAdapter.deleteUser` issues a real `prisma.user.delete`, which is what fires those
 * constraints. Re-deleting those rows here would be a no-op; what the DB constraint CANNOT do is tell
 * Polar a MEMBER (`billing/member-sync.ts`'s own header) is gone, so that is the one thing left for
 * this function — the same call `companies.service.ts#removeMember` makes when a single membership is
 * removed. No seat-sync call here any more (`billing/seat-sync.ts`'s own header): the deleted user's
 * desk (`UserCompany.seatIndex`) went with their row via the cascade
 * above, and the bought seat QUANTITY is Polar's own number now, never something a membership change
 * writes back to it.
 */
export async function cleanupAfterUserDelete(
  memberships: AccountMembership[],
  deletedUser: DeletedAccountIdentity,
): Promise<void> {
  for (const membership of memberships) {
    // `member-sync.ts`'s own `prisma.user.findUnique` would find nothing post-cascade — passing the
    // identity explicitly is what lets it still resolve the departed member by EMAIL (its fallback
    // lookup) when it was never backfilled with our own externalId in the first place.
    await syncCompanyMemberOnMembershipChange(membership.companyId, deletedUser.id, undefined, deletedUser);
  }
  logger.info('Account deleted — memberships cascaded, Polar member access resynced', {
    category: 'auth',
    details: { companyIds: memberships.map((m) => m.companyId) },
  });
}
