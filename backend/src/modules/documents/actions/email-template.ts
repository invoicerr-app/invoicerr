import { decimalsFor, fromMinor } from '@/utils/financial';

import { DocumentEmailTemplate, DocumentFieldDescriptor, DocumentTypeDescriptor } from '../descriptors/types';
import { DEFAULT_RENDER_LANGUAGE, RenderLanguage } from '../rendering/language/supported-languages';
import { descriptorHasLineTotals, DocumentTotals } from '../totals/compute-totals';

export type { DocumentEmailTemplate };

export interface RenderedEmailTemplate {
  subject: string;
  /** The text/plain part — ALWAYS a string, derived from `html` when the template carries no text body
   *  of its own (see `renderEmailTemplate`). */
  body: string;
  /** The text/html part — present ONLY when the template actually declared one; a text-only template
   *  renders to a text-only email, exactly as it always did. */
  html?: string;
  /** Human-readable, one per DISTINCT unknown placeholder — see `renderEmailTemplate`'s own header. */
  warnings: string[];
}

const PLACEHOLDER_PATTERN = /\{([a-zA-Z0-9_]+)\}/g;

/** Escapes a SUBSTITUTED VALUE on its way into the html part — never the template's own markup, which
 *  is filtered at write time instead (`mail/sanitize-email-html.ts`). Without this, a company name or
 *  a client name containing `<` would be interpreted as markup by the recipient's mail client: the
 *  template is trusted-and-filtered, the values interpolated into it are neither. The TEXT part is
 *  deliberately left unescaped — `&` is an ampersand there, not an entity. */
