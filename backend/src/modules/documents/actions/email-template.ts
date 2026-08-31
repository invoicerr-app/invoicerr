import { decimalsFor, fromMinor } from '@/utils/financial';

import { DocumentEmailTemplate, DocumentTypeDescriptor } from '../descriptors/types';
import { DocumentTotals } from '../totals/compute-totals';

export type { DocumentEmailTemplate };

export interface RenderedEmailTemplate {
  subject: string;
  body: string;
  /** Human-readable, one per DISTINCT unknown placeholder — see `renderEmailTemplate`'s own header. */
  warnings: string[];
}

const PLACEHOLDER_PATTERN = /\{([a-zA-Z0-9_]+)\}/g;

/**
 * Pure interpolation: replaces every `{key}` in `template.subject`/`template.body` with `parts[key]`
 * when `key` is a property of `parts` — including when its value is `''` (a legitimately empty, but
 * KNOWN, placeholder, e.g. an unnumbered document's `{displayNumber}` — see `buildEmailTemplateParts`).
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
 * of a typo in a subject line.
 */
export function renderEmailTemplate(
  template: DocumentEmailTemplate,
  parts: Record<string, string>,
): RenderedEmailTemplate {
  const unknown = new Set<string>();

  const interpolate = (text: string): string =>
    text.replace(PLACEHOLDER_PATTERN, (literal, key: string) => {
      if (Object.hasOwn(parts, key)) {
        return parts[key];
      }
      unknown.add(key);
      return literal;
    });

  const subject = interpolate(template.subject);
  const body = interpolate(template.body);
  const warnings = [...unknown].map((key) => `Unknown email template placeholder "{${key}}" left as-is.`);

  return { subject, body, warnings };
}

/**
 * The GENERIC, minimal fallback for a document type that declares NO `email` template of its own
 * (DocumentTypeDescriptor.email) and whose company has no override either — reachable only for a
 * THIRD-PARTY type today, since every type shipped in this trunk (quote/invoice/credit-note/expense)
 * declares its own (see each descriptor's own comment). Visible IN CODE, deliberately, rather than a
 * default parameter buried inside `resolveEmailTemplate` below — the task this was built for is
 * explicit that a missing template must be an obvious fact a reader of this file can see, not a
 * silently-applied default nobody wrote down.
 */
export const GENERIC_FALLBACK_EMAIL_TEMPLATE: DocumentEmailTemplate = {
  subject: '{typeLabel} {displayNumber}',
  body: 'Please find attached {typeLabel} {displayNumber}.',
};

/**
 * Which template actually applies for `descriptor`, given the active company's OWN overrides
 * (`Company.documentEmailTemplates`, keyed by `DocumentTypeDescriptor.id` — see
 * actions/company-email-templates.ts for how that column is read). Priority, highest first:
 *  1. the company's own override for this type, if it set one;
 *  2. the type's own descriptor default (`descriptor.email`);
 *  3. `GENERIC_FALLBACK_EMAIL_TEMPLATE` above — every shipped type has (2), so this is reachable only
 *     for a type this trunk did not declare one for.
 */
export function resolveEmailTemplate(
  descriptor: DocumentTypeDescriptor,
  companyOverrides: Record<string, DocumentEmailTemplate> | null | undefined,
): DocumentEmailTemplate {
  const override = companyOverrides?.[descriptor.id];
  if (override) return override;
  if (descriptor.email) return descriptor.email;
  return GENERIC_FALLBACK_EMAIL_TEMPLATE;
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

  const clientField = input.descriptor.fields.find(
    (field) => field.kind === 'reference' && field.entity === 'client',
  );
  const recipientName = clientField ? input.referenceLabels[clientField.key] : undefined;
  if (recipientName) {
    parts.recipientName = recipientName;
  }

  return parts;
}
