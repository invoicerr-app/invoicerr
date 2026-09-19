import { CompanyMailResendSettings, CompanyMailSmtpSettings } from './company-mail-settings.types';

/** Request body for `PUT /api/company/mail-settings` — same shape as the stored config
 *  (`CompanyMailSettings`), re-exported under its own DTO name for the controller/Swagger surface, the
 *  same "one shape, two names" convention `SmtpOverrides` already holds between the credential store
 *  and the wire-level transport override. */
export type SetCompanyMailSettingsDto = CompanyMailSmtpSettings | CompanyMailResendSettings;
