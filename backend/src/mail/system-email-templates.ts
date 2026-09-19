import { MailTemplateType } from '../../prisma/generated/prisma/client';

import {
  buildOtpEmailParts,
  buildSignatureRequestEmailParts,
  DocumentEmailTemplate,
} from '@/modules/documents/actions/email-template';
import {
  DEFAULT_RENDER_LANGUAGE,
  RenderLanguage,
} from '@/modules/documents/rendering/language/supported-languages';

import { escapeHtml } from './escape-html';
import { mailT } from './i18n';

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
 * ## Why the DEFAULT is now resolved per-language, and the override never is
 *
 * `buildSystemEmailDefault` reads its prose from the `mails` i18next catalog (`i18n.ts`) instead of a
 * hardcoded English literal — the shipped copy a company never customised now follows the recipient's
 * own language, the same posture `resolveEmailTemplate` already holds for a document's own defaults.
 * A company's OVERRIDE row is untouched by any of this: it is raw HTML/subject text a human typed into
 * the settings screen in whatever language THEY wrote it in, and translating it out from under them
 * would silently rewrite content they own — `resolveSystemEmailTemplate` below still returns it
 * verbatim, `language` only ever selects which DEFAULT would have applied had there been no override.
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
 * Builds the shipped copy for one family in one language. The single-brace placeholders
 * (`{signatureNumber}`, `{signatureId}`, `{signatureUrl}`, `{otpCode}`, `{appUrl}`) are deliberately
 * NOT i18next interpolation — `i18n.ts` configures `{{ }}` as its own interpolation delimiter, so a
 * lone `{token}` is inert, ordinary text to it and survives every language's translation untouched,
 * to be substituted later by `renderEmailTemplate` (`actions/email-template.ts`) once a real send
 * knows the actual signature/OTP values. This is exactly the same "translate the words, keep the
 * token" contract every legacy `{signatureNumber}`-style default already relied on before this file
 * had more than one language — only the words move.
 */
export function buildSystemEmailDefault(
  family: SystemEmailFamily,
  language: RenderLanguage,
): DocumentEmailTemplate {
  const t = mailT(language);
  const sentFrom = t('layout.sentFrom');

  if (family === MailTemplateType.SIGNATURE_REQUEST) {
    return {
      subject: t('signatureRequest.subject'),
      body:
        `${t('layout.greeting')}\n\n` +
        `${t('signatureRequest.intro')}\n\n` +
        `${t('signatureRequest.documentLine')}\n` +
        `${t('signatureRequest.signatureIdLine')}\n\n` +
        `${t('signatureRequest.reviewLinkIntro')}\n{signatureUrl}\n\n` +
        `${t('signatureRequest.contactText')}\n\n` +
        `${t('layout.signOffText')}\n\n` +
        sentFrom,
      html:
        `<h2>${t('signatureRequest.title')}</h2><p>${t('layout.greeting')}</p>` +
        `<p>${t('signatureRequest.intro')}</p><div style="background: #f8f9fa; padding: 15px; ` +
        `border-radius: 8px; margin: 20px 0;">  <strong>${t('signatureRequest.documentLabel')}</strong> ` +
        `{signatureNumber}<br>  <strong>${t('signatureRequest.signatureIdLabel')}</strong> {signatureId}</div>` +
        `<p>${t('signatureRequest.clickBelow')}</p><div style="text-align: center; margin: 30px 0;">  ` +
        `<a href="{signatureUrl}" style="background: #007bff; color: white; padding: 12px 24px; ` +
        `text-decoration: none; border-radius: 6px; display: inline-block;">` +
        `${t('signatureRequest.buttonLabel')}</a></div>` +
        `<p>${t('signatureRequest.contactHtml')}</p><p>${t('layout.signOffHtml')}</p><hr>` +
        `<p style="font-size: 12px; color: #666;">${sentFrom}</p>`,
    };
  }

  return {
    subject: t('verificationCode.subject'),
    body:
      `${t('layout.greeting')}\n\n` +
      `${t('verificationCode.codeIntroText')}\n\n` +
      `${t('verificationCode.expiryText')}\n\n` +
      `${t('verificationCode.ignoreNotice')}\n\n` +
      `${t('layout.signOffText')}`,
    html:
      `<p>${t('layout.greeting')}</p><p>${t('verificationCode.codeIntroHtml')}</p>` +
      '<div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; ' +
      'text-align: center;">  <div style="font-size: 32px; font-weight: bold; color: #007bff; ' +
      'letter-spacing: 4px; font-family: monospace;">{otpCode}</div></div>' +
      `<p>${t('verificationCode.expiryHtml')}</p><p>${t('verificationCode.ignoreNotice')}</p>` +
      `<p>${t('layout.signOffHtml')}</p>`,
  };
}

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
 * one, else the shipped default (`buildSystemEmailDefault`, resolved in `language`). The mirror of
 * `resolveEmailTemplate`'s own "company override > shipped default" precedence for documents, and the
 * reason a missing row is a normal state rather than the hard failure it used to be.
 *
 * `language` defaults to `DEFAULT_RENDER_LANGUAGE` ('en') so every pre-existing caller that has not
 * been wired to a recipient's own language yet (today: the settings screen's own preview,
 * `company.service.ts`) keeps seeing byte-for-byte the same English copy it always has — this
 * parameter only ever WIDENS what a caller can ask for, it never forces one to already know a
 * language it has no recipient to resolve one for.
 */
