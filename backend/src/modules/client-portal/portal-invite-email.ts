import { escapeHtml } from '@/mail/escape-html';
import { mailT } from '@/mail/i18n';
import { RenderLanguage } from '@/modules/documents/rendering/language/supported-languages';

/**
 * The portal invite email's own copy — a plain, fixed template, deliberately NOT run through the
 * company-overridable engine `mail/system-email-templates.ts` gives `SIGNATURE_REQUEST`/
 * `VERIFICATION_CODE`: that engine is backed by a `MailTemplateType` enum value per family, and adding
 * one is a schema/migration change this feature does not need to justify for a single, sober,
 * non-legal notification email. A company that wants different wording here is a real, but
 * deliberately deferred, follow-up — see this module's own `client-portal.module.ts` header.
 *
 * Kept as a pure function (no Nest, no Prisma) purely for the same reason
 * `actions/email-template.ts#buildSignatureRequestEmailParts` is: a unit test can build one without
 * constructing anything.
 *
 * Multilingual since the client-facing-mail pass (step 4 of the multilingual-mail plan): this reaches
 * a CLIENT, not a member of the issuing company, so it goes through the SAME `mails` i18next catalog
 * (`mail/i18n.ts`) every other client-facing mail now does — `language` is the CALLER's job to resolve
 * (`portal-tokens.service.ts#create`, against the invited client's own `Client.language` and its
 * company's `Company.language`, via `resolveRecipientLanguage`), this function stays pure and never
 * decides that itself. Defaults to `DEFAULT_RENDER_LANGUAGE` ('en') via `mailT`'s own fallback when
 * omitted or unsupported — see that function's own header.
 */
export interface PortalInviteEmailParts {
  subject: string;
  text: string;
  html: string;
}

export function buildPortalInviteEmail(input: {
  companyName: string;
  portalUrl: string;
  language?: RenderLanguage;
}): PortalInviteEmailParts {
  const { companyName, portalUrl, language } = input;
  const t = mailT(language);

  const subject = t('portalInvite.subject').replaceAll('{companyName}', companyName);
  // `companyName` is typed by the INVITING company's own staff and reaches a DIFFERENT party's
  // inbox (the client) — the same "escape a third-party value for html, never for text" split
  // `mail/system-email-templates.ts`'s own ownership-transfer emails already hold (that file's own
  // header, "Why attacker-controlled values are NEVER run through i18next's own `{{var}}`
  // interpolation") applies here too, for the identical reason.
  const introText = t('portalInvite.introText').replaceAll('{companyName}', companyName);
  const introHtml = t('portalInvite.introText').replaceAll('{companyName}', escapeHtml(companyName));
  const signOffText = t('portalInvite.signOffText').replaceAll('{companyName}', companyName);
  const signOffHtml = t('portalInvite.signOffHtml').replaceAll('{companyName}', escapeHtml(companyName));

  return {
    subject,
    text:
      `${t('layout.greeting')}\n\n` +
      `${introText}\n\n` +
      `${t('portalInvite.openPortalIntro')}\n${portalUrl}\n\n` +
      `${t('portalInvite.privacyNotice')}\n\n` +
      signOffText,
    html:
      `<p>${t('layout.greeting')}</p><p>${introHtml}</p>` +
      `<p style="text-align: center; margin: 30px 0;"><a href="${portalUrl}" style="background: ` +
      `#007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; ` +
      `display: inline-block;">${t('portalInvite.buttonLabel')}</a></p>` +
      `<p style="font-size: 12px; color: #666;">${t('portalInvite.privacyNotice')}</p><p>${signOffHtml}</p>`,
  };
}
