import { MailTemplateType } from '../../prisma/generated/prisma/client';

import {
  buildOtpEmailParts,
  buildSignatureRequestEmailParts,
  DocumentEmailTemplate,
} from '@/modules/documents/actions/email-template';

/**
 * The two emails this application sends that are NOT about a document: the signature request and the
 * verification code. Both run through the SAME engine, the same `{placeholder}` syntax and the same
 * warn-and-pass-through semantics as every document email
 * (`modules/documents/actions/email-template.ts`) — the engine's `DocumentEmailTemplate` shape is
 * reused verbatim here, so "document" in that type name describes where the shape was first written,
 * never a claim that an OTP mail is a document.
 *
 * ## Why the defaults live in CODE
 *
 * They used to be SEEDED — the same HTML duplicated verbatim in two places in
 * `modules/company/company.service.ts` (an upsert fired on every company-info READ, plus a nested
 * create for a brand-new company), which meant the shipped copy existed only as rows in whichever
 * database happened to have been touched, a company whose rows were deleted could no longer send a
 * signature request at all, and improving the wording reached nobody who already had rows.
 *
 * A `MailTemplate` row is now purely an OVERRIDE, exactly like `Company.documentEmailTemplates` is for
 * a document type: absent means "use the shipped default below", never "this feature is unconfigured".
 * That is what lets the seeding disappear, with no migration needed to put rows back, and it is the
 * same precedence `resolveEmailTemplate` already applies for documents — one mental model for both.
 *
 * ## What a row's `body` column holds
 *
 * HTML, always — that column has been rendered as the `html` part since it existed, and the settings
 * screen that writes it is an HTML editor. A row therefore maps to `{ subject, body: '', html: <row
 * body> }`, and the engine DERIVES the text part from that html (`deriveTextFromHtml`): a customised
 * row keeps its exact markup while still gaining the text alternative it never had. The shipped
 * defaults below carry a written text part as well, because prose written for a text reader always
 * beats prose derived from markup.
 */
export type SystemEmailFamily = Extract<
  MailTemplateType,
  typeof MailTemplateType.SIGNATURE_REQUEST | typeof MailTemplateType.VERIFICATION_CODE
>;

/** Every system email family there is — derived from the enum so a family added to
 *  `MailTemplateType` cannot be silently missing its template here. */
export const SYSTEM_EMAIL_FAMILIES: SystemEmailFamily[] = [
  MailTemplateType.SIGNATURE_REQUEST,
  MailTemplateType.VERIFICATION_CODE,
];

/**
 * The shipped copy. Kept byte-for-byte as the markup these two emails have always had (right down to
 * the inline styles), with only the placeholder syntax migrated from the old double-brace
 * `{{SIGNATURE_URL}}` vocabulary to the engine's single-brace `{signatureUrl}` — an existing
 * customised row is rewritten the same way, by the migration, rather than being reset.
 */