function escapeHtmlValue(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Turns an html body into a readable text/plain alternative — LINKS KEEP THEIR URL, block ends and
 * `<br>` become newlines, list items gain a leading dash, the remaining tags go, and the handful of
 * entities an email body realistically carries are decoded (`&amp;` LAST, so an escaped `&amp;lt;` does
 * not decay into `<`).
 *
 * Used only as the FALLBACK for a template that carries html and no text body of its own: a template
 * that declares both always sends the text part its author actually wrote. A mail with an html part and
 * no text part at all is the outcome this exists to prevent — it is what a text-only client, a screen
 * reader, and most spam filters see.
 *
 * The link handling is the load-bearing part, not a nicety: an `<a href>`'s target lives in an
 * ATTRIBUTE, so a plain tag-strip would turn a company's own "click <a href="{signatureUrl}">here</a>"
 * into the word "here" with no link anywhere in the text part — an unusable signature request for
 * exactly the reader who has only that part. `label (url)` keeps both, and a label that already IS the
 * url is emitted once rather than twice.
 */
export function deriveTextFromHtml(html: string): string {
  const withBreaks = html
    // Links FIRST: the generic tag-strip further down cannot see attributes any more.
    .replace(
      /<a\b[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/\s*a\s*>/gi,
      (_match, href: string, label: string) => {
        const text = label.replace(/<[^>]*>/g, '').trim();
        const url = href.trim();
        if (!url) return text;
        if (!text || text.includes(url)) return url;
        return `${text} (${url})`;
      },
    )
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*hr\s*\/?\s*>/gi, '\n')
    // `<li>` opens the line; `</li>` deliberately does NOT close it with a newline of its own — the next
    // item's own opening tag (or the list's closing tag) already provides one, and adding both would
    // leave a blank line between every bullet.
    .replace(/<\s*li[^>]*>/gi, '\n- ')
    .replace(/<\/\s*(p|div|h[1-6]|tr|ul|ol|table|blockquote|pre)\s*>/gi, '\n');

  return withBreaks
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Pure interpolation: replaces every `{key}` in `template.subject`/`template.body`/`template.html` with
 * `parts[key]` when `key` is a property of `parts` — including when its value is `''` (a legitimately
 * empty, but KNOWN, placeholder, e.g. an unnumbered document's `{displayNumber}` — see
 * `buildEmailTemplateParts`).
 *
 * A placeholder that is NOT a property of `parts` at all (a typo in a company's own override, or a
 * template referencing something this document type has no value for — e.g. `{recipientName}` on a
 * type with no client-ish reference field) is left EXACTLY as written, and reported once in
 * `warnings` — never a thrown error, never a silently dropped brace. This is deliberately the SAME
 * "degrade honestly, stay visible" discipline `rendering/render-html.ts` holds for an unrecognized
 * FIELD KIND (a visible `[unrendered field kind ...]` marker, never an exception that would abort an
 * entire PDF) — a badly configured company template must not be able to block every future send of
 * that document type; it should show up as a warning on the ONE send that hit it instead.
 *
 * This is the OPPOSITE philosophy from numbering/format-number.ts's `formatDocumentNumber`, which
 * throws on an unknown `{token}` — deliberately: a bad NUMBER FORMAT is a company-wide configuration
 * bug caught once, loudly, before any number is ever spent on it. A bad EMAIL TEMPLATE is user-typed
 * prose that will almost certainly contain stray `{` or a genuinely unsupported placeholder at some
 * point, and the one thing that must never happen is a customer never receiving their invoice because
 * of a typo in a subject line. The same holds for the two SYSTEM emails that run through this engine
 * (`mail/system-email-templates.ts`): a typo in a company's signature-request subject must never be
 * what stops a signature request — or a verification code — from reaching its recipient.
 *
 * ## The two parts
 *
 * The text parts (`subject`, `body`) get the raw values; the `html` part gets HTML-ESCAPED values (see
 * `escapeHtmlValue`), so a value that happens to contain markup is read as the text it is. Warnings are
 * collected across all three and still reported once per DISTINCT unknown key, never once per part.
 *
 * A template with an `html` part and a blank `body` yields a DERIVED text part (`deriveTextFromHtml`,
 * applied to the ALREADY-INTERPOLATED html so the text carries the real values too) rather than an
 * empty one — which is the state every legacy `MailTemplate` row is in, since that table only ever
 * stored html (see `mail/system-email-templates.ts`).
 */
export function renderEmailTemplate(
  template: DocumentEmailTemplate,
  parts: Record<string, string>,
): RenderedEmailTemplate {
  const unknown = new Set<string>();

  const interpolate = (text: string, escapeValue: (value: string) => string): string =>
    text.replace(PLACEHOLDER_PATTERN, (literal, key: string) => {
      if (Object.hasOwn(parts, key)) {
        return escapeValue(parts[key]);
      }
      unknown.add(key);
      return literal;
    });

  const asIs = (value: string): string => value;
  const subject = interpolate(template.subject, asIs);
  const body = interpolate(template.body, asIs);
  const html = template.html ? interpolate(template.html, escapeHtmlValue) : undefined;
  const warnings = [...unknown].map((key) => `Unknown email template placeholder "{${key}}" left as-is.`);

  const textPart = body.trim() === '' && html ? deriveTextFromHtml(html) : body;

  return { subject, body: textPart, ...(html ? { html } : {}), warnings };
}

/**
 * The GENERIC, minimal fallback for a document type that declares NO `email` template of its own
 * (DocumentTypeDescriptor.email) and whose company has no override either — reachable only for a
 * THIRD-PARTY type today, since every type shipped in this trunk (quote/invoice/credit-note/expense)
 * declares its own (see each descriptor's own comment). Visible IN CODE, deliberately, rather than a
 * default parameter buried inside `resolveEmailTemplate` below — a missing template must be an
 * obvious fact a reader of this file can see, not a silently-applied default nobody wrote down.
 */
export const GENERIC_FALLBACK_EMAIL_TEMPLATE: DocumentEmailTemplate = {
  subject: '{typeLabel} {displayNumber}',
  body: 'Please find attached {typeLabel} {displayNumber}.',
};

/**
 * TODO_FEATURES.md rank 14 ("langue du document par destinataire") — non-English variants of
 * `GENERIC_FALLBACK_EMAIL_TEMPLATE` above, same precedence rule and same reason for existing as
 * `DocumentTypeDescriptor.emailTranslations` (see that field's own header): never carries an `'en'`
 * entry, since `GENERIC_FALLBACK_EMAIL_TEMPLATE` already is the English default. Reachable only for a
 * third-party type that declares no `email` of its own — every native type ships one (see each
 * descriptor's own `email`/`emailTranslations`).
 */
const GENERIC_FALLBACK_EMAIL_TRANSLATIONS: Partial<Record<RenderLanguage, DocumentEmailTemplate>> = {
  fr: {
    subject: '{typeLabel} {displayNumber}',
    body: 'Veuillez trouver ci-joint {typeLabel} {displayNumber}.',
  },
  it: {
    subject: '{typeLabel} {displayNumber}',
    body: 'In allegato {typeLabel} {displayNumber}.',
  },
  pl: {
    subject: '{typeLabel} {displayNumber}',
    body: 'W załączeniu {typeLabel} {displayNumber}.',
  },
  de: {
    subject: '{typeLabel} {displayNumber}',
    body: 'Anbei {typeLabel} {displayNumber}.',
  },
  pt: {
    subject: '{typeLabel} {displayNumber}',
    body: 'Em anexo {typeLabel} {displayNumber}.',
  },
};

/** Where a resolved template actually came from — the one thing a settings screen needs that the
 *  template's own content cannot tell it ("am I looking at my own text, or at the default I would
 *  revert to?"). Returned by `resolveEmailTemplateSource` below, never inferred by comparing strings. */
export type EmailTemplateSource = 'company' | 'descriptor' | 'generic';

/**
 * Which template actually applies for `descriptor`, given the active company's OWN overrides
 * (`Company.documentEmailTemplates`, keyed by `DocumentTypeDescriptor.id` — see
 * actions/company-email-templates.ts for how that column is read and written) and the resolved
 * recipient `language` (TODO_FEATURES.md rank 14 — see
 * `rendering/language/resolve-recipient-language.ts`). Priority, highest first:
 *  1. the company's own override for this type, if it set one — a company's own wording is sent
 *     exactly as written, in whatever language the company wrote it in, REGARDLESS of `language`: this
 *     is what "compose with an override, never bypass it" means in practice (see this function's own
 *     callers).
 *  2. the type's own translated default for `language` (`descriptor.emailTranslations?.[language]`),
 *     if this type declares one for it;
 *  3. the type's own descriptor default (`descriptor.email`) — the English content, reached for
 *     `language === 'en'` and for any language this type has no translation for (the missing-
 *     translation policy: silent fallback to English, never a blocked send — the same "never a typo
 *     stops an email going out" philosophy `renderEmailTemplate`'s own header already documents for an
 *     unknown placeholder);
 *  4. `GENERIC_FALLBACK_EMAIL_TEMPLATE`/`GENERIC_FALLBACK_EMAIL_TRANSLATIONS` above — every shipped
 *     type has (3), so this is reachable only for a type this trunk did not declare one for.
 *
 * `language` defaults to `DEFAULT_RENDER_LANGUAGE` ('en') so every pre-existing caller (the two-arg
 * call every test and every pre-this-feature call site already makes) keeps resolving exactly the
 * template it always did.
 */
export function resolveEmailTemplate(
  descriptor: DocumentTypeDescriptor,
  companyOverrides: Record<string, DocumentEmailTemplate> | null | undefined,
  language: RenderLanguage = DEFAULT_RENDER_LANGUAGE,
): DocumentEmailTemplate {
  const override = companyOverrides?.[descriptor.id];
  if (override) return override;

  const translated = descriptor.emailTranslations?.[language];
  if (translated) return translated;

  if (descriptor.email) return descriptor.email;

  return GENERIC_FALLBACK_EMAIL_TRANSLATIONS[language] ?? GENERIC_FALLBACK_EMAIL_TEMPLATE;
}

/** The same resolution `resolveEmailTemplate` performs, reporting WHICH step won — one function, one
 *  precedence rule, so a settings screen can never disagree with what a send will actually use.
 *  Deliberately collapses steps 2/3 of that function into ONE `'descriptor'` source: from a settings
 *  screen's point of view ("is this the type's own default, or my own override?"), a translated
 *  default and the English default are the same answer — WHICH language variant was picked is exactly
 *  what `resolveEmailTemplate` itself, not this reporting helper, is for. */
export function resolveEmailTemplateSource(
  descriptor: DocumentTypeDescriptor,
  companyOverrides: Record<string, DocumentEmailTemplate> | null | undefined,
): EmailTemplateSource {
  if (companyOverrides?.[descriptor.id]) return 'company';
  if (descriptor.email) return 'descriptor';
  return 'generic';
}

/** `totalGross` formatted the same way `rendering/render-html.ts`'s own "Total" row is — REUSES the
 *  totals `computeDocumentTotals` already produced, never a second computation. `currency: null`
 *  (compute-totals.ts's own "document currency not found" case) formats with the 2-decimal default,
 *  the same way `decimalsFor('')` already does everywhere else in this module. */
function formatGrossTotal(totals: DocumentTotals): string {
  const currency = totals.currency ?? '';
  const decimals = decimalsFor(currency);
  const amount = fromMinor(totals.grossMinor, currency).toFixed(decimals);
  return currency ? `${amount} ${currency}` : amount;
}

/**
 * The two EntityReferenceRegistry entities that count as "the recipient this document type
 * addresses" — both back onto the SAME `Client` table under two different search scopes
 * (`client-reference.provider.ts`'s own header): "client" for an outbound document's billable party
 * (the quote's/invoice's own field), "supplier" for one addressed to a supplier
 * (`received-invoice.descriptor.ts`'s own `supplierClient`, and `purchase-order.descriptor.ts`'s own
 * `supplier` — the first type in this trunk that actually SENDS to one). A `{recipientName}`/
 * recipient-language lookup means the identical thing for either: resolve the referenced Client's own
 * label/language. Kept as a closed set of ENTITY ids, never a `typeId` branch — the same "never key
 * off which document type this is" discipline every other generic mechanism in this module already
 * holds (see e.g. `stock/apply-stock-on-issuance.ts`'s own header for the identical argument made for
 * a different concern).
 */
const RECIPIENT_REFERENCE_ENTITIES = new Set(['client', 'supplier']);

/**
 * The 'reference' field this type uses to point at one of `RECIPIENT_REFERENCE_ENTITIES` above, if it
 * has one — the SINGLE source of the `{recipientName}` presence rule, shared by
 * `buildEmailTemplateParts` (which fills the value in for a real send) and
 * `describeDocumentEmailVocabulary` (which advertises the key to an editor). Exported so
 * `rendering/render-instance-pdf.ts` can reuse the exact same rule a THIRD time, to find the
 * document's own recipient id for recipient-language resolution
 * (`rendering/language/resolve-recipient-language.ts`) — one rule, three readers, so a type can never
 * be offered a placeholder the send would then treat as unknown, and can never have its language
 * resolved from a field this module wouldn't otherwise recognize as "the recipient".
 *
 * Widening this from "client" only to also "supplier" (TODO_FEATURES.md rank 19) has one small,
 * accepted side effect: `received-invoice`'s own settings-screen email-template preview now also
 * advertises `{recipientName}` as an available placeholder, even though that type never actually
 * sends anything (`received-invoice.descriptor.ts` declares no `email` at all) — harmless, since a
 * placeholder nothing ever substitutes is simply never reached, and keying this by ENTITY rather than
 * by `typeId` is what keeps this rule generic for the type that DOES need it (purchase-order).
 */
export function findClientReferenceField(
  descriptor: DocumentTypeDescriptor,
): DocumentFieldDescriptor | undefined {
  return descriptor.fields.find(
    (field) => field.kind === 'reference' && !!field.entity && RECIPIENT_REFERENCE_ENTITIES.has(field.entity),
  );
}

/**
 * The fixed vocabulary `renderEmailTemplate` fills in for a document SEND — `displayNumber`,
 * `typeLabel`, `companyName`, `totalGross` are ALWAYS present (empty string where there is genuinely
 * nothing to show, e.g. an unnumbered type's `displayNumber`); `recipientName` is present ONLY when
 * this document type has a 'reference' field targeting the "client" entity AND that field's value
 * resolved to a label (see rendering/render-instance-pdf.ts's own `referenceLabels`) — "s'il existe",
 * literally: a type with no such field (credit-note's `invoice`, expense's none) or an unresolved
 * reference simply never gets the key, which is what makes a template that still writes
 * `{recipientName}` for one of those types an UNKNOWN placeholder (warned, not silently blank) rather
 * than a confusingly empty greeting.
 */
export function buildEmailTemplateParts(input: {
  descriptor: DocumentTypeDescriptor;
  displayNumber: string | null | undefined;
  companyName: string;
  totals: DocumentTotals;
  referenceLabels: Record<string, string>;
}): Record<string, string> {
  const parts: Record<string, string> = {
    displayNumber: input.displayNumber ?? '',
    typeLabel: input.descriptor.label,
    companyName: input.companyName,
    totalGross: formatGrossTotal(input.totals),
  };

  const clientField = findClientReferenceField(input.descriptor);
  const recipientName = clientField ? input.referenceLabels[clientField.key] : undefined;
  if (recipientName) {
    parts.recipientName = recipientName;
  }

  return parts;
}

/**
 * What an EDITOR may write for one document type: every placeholder that type genuinely has, mapped to
 * a SAMPLE value. One shape serves both jobs the legacy settings screen already used it for — the
 * "available variables" hint (the keys) and a live preview (the values).
 *
 * Derived from the descriptor, never a hand-kept list per type, and deliberately NARROWER than
 * `buildEmailTemplateParts` above in exactly two places, for two different reasons:
 *  - `recipientName`: same rule, same helper (`findClientReferenceField`) — a type with no client-ish
 *    reference field is never offered it, which is what keeps the editor's advertised vocabulary and
 *    the send's real vocabulary from ever disagreeing.
 *  - `totalGross`: offered only when the type has a real source of money at all
 *    (`descriptorHasLineTotals`). A credit note or an expense totals zero BY CONSTRUCTION (see that
 *    predicate's own header), so advertising the placeholder would be advertising a permanent "0.00".
 *    A template that writes it anyway still renders that number — the send's vocabulary is unchanged,
 *    so no already-stored template starts warning because this list is narrower.
 */
export function describeDocumentEmailVocabulary(input: {
  descriptor: DocumentTypeDescriptor;
  companyName: string;
}): Record<string, string> {
  const { descriptor, companyName } = input;

  const vocabulary: Record<string, string> = {
    displayNumber: `${descriptor.id.toUpperCase()}-2026-0001`,
    typeLabel: descriptor.label,
    companyName,
  };

  if (descriptorHasLineTotals(descriptor)) {
    vocabulary.totalGross = SAMPLE_TOTAL_GROSS;
  }
  if (findClientReferenceField(descriptor)) {
    vocabulary.recipientName = SAMPLE_RECIPIENT_NAME;
  }

  return vocabulary;
}

const SAMPLE_TOTAL_GROSS = '1200.00 EUR';
const SAMPLE_RECIPIENT_NAME = 'Acme Ltd';

/**
 * Every placeholder a real SEND can substitute for this type — i.e. exactly the key set
 * `buildEmailTemplateParts` produces, with sample values so a candidate template can be rendered
 * against it.
 *
 * This, NOT `describeDocumentEmailVocabulary`, is what a template should be VALIDATED against: a
 * warning must mean "the send would leave this token written out in the email", never merely "the editor
 * does not offer this token". The two differ in exactly one place — `totalGross`, which every send
 * substitutes but which is only worth OFFERING for a type that has real money (see that function's own
 * header) — and the gap is deliberate: credit-note's own shipped default writes `{totalGross}`, and
 * saving it must not produce a warning about a placeholder that will in fact be filled in.
 */
export function describeSendablePlaceholders(input: {
  descriptor: DocumentTypeDescriptor;
  companyName: string;
}): Record<string, string> {
  return { totalGross: SAMPLE_TOTAL_GROSS, ...describeDocumentEmailVocabulary(input) };
}

/**
 * The vocabulary of the SIGNATURE-REQUEST email (`documents/signatures/signatures.service.ts`) — the
 * same mechanism `buildEmailTemplateParts` is for a document send, kept next to it so every family's
 * vocabulary is built by a function rather than duplicated as a literal list in the sender, in the
 * settings read, and in a test.
 *
 * `signatureUrl` carries the RAW signature token (the link the recipient must actually click — see
 * that service's own header on why the token, never the row id, is what travels); `signatureId` is the
 * row's own id, offered because the shipped template shows it as a human reference.
 */
export function buildSignatureRequestEmailParts(input: {
  appUrl: string;
  signatureUrl: string;
  signatureId: string;
  signatureNumber: string;
}): Record<string, string> {
  return {
    appUrl: input.appUrl,
    signatureUrl: input.signatureUrl,
    signatureId: input.signatureId,
    signatureNumber: input.signatureNumber,
  };
}

/**
 * The vocabulary of the VERIFICATION-CODE email — `otpCode` is the DISPLAY form ("1234-5678"), which is
 * purely cosmetic: what gets hashed and compared is always the raw 8-digit string
 * (`documents/signatures/otp.ts`). Nothing in this engine ever sees, or could leak, the stored hash.
 */
export function buildOtpEmailParts(input: { appUrl: string; otpCode: string }): Record<string, string> {
  return { appUrl: input.appUrl, otpCode: input.otpCode };
}