export function resolveSystemEmailTemplate(
  family: SystemEmailFamily,
  override: { subject: string; body: string } | null | undefined,
  language: RenderLanguage = DEFAULT_RENDER_LANGUAGE,
): DocumentEmailTemplate {
  if (!override) return buildSystemEmailDefault(family, language);
  // `body` is the row's HTML (see this file's own header); the text part is left empty for the engine
  // to derive from it, rather than sending the raw markup as if it were prose. Never translated: an
  // override is the company's own words, in whatever language they wrote it — see this file's header.
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
 * thing to rely on for telling it so). Deliberately plain functions, not a
 * `SystemEmailFamily`/`MailTemplateType` entry: those are per-COMPANY overrides
 * (`resolveSystemEmailTemplate`'s own precedence), and a company about to lose its data has no
 * business customizing the wording of the notice warning it about that — this is instance-authored
 * content, addressed to a specific OWNER, not a document-adjacent email a tenant configures.
 *
 * `language` defaults to `DEFAULT_RENDER_LANGUAGE` because the ONE caller today
 * (`billing-lifecycle-sweep-runner.ts`) still addresses this as instance-authored content and passes
 * `DEFAULT_RENDER_LANGUAGE` explicitly — the parameter exists so that caller has somewhere to plug in
 * a real per-operator locale (a future `DEFAULT_LOCALE` setting) without this function's own shape
 * changing again.
 */
export interface BillingWarningEmailParams {
  appUrl: string;
  /** Whole days left until the event this warning is about — 7 or 1, matching the milestone that
   *  triggered it (`lifecycle.ts`'s own `blocked_d7`/`blocked_d1`/`zipped_d7`/`zipped_d1`). */
  daysRemaining: number;
  /** See this interface's own header — defaults to English, the language every one of these warnings
   *  has always shipped in. */
  language?: RenderLanguage;
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
  const { appUrl, daysRemaining, language = DEFAULT_RENDER_LANGUAGE } = params;
  const t = mailT(language);
  const settingsUrl = billingSettingsUrl(appUrl);
  const count = daysRemaining;
  return {
    subject: t('billingWarning.blockedZip.subject', { count }),
    text:
      `${t('layout.greeting')}\n\n` +
      `${t('billingWarning.blockedZip.introText', { count })}\n\n` +
      `${t('billingWarning.manageLine').replace('{settingsUrl}', settingsUrl)}\n\n` +
      `${t('layout.signOffText')}\n\n` +
      `${t('layout.sentFrom').replace('{appUrl}', appUrl)}`,
    html:
      `<h2>${t('billingWarning.blockedZip.heading')}</h2>` +
      `<p>${t('layout.greeting')}</p><p>${t('billingWarning.blockedZip.introHtml', { count })}</p>` +
      `<p><a href="${settingsUrl}" style="background: #007bff; color: white; padding: 12px 24px; ` +
      `text-decoration: none; border-radius: 6px; display: inline-block;">${t('billingWarning.ctaLabel')}</a></p>` +
      `<p>${t('layout.signOffHtml')}</p><hr>` +
      `<p style="font-size: 12px; color: #666;">${t('layout.sentFrom').replace('{appUrl}', appUrl)}</p>`,
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
  const { appUrl, daysRemaining, language = DEFAULT_RENDER_LANGUAGE } = params;
  const t = mailT(language);
  const settingsUrl = billingSettingsUrl(appUrl);
  const count = daysRemaining;
  return {
    subject: t('billingWarning.deletion.subject', { count }),
    text:
      `${t('layout.greeting')}\n\n` +
      `${t('billingWarning.deletion.textBody', { count })}\n\n` +
      `${t('billingWarning.manageLine').replace('{settingsUrl}', settingsUrl)}\n\n` +
      `${t('layout.signOffText')}\n\n` +
      `${t('layout.sentFrom').replace('{appUrl}', appUrl)}`,
    html:
      `<h2>${t('billingWarning.deletion.heading')}</h2>` +
      `<p>${t('layout.greeting')}</p><p>${t('billingWarning.deletion.htmlBody', { count })}</p>` +
      `<p><a href="${settingsUrl}" style="background: #dc3545; color: white; padding: 12px 24px; ` +
      `text-decoration: none; border-radius: 6px; display: inline-block;">${t('billingWarning.ctaLabel')}</a></p>` +
      `<p>${t('layout.signOffHtml')}</p><hr>` +
      `<p style="font-size: 12px; color: #666;">${t('layout.sentFrom').replace('{appUrl}', appUrl)}</p>`,
  };
}

/**
 * "Our legal documents have changed" — sent to EVERY user of the instance (not just OWNERs, unlike
 * the two warnings above) once per boot pass in which `legal-release-notify.ts` finds at least one
 * document whose text hash moved past a release it had already recorded. Same posture as the billing
 * warnings: instance mail (`MailService#sendMail`), plain function rather than a `SystemEmailFamily`
 * — this is instance-authored content about legal text a company has no business rewording.
 *
 * ONE call = ONE email, no matter how many documents changed: a deploy that ships several document
 * edits at once (a common shape — a legal review round tends to touch the Terms, the Privacy Policy
 * and the Legal Notice together) still means a user reads exactly one message, listing every one of
 * them. The caller is what enforces this by collecting every changed document before calling this
 * function once per user, rather than calling it once per document.
 *
 * `language` defaults to English only for a caller that omits it — `legal-release-notify.ts` (the one
 * caller today) always passes the recipient's own `resolveUserLanguage(user.locale, undefined)`, no
 * company fallback (a legal-release notice reaches every user of the instance regardless of which, if
 * any, company they belong to, so there is no single company to fall back to). The default stays on
 * this function's own signature anyway so any future second caller that has no locale in hand yet
 * still gets a well-defined language rather than an easy-to-miss required argument.
 */
export interface LegalDocumentChangedEmailParams {
  appUrl: string;
  /** Every document this user has not yet been told about, in the order they should be listed —
   *  never empty (the caller only builds this email once it has at least one). */
  documents: Array<{ title: string; version: string; slug: string }>;
  /** Whether at least one of `documents` is one the sign-in interstitial will actually block on
   *  (`legal-documents.ts#REQUIRED_ACCEPTANCE_SLUGS`) — the other three are reference material nobody
   *  is forced to re-accept, so a batch containing only those gets no call to action, just the reading
   *  links. */
  requiresAcceptance: boolean;
  /** See this interface's own header — defaults to English. */
  language?: RenderLanguage;
}

/** "X", "X and Y", or "X, Y and N more" — a subject line needs a compact name for an arbitrary-length
 *  list of titles, so this is its own helper rather than being inlined into the subject below. Titles
 *  come from this application's own legal-document catalog (never attacker input), so no HTML-escaping
 *  concern applies here — same as the per-document `<li>` list this file builds further down. */
function describeDocumentTitles(documents: Array<{ title: string }>, t: ReturnType<typeof mailT>): string {
  if (documents.length === 1) return documents[0].title;
  if (documents.length === 2) {
    return t('legalChanged.titlesTwo')
      .replace('{first}', documents[0].title)
      .replace('{second}', documents[1].title);
  }
  const [first, second, ...rest] = documents;
  return t('legalChanged.titlesMany')
    .replace('{first}', first.title)
    .replace('{second}', second.title)
    .replace('{count}', String(rest.length));
}

export function buildLegalDocumentChangedEmail(params: LegalDocumentChangedEmailParams): {
  subject: string;
  text: string;
  html: string;
} {
  const { appUrl, documents, requiresAcceptance, language = DEFAULT_RENDER_LANGUAGE } = params;
  const t = mailT(language);
  const count = documents.length;
  const subject =
    count === 1
      ? t('legalChanged.subjectSingular').replace('{title}', documents[0].title)
      : t('legalChanged.subjectPlural').replace('{titles}', describeDocumentTitles(documents, t));

  const listText = documents
    .map((d) => `- ${d.title} (version ${d.version}): ${appUrl}/legal/${d.slug}`)
    .join('\n');
  const listHtml = documents
    .map((d) => `<li><a href="${appUrl}/legal/${d.slug}">${d.title}</a> — version ${d.version}</li>`)
    .join('');

  // The accept screen is ONE link for the whole batch, never one per document: re-acceptance is a
  // single gate (`REQUIRED_ACCEPTANCE_SLUGS`, checked as a set) a user clears in one visit regardless
  // of how many of the required documents moved.
  const acceptUrl = `${appUrl}/legal/accept`;
  const acceptText = requiresAcceptance ? `\n${t('legalChanged.acceptNotice')}\n${acceptUrl}\n` : '';
  const acceptHtml = requiresAcceptance
    ? `<p>${t('legalChanged.acceptNotice')}</p>` +
      `<p><a href="${acceptUrl}" style="background: #007bff; color: white; padding: 12px 24px; ` +
      `text-decoration: none; border-radius: 6px; display: inline-block;">${t('legalChanged.acceptButton')}</a></p>`
    : '';

  return {
    subject,
    text:
      `${t('layout.greeting')}\n\n` +
      `${t('legalChanged.introText', { count })}\n\n` +
      `${listText}\n` +
      acceptText +
      `\n${t('layout.signOffText')}\n\n` +
      `${t('layout.sentFrom').replace('{appUrl}', appUrl)}`,
    html:
      `<h2>${t('legalChanged.heading', { count })}</h2>` +
      `<p>${t('layout.greeting')}</p><p>${t('legalChanged.introHtml', { count })}</p>` +
      `<ul>${listHtml}</ul>` +
      acceptHtml +
      `<p>${t('layout.signOffHtml')}</p><hr>` +
      `<p style="font-size: 12px; color: #666;">${t('layout.sentFrom').replace('{appUrl}', appUrl)}</p>`,
  };
}

/**
 * Company ownership transfer (product decision 2026-09-17, `modules/company/transfer/`) — three
 * moments, three functions below, all sent through the COMPANY's own send cascade
 * (`MailService#sendForCompany`, never `sendMail`): unlike the billing warnings/legal-document-changed
 * emails above (deliberately instance-authored, addressed to a specific OWNER about THEIR OWN
 * subscription/account), a transfer is one company's own business action toward a named recipient —
 * the same posture `danger.service.ts`'s own OTP mail already takes for this company's OWNER. The
 * cascade's own fallback (company's mail server, else the instance's, else a named refusal) is what
 * keeps the recipient's address reachable even for a company with no mail server configured.
 *
 * `language` defaults to English only for a caller that omits it — `transfer.service.ts` and
 * `expire-transfer.ts` (the callers today) always pass `resolveUserLanguage(recipientUser.locale,
 * company.language)`, so each of the transfer's three participants (requester, recipient, former
 * owner) reads their own mail in their own preferred language, never the initiating OWNER's.
 *
 * ## Why attacker-controlled values are NEVER run through i18next's own `{{var}}` interpolation
 *
 * `companyName`/`fromName`/`toEmail` are typed by whichever OWNER initiates/cancels a transfer, and
 * this HTML reaches a DIFFERENT, unrelated user's inbox — the exact reason the html variant below still
 * escapes them with the same `escapeHtml` this file always has. i18next's OWN default escaping (used
 * whenever a value is interpolated via `{{var}}`) additionally escapes `/` (`&#x2F;`), which
 * `escapeHtml` deliberately does not — switching these three values to real i18next interpolation
 * would silently change what a company name containing a slash renders as. Keeping them OUTSIDE
 * interpolation (the translated sentence is fetched as a literal template with its own `{fromName}`/
 * `{companyName}`/`{toEmail}` tokens, still inert to i18next for the reason `buildSystemEmailDefault`'s
 * own header explains, then substituted by hand with `replaceAll`) keeps the escaping behavior exactly
 * what it always was, in every language.
 */
function transferAccountUrl(appUrl: string): string {
  return `${appUrl}/account/transfers`;
}

/** Sent to the RECIPIENT the moment an OWNER initiates a transfer — the recipient may not be a member
 *  of `companyName` at all yet, so this is their entire notice that the request exists. */
export function buildOwnershipTransferRequestEmail(params: {
  appUrl: string;
  companyName: string;
  fromName: string;
  language?: RenderLanguage;
}): { subject: string; text: string; html: string } {
  const { appUrl, companyName, fromName, language = DEFAULT_RENDER_LANGUAGE } = params;
  const t = mailT(language);
  const url = transferAccountUrl(appUrl);

  const subject = t('ownershipTransfer.request.subject')
    .replaceAll('{fromName}', fromName)
    .replaceAll('{companyName}', companyName);
  const textIntro = t('ownershipTransfer.request.textIntro')
    .replaceAll('{fromName}', fromName)
    .replaceAll('{companyName}', companyName);
  const htmlIntro = t('ownershipTransfer.request.htmlIntro')
    .replaceAll('{fromName}', escapeHtml(fromName))
    .replaceAll('{companyName}', escapeHtml(companyName));

  return {
    subject,
    text:
      `${t('layout.greeting')}\n\n` +
      `${textIntro}\n\n` +
      `${t('ownershipTransfer.request.expiryNotice')} ${t('ownershipTransfer.request.reviewLinkIntro')}\n` +
      `${url}\n\n` +
      `${t('ownershipTransfer.request.ignoreNotice')}\n\n` +
      `${t('layout.signOffText')}\n\n` +
      `${t('layout.sentFrom').replace('{appUrl}', appUrl)}`,
    html:
      `<h2>${t('ownershipTransfer.request.heading')}</h2>` +
      `<p>${t('layout.greeting')}</p><p>${htmlIntro}</p>` +
      `<p>${t('ownershipTransfer.request.expiryNotice')}</p>` +
      `<p><a href="${url}" style="background: #007bff; color: white; padding: 12px 24px; ` +
      `text-decoration: none; border-radius: 6px; display: inline-block;">${t('ownershipTransfer.request.buttonLabel')}</a></p>` +
      `<p>${t('ownershipTransfer.request.ignoreNotice')}</p>` +
      `<p>${t('layout.signOffHtml')}</p><hr>` +
      `<p style="font-size: 12px; color: #666;">${t('layout.sentFrom').replace('{appUrl}', appUrl)}</p>`,
  };
}

/** Sent to BOTH parties once a transfer is finalized — `forNewOwner` picks which of the two mirrored
 *  messages this particular recipient gets (their own new role reads very differently: gaining OWNER
 *  vs. stepping down to admin). */
export function buildOwnershipTransferFinalizedEmail(params: {
  appUrl: string;
  companyName: string;
  forNewOwner: boolean;
  language?: RenderLanguage;
}): { subject: string; text: string; html: string } {
  const { appUrl, companyName, forNewOwner, language = DEFAULT_RENDER_LANGUAGE } = params;
  const t = mailT(language);

  const subject = (
    forNewOwner
      ? t('ownershipTransfer.finalized.subjectNewOwner')
      : t('ownershipTransfer.finalized.subjectFormerOwner')
  ).replaceAll('{companyName}', companyName);
  const bodyKey = forNewOwner
    ? 'ownershipTransfer.finalized.bodyLineNewOwner'
    : 'ownershipTransfer.finalized.bodyLineFormerOwner';
  const bodyLineText = t(bodyKey).replaceAll('{companyName}', companyName);
  // Unlike the request/ended emails (which escape ONLY the interpolated value inside a literal,
  // unescaped template), the original code here built the whole sentence RAW first and escaped the
  // entire line — including its own literal quote marks — as one `escapeHtml(bodyLine)` call. Matching
  // that exactly: substitute the raw value, THEN escape the fully composed sentence, not the other way
  // around, or the quotes this template writes around `{companyName}` would stay as literal `"`
  // characters instead of `&quot;`, a silent behavior change from before this file had languages.
  const bodyLineHtml = escapeHtml(t(bodyKey).replaceAll('{companyName}', companyName));

  return {
    subject,
    text:
      `${t('layout.greeting')}\n\n` +
      `${bodyLineText}\n\n` +
      `${t('layout.signOffText')}\n\n` +
      `${t('layout.sentFrom').replace('{appUrl}', appUrl)}`,
    html:
      `<h2>${t('ownershipTransfer.finalized.heading')}</h2>` +
      `<p>${t('layout.greeting')}</p><p>${bodyLineHtml}</p>` +
      `<p>${t('layout.signOffHtml')}</p><hr>` +
      `<p style="font-size: 12px; color: #666;">${t('layout.sentFrom').replace('{appUrl}', appUrl)}</p>`,
  };
}

/** Sent to the INITIATING owner when a transfer never completes — expired unanswered (the 7-day
 *  sweep) or was canceled by that same owner (a receipt of their own action, the same "confirm what
 *  just happened" courtesy a cancel of anything else in this app gets via its own success toast). */
export function buildOwnershipTransferEndedEmail(params: {
  appUrl: string;
  companyName: string;
  toEmail: string;
  reason: 'expired' | 'canceled';
  language?: RenderLanguage;
}): { subject: string; text: string; html: string } {
  const { appUrl, companyName, toEmail, reason, language = DEFAULT_RENDER_LANGUAGE } = params;
  const t = mailT(language);
  const expired = reason === 'expired';

  const subject = (
    expired ? t('ownershipTransfer.ended.subjectExpired') : t('ownershipTransfer.ended.subjectCanceled')
  ).replaceAll('{companyName}', companyName);
  const bodyKey = expired ? 'ownershipTransfer.ended.bodyExpired' : 'ownershipTransfer.ended.bodyCanceled';
  const bodyText = t(bodyKey).replaceAll('{companyName}', companyName).replaceAll('{toEmail}', toEmail);
  const bodyHtml = t(bodyKey)
    .replaceAll('{companyName}', escapeHtml(companyName))
    .replaceAll('{toEmail}', escapeHtml(toEmail));

  return {
    subject,
    text:
      `${t('layout.greeting')}\n\n` +
      `${bodyText}\n\n` +
      `${t('layout.signOffText')}\n\n` +
      `${t('layout.sentFrom').replace('{appUrl}', appUrl)}`,
    html:
      `<h2>${t('ownershipTransfer.ended.heading')}</h2>` +
      `<p>${t('layout.greeting')}</p><p>${bodyHtml}</p>` +
      `<p>${t('layout.signOffHtml')}</p><hr>` +
      `<p style="font-size: 12px; color: #666;">${t('layout.sentFrom').replace('{appUrl}', appUrl)}</p>`,
  };
}
