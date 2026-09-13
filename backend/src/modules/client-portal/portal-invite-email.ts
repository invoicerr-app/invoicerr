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
 */
export interface PortalInviteEmailParts {
  subject: string;
  text: string;
  html: string;
}

export function buildPortalInviteEmail(input: {
  companyName: string;
  portalUrl: string;
}): PortalInviteEmailParts {
  const { companyName, portalUrl } = input;
  return {
    subject: `${companyName} — access your client portal`,
    text:
      `Hello,\n\n` +
      `${companyName} has invited you to their client portal, where you can review your invoices, ` +
      `quotes and account balance, and respond to any quote awaiting your decision.\n\n` +
      `Open your portal:\n${portalUrl}\n\n` +
      `Keep this link private — anyone who has it can view your account.\n\n` +
      `Best regards,\n${companyName}`,
    html:
      `<p>Hello,</p><p>${companyName} has invited you to their client portal, where you can review ` +
      `your invoices, quotes and account balance, and respond to any quote awaiting your decision.</p>` +
      `<p style="text-align: center; margin: 30px 0;"><a href="${portalUrl}" style="background: ` +
      `#007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; ` +
      `display: inline-block;">Open your portal</a></p>` +
      `<p style="font-size: 12px; color: #666;">Keep this link private — anyone who has it can view ` +
      `your account.</p><p>Best regards,<br>${companyName}</p>`,
  };
}