export const SYSTEM_EMAIL_DEFAULTS: Record<SystemEmailFamily, DocumentEmailTemplate> = {
  [MailTemplateType.SIGNATURE_REQUEST]: {
    subject: 'Please sign document #{signatureNumber}',
    body:
      'Hello,\n\n' +
      'You have been requested to sign the following document:\n\n' +
      'Document: {signatureNumber}\n' +
      'Signature ID: {signatureId}\n\n' +
      'Open this link to review and sign it:\n{signatureUrl}\n\n' +
      'If you have any questions, please contact us.\n\n' +
      'Best regards,\nThe Invoicerr Team\n\n' +
      'This email was sent from {appUrl}',
    html:
      '<h2>Document Signature Required</h2><p>Hello,</p><p>You have been requested to sign the ' +
      'following document:</p><div style="background: #f8f9fa; padding: 15px; border-radius: 8px; ' +
      'margin: 20px 0;">  <strong>Document:</strong> {signatureNumber}<br>  <strong>Signature ID:' +
      '</strong> {signatureId}</div><p>Please click the button below to review and sign the document:' +
      '</p><div style="text-align: center; margin: 30px 0;">  <a href="{signatureUrl}" style=' +
      '"background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: ' +
      '6px; display: inline-block;">Sign Document</a></div><p>If you have any questions, please ' +
      "don't hesitate to contact us.</p><p>Best regards,<br>The Invoicerr Team</p><hr>" +
      '<p style="font-size: 12px; color: #666;">This email was sent from {appUrl}</p>',
  },
  [MailTemplateType.VERIFICATION_CODE]: {
    subject: 'Your verification code',
    body:
      'Hello,\n\n' +
      'Here is your verification code: {otpCode}\n\n' +
      'This code will expire shortly. Enter it in the application to complete your verification.\n\n' +
      "If you didn't request this code, please ignore this email.\n\n" +
      'Best regards,\nThe Invoicerr Team',
    html:
      '<p>Hello,</p><p>Here is your verification code:</p><div style="background: #f8f9fa; padding: ' +
      '20px; border-radius: 8px; margin: 20px 0; text-align: center;">  <div style="font-size: 32px; ' +
      'font-weight: bold; color: #007bff; letter-spacing: 4px; font-family: monospace;">{otpCode}' +
      '</div></div><p>This code will expire shortly. Please enter it in the application to complete ' +
      "your verification.</p><p>If you didn't request this code, please ignore this email.</p>" +
      '<p>Best regards,<br>The Invoicerr Team</p>',
  },
};

/** Human-readable family name — "SIGNATURE_REQUEST" -> "Signature Request". Plain data, not an i18n
 *  key, the same convention `DocumentTypeDescriptor.label` follows. */
