import { CompanyMailResendSettings, CompanyMailSmtpSettings } from './company-mail-settings.types';

/** Request body for `PUT /api/company/mail-settings` — same shape as the stored config
 *  (`CompanyMailSettings`), re-exported under its own DTO name for the controller/Swagger surface, the
 *  same "one shape, two names" convention `SmtpOverrides` already holds between the credential store
 *  and the wire-level transport override. */
export type SetCompanyMailSettingsDto = CompanyMailSmtpSettings | CompanyMailResendSettings;

/**
 * Request body for `PUT /api/company/mail-settings/reply-to` — its own tiny endpoint, deliberately
 * NOT folded into `SetCompanyMailSettingsDto` above: that PUT requires a full SMTP/Resend config and
 * REPLACES it wholesale, while a company's Reply-To override is independent of whether it has a mail
 * server override at all (see `Company.mailReplyTo`'s own schema.prisma comment). `null` (or omitted)
 * clears the override back to "use the instance's own MAIL_REPLY_TO" — same "null clears, never an
 * empty string" convention `billing-email.ts#setCompanyBillingEmail` already holds for `billingEmail`.
 */
export interface SetCompanyMailReplyToDto {
  replyTo: string | null;
}
