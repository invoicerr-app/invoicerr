/**
 * The READ side of a company's own mail-server override, split into its own file — deliberately with
 * NO import of `MailService` — so `mail/mail.service.ts` can call `resolveCompanyMailSettings`
 * directly, at send time, without creating a `mail/` ⇄ `modules/company/` circular module import
 * (`company-mail-settings.service.ts`, the Nest-injectable sibling in this same directory, DOES import
 * `MailService` for its own `sendTest` — that import only ever runs in the other direction).
 *
 * Exported as a bare async function rather than a class method: `ChannelCredentialsService` itself
 * needs no injected dependency of its own (see its own header — a plain no-arg constructor), so `new`
 * here is exactly as safe as Nest's own instantiation, with none of the DI-wiring blast radius that
 * giving `MailService` a hard constructor dependency on a `modules/company/**` provider would carry
 * across every module that already provides a bare `MailService` today (plugins/danger/client-portal/
 * documents-core/the queue worker — see `mail.service.ts`'s own git history for why that path was not
 * taken).
 */
import { logger } from '@/logger/logger.service';
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import { CompanyMailSettings, isCompanyMailSettings } from './company-mail-settings.types';

/** `providerId`/`channel` this feature stores under in `CompanyChannelConfig` — see
 *  `company-mail-settings.types.ts`'s own header for why that table, not a new one. */
export const MAIL_SETTINGS_PROVIDER_ID = 'mail';

/** A mail server has no sandbox/production split the way a national transport does (there is exactly
 *  one "this company's own mail server", never a TEST one kept alongside a PROD one) — always written
 *  and read under this fixed environment rather than exposing the TEST/PROD choice to this feature's
 *  own settings screen. */
export const MAIL_SETTINGS_ENVIRONMENT = 'PROD';

/**
 * Resolves this company's OWN mail server config (SMTP or Resend), decrypted. `null` when unset,
 * inactive, corrupted, or `CREDENTIALS_ENCRYPTION_KEY` itself is unavailable — `resolveActive` already
 * treats every one of those identically as "not connected" (see that method's own header), and a
 * corrupted/mismatched blob (`isCompanyMailSettings` failing) is folded into the same "not configured"
 * outcome rather than thrown — a send must degrade to the instance-level fallback, never crash, on a
 * row some other process wrote in a shape this reader no longer recognizes.
 */
export async function resolveCompanyMailSettings(companyId: string): Promise<CompanyMailSettings | null> {
  const channelCredentials = new ChannelCredentialsService();
  const resolved = await channelCredentials.resolveActive(companyId, MAIL_SETTINGS_PROVIDER_ID);
  if (!resolved) return null;

  if (!isCompanyMailSettings(resolved.config)) {
    logger.error('Company mail settings blob does not match a known shape — treating as unconfigured.', {
      category: 'mail',
      details: { companyId },
    });
    return null;
  }
  return resolved.config;
}