export function systemEmailFamilyLabel(family: SystemEmailFamily): string {
  return family
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Which template actually applies for one family: the company's own `MailTemplate` row when it has
 * one, else the shipped default above. The mirror of `resolveEmailTemplate`'s own "company override >
 * shipped default" precedence for documents, and the reason a missing row is a normal state rather
 * than the hard failure it used to be.
 */
export function resolveSystemEmailTemplate(
  family: SystemEmailFamily,
  override: { subject: string; body: string } | null | undefined,
): DocumentEmailTemplate {
  if (!override) return SYSTEM_EMAIL_DEFAULTS[family];
  // `body` is the row's HTML (see this file's own header); the text part is left empty for the engine
  // to derive from it, rather than sending the raw markup as if it were prose.
  return { subject: override.subject, body: '', html: override.body };
}

/**
 * The placeholders one family offers, mapped to SAMPLE values — the same "keys for the hint, values for
 * a preview" shape `describeDocumentEmailVocabulary` returns for a document type. Built by calling the
 * family's own parts builder, so the advertised vocabulary cannot drift from what the sender actually
 * substitutes; the sample values are fixed (never random), so a preview of the same template is the
 * same preview twice.
 */
export function describeSystemEmailVocabulary(
  family: SystemEmailFamily,
  appUrl: string,
): Record<string, string> {
  if (family === MailTemplateType.SIGNATURE_REQUEST) {
    return buildSignatureRequestEmailParts({
      appUrl,
      signatureUrl: `${appUrl}/signature/3f1c0b8a9d4e5f6071829304a5b6c7d8e9f0a1b2c3d4e5f60718293041a2b3c4`,
      signatureId: 'sig_0000000000000000000000',
      signatureNumber: 'QUOTE-2026-0001',
    });
  }
  return buildOtpEmailParts({ appUrl, otpCode: '1234-5678' });
}

/**
 * The two hosted-billing OWNER warning emails (`billing-lifecycle-sweep-runner.ts`'s own J-7/J-1
 * milestones, `lifecycle.ts#computeDueBillingWarnings`) — sent through this INSTANCE's own mail
 * provider (`MailService#sendMail`, never `sendForCompany`: a company nearing the zip or permanent
 * deletion is exactly the company whose OWN mail server, if it even has one, is the least trustworthy
 * thing to rely on for telling it so), always in English. Deliberately plain functions, not a
 * `SystemEmailFamily`/`MailTemplateType` entry: those are per-COMPANY overrides
 * (`resolveSystemEmailTemplate`'s own precedence), and a company about to lose its data has no
 * business customizing the wording of the notice warning it about that — this is instance-authored
 * content, addressed to a specific OWNER, not a document-adjacent email a tenant configures.
 */
export interface BillingWarningEmailParams {
  appUrl: string;
  /** Whole days left until the event this warning is about — 7 or 1, matching the milestone that
   *  triggered it (`lifecycle.ts`'s own `blocked_d7`/`blocked_d1`/`zipped_d7`/`zipped_d1`). */
  daysRemaining: number;
}

function billingSettingsUrl(appUrl: string): string {
  return `${appUrl}/settings/billing`;
}

/** Warns that the company's data will be EXPORTED AND ZIPPED (the end of the read-only BLOCKED window)
 *  in `daysRemaining` day(s) unless the subscription is regularized first. */
export function buildBlockedZipWarningEmail(params: BillingWarningEmailParams): {
  subject: string;
  text: string;
  html: string;
} {
  const { appUrl, daysRemaining } = params;
  const settingsUrl = billingSettingsUrl(appUrl);
  const dayWord = daysRemaining === 1 ? 'day' : 'days';
  return {
    subject: `Action needed: your Invoicerr data will be archived in ${daysRemaining} ${dayWord}`,
    text:
      'Hello,\n\n' +
      `Your company's Invoicerr subscription is not active, and in ${daysRemaining} ${dayWord} its ` +
      'documents will be exported to a zip file and the account will remain read-only until you ' +
      'subscribe again.\n\n' +
      `Manage your subscription: ${settingsUrl}\n\n` +
      'Best regards,\nThe Invoicerr Team\n\n' +
      `This email was sent from ${appUrl}`,
    html:
      '<h2>Action needed</h2>' +
      `<p>Hello,</p><p>Your company's Invoicerr subscription is not active, and in <strong>${daysRemaining} ` +
      `${dayWord}</strong> its documents will be exported to a zip file and the account will remain ` +
      'read-only until you subscribe again.</p>' +
      `<p><a href="${settingsUrl}" style="background: #007bff; color: white; padding: 12px 24px; ` +
      'text-decoration: none; border-radius: 6px; display: inline-block;">Manage subscription</a></p>' +
      '<p>Best regards,<br>The Invoicerr Team</p><hr>' +
      `<p style="font-size: 12px; color: #666;">This email was sent from ${appUrl}</p>`,
  };
}

/** Warns that the company (and every document in it) will be PERMANENTLY DELETED in `daysRemaining`
 *  day(s) unless the subscription is regularized first — the last of the two warnings ahead of
 *  `deletion.ts`'s own cascading delete. */
export function buildDeletionWarningEmail(params: BillingWarningEmailParams): {
  subject: string;
  text: string;
  html: string;
} {
  const { appUrl, daysRemaining } = params;
  const settingsUrl = billingSettingsUrl(appUrl);
  const dayWord = daysRemaining === 1 ? 'day' : 'days';
  return {
    subject: `Final notice: your Invoicerr company will be permanently deleted in ${daysRemaining} ${dayWord}`,
    text:
      'Hello,\n\n' +
      `In ${daysRemaining} ${dayWord}, your company and every document in it will be PERMANENTLY ` +
      'DELETED from Invoicerr. This cannot be undone. Subscribe again before then to keep your data.\n\n' +
      `Manage your subscription: ${settingsUrl}\n\n` +
      'Best regards,\nThe Invoicerr Team\n\n' +
      `This email was sent from ${appUrl}`,
    html:
      '<h2>Final notice</h2>' +
      `<p>Hello,</p><p>In <strong>${daysRemaining} ${dayWord}</strong>, your company and every document ` +
      'in it will be <strong>permanently deleted</strong> from Invoicerr. This cannot be undone. ' +
      'Subscribe again before then to keep your data.</p>' +
      `<p><a href="${settingsUrl}" style="background: #dc3545; color: white; padding: 12px 24px; ` +
      'text-decoration: none; border-radius: 6px; display: inline-block;">Manage subscription</a></p>' +
      '<p>Best regards,<br>The Invoicerr Team</p><hr>' +
      `<p style="font-size: 12px; color: #666;">This email was sent from ${appUrl}</p>`,
  };
}
