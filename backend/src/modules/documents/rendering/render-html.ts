import { DocumentTypeDescriptor, DocumentFieldDescriptor } from '../descriptors/types';
import { numberingDisplayState } from '../numbering/display-state';
import { decimalsFor, fromMinor } from '@/utils/financial';
import type { PaymentMethodPresentation } from '../payment-methods/types';
import type { DocumentTotals } from '../totals/compute-totals';
import { fontFaceCssFor, fontStackFor } from './branding/font-catalog';
import { pdfChromeStrings, PdfChromeStrings } from './language/pdf-chrome-strings';
import { DEFAULT_RENDER_LANGUAGE, RenderLanguage } from './language/supported-languages';

/** The EXACT pre-branding values (chantier B, 2026-09-15) — what every render used unconditionally
 *  before `RenderDocumentHtmlInput.branding` existed, and what a company with no branding set still
 *  gets, verbatim: see `renderDocumentHtml`'s own header for the byte-for-byte guarantee this pair
 *  exists to uphold. Never read anywhere else — `fontStackFor`/an explicit `accentColor` are the only
 *  two ways to override either. */
const DEFAULT_ACCENT_COLOR = '#007bff';
const DEFAULT_BODY_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/**
 * Escapes HTML special characters — applied to ALL values from data to prevent injection.
 */
function escapeHtml(value: string): string {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

// Fallback for Node.js environment where document doesn't exist
export function escapeHtmlNode(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeHtmlSafe(value: string): string {
  try {
    return escapeHtml(value);
  } catch {
    return escapeHtmlNode(value);
  }
}

/** The SAME emptiness test `hideWhenEmpty`'s top-level check (further below) and
 *  `validate.ts#isMissing` both already use — undefined/null/'' only, so a legitimately falsy value
 *  (0, false) is never treated as empty. Named and exported from neither: this is the one place an
 *  'array' row needs it too (see the 'array' case's own subfield-column filter, just below), so it
 *  is a local helper shared by both call sites in THIS file rather than duplicated inline twice. */
function isEmptyFieldValue(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

/**
 * Render a single field's value as HTML, by kind. Returns the HTML representation of the value,
 * or a visible error marker for unknown kinds.
 */
function renderFieldValue(
  field: DocumentFieldDescriptor,
  value: unknown,
  referenceLabels: Record<string, string>,
  data: Record<string, unknown>,
  strings: PdfChromeStrings,
): string {
  // Value is missing — render em-dash
  if (value === undefined || value === null || value === '') {
    return '—';
  }

  switch (field.kind) {
    case 'text': {
      const stringValue = String(value);
      return escapeHtmlSafe(stringValue);
    }

    case 'longText': {
      const stringValue = String(value);
      return `<pre style="white-space: pre-wrap; word-wrap: break-word;">${escapeHtmlSafe(stringValue)}</pre>`;
    }

    case 'number': {
      return escapeHtmlSafe(String(value));
    }

    case 'money': {
      const currency = field.currencyField ? String(data[field.currencyField] ?? '') : field.currency;
      const amount = typeof value === 'number' ? value : Number(value);
      if (Number.isNaN(amount)) {
        return escapeHtmlSafe(String(value));
      }
      const decimals = decimalsFor(currency ?? '');
      const formatted = amount.toFixed(decimals);
      return `${escapeHtmlSafe(formatted)} ${escapeHtmlSafe(currency ?? '')}`;
    }

    case 'date': {
      // Escaped UNCONDITIONALLY, like every other kind here — never "only when the string fails to
      // parse as a date". A value that parses is not thereby a YYYY-MM-DD string with a safe
      // character set: the 'date' kind's own validator (descriptors/field-kinds.ts) accepts whatever
      // `Date.parse` accepts, and V8's legacy parser accepts a trailing parenthesized comment (the
      // one `Date.prototype.toString()` emits) holding arbitrary text. Trusting a parsed date let
      // that text through as raw markup, into a page this module hands to a Chromium launched with
      // `--no-sandbox` (see render-pdf.ts#launchBrowser) and reachable anonymously through a public
      // share link — so what renders here decides whether submitted data can run as script inside
      // the backend's own network. Escape first; there is no formatting to preserve, this returns
      // the stored string either way.
      return escapeHtmlSafe(String(value));
    }

    case 'boolean': {
      return value ? strings.yes : strings.no;
    }

    case 'select': {
      const option = field.options?.find((o) => o.value === String(value));
      return escapeHtmlSafe(option?.label ?? String(value));
    }

    case 'reference': {
      // field.key -> referenceLabels lookup
      const label = referenceLabels[field.key];
      if (label) {
        return escapeHtmlSafe(label);
      }
      return escapeHtmlSafe(String(value));
    }

    case 'array': {
      const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
      if (rows.length === 0) {
        return '—';
      }
      // 'hiddenReference' subfields (e.g. a line's `articleId`) are excluded
      // BEFORE the header/body loops below even run — not via `hideWhenEmpty`'s "skip a per-row cell
      // that happens to be empty" check (this loop never applies that hint to subfields at all, and a
      // populated `articleId` is exactly the case that must still never print), so there is neither a
      // header column nor a per-row cell for one, ever, regardless of value. See types.ts's own
      // `entity` doc comment ("ALSO the target hint for 'hiddenReference'") for the full rationale.
      //
      // A SECOND, narrower filter follows: a subfield that opts into `hideWhenEmpty` (e.g. the
      // invoice/quote line's own `date` — invoice.descriptor.ts) gets NO COLUMN AT ALL — not merely
      // an empty cell — when EVERY row in THIS document leaves it unset. This is what keeps a
      // document saved before such a field existed rendering byte-for-byte as it always did: an old
      // `lines` array has no row with the key at all, so the column never appears, exactly as if the
      // field had never been declared. The moment ANY row in the document sets a value, the column
      // appears for every row — a row that still lacks it prints the ordinary em-dash placeholder,
      // never a broken or ragged table. A subfield that does NOT opt in keeps the universal
      // always-a-column behavior unchanged, same as every top-level field's own `hideWhenEmpty`.
      const subFields = (field.fields ?? [])
        .filter((subField) => subField.kind !== 'hiddenReference')
        .filter(
          (subField) => !subField.hideWhenEmpty || rows.some((row) => !isEmptyFieldValue(row[subField.key])),
        );
      let html = '<table style="border-collapse: collapse; width: 100%; margin-top: 8px;">';
      // Header
      html += '<thead><tr style="border-bottom: 1px solid #ccc;">';
      for (const subField of subFields) {
        html += `<th style="padding: 8px; text-align: left; font-weight: bold;">${escapeHtmlSafe(subField.label)}</th>`;
      }
      html += '</tr></thead>';
      // Body
      html += '<tbody>';
      for (const row of rows) {
        html += '<tr style="border-bottom: 1px solid #eee;">';
        for (const subField of subFields) {
          const cellValue = renderFieldValue(subField, row[subField.key], referenceLabels, row, strings);
          html += `<td style="padding: 8px;">${cellValue}</td>`;
        }
        html += '</tr>';
      }
      html += '</tbody></table>';
      return html;
    }

    case 'rowSelection': {
      const ids = Array.isArray(value) ? (value as string[]) : [];
      if (ids.length === 0) {
        return '—';
      }
      let html = '<ul style="margin: 8px 0 8px 20px;">';
      for (const id of ids) {
        html += `<li>${escapeHtmlSafe(id)}</li>`;
      }
      html += '</ul>';
      return html;
    }

    default: {
      // Unknown kind — visible marker that never hides
      return `[unrendered field kind &quot;${escapeHtmlSafe(field.kind)}&quot; for &quot;${escapeHtmlSafe(field.key)}&quot;]`;
    }
  }
}

/**
 * The net/VAT-breakdown/gross/warnings ROWS shared by the ordinary single totals section AND, since
 * issue #373 ("quotes with options"), each per-option group's own mini totals block below - extracted
 * so the two never drift apart on rounding, VAT-aggregation, or the `showVat` rule (see
 * `DocumentTotals.showVat`'s own header, compute-totals.ts). Returns the INNER rows only, not the
 * outer `.totals-section`/label wrapper - callers differ on that (the global section gets its own
 * heading; a group gets one heading for the whole option, not a second "Totals" label repeated inside
 * it), so wrapping stays each caller's own job.
 */
function renderTotalsRows(
  totals: DocumentTotals,
  strings: PdfChromeStrings,
  // Issue #373 follow-up ("no meaningless common total") - true only for a REAL option's own block,
  // and only when a common group exists alongside it (`renderOptionGroupsField`'s own call site):
  // swaps the gross row's label for `strings.totalIncludingCommonLines` so a reader can tell this
  // figure already folds the common lines in, without the common group printing a total of its own
  // to point back at. Never true for the ordinary single-total section, or for a common group's own
  // (line-only) block, which no longer calls this function for its totals at all.
  totalLabelIncludesCommon = false,
): string {
  const currency = totals.currency || '—';
  const decimals = decimalsFor(currency);
  const showVat = totals.showVat !== false;

  let html = '';
  if (showVat) {
    const netDisplay = `${fromMinor(totals.netMinor, currency).toFixed(decimals)} ${currency}`;
    html += `
      <div class="totals-row">
        <span>${escapeHtmlSafe(strings.net)}</span>
        <span class="totals-amount">${escapeHtmlSafe(netDisplay)}</span>
      </div>
`;
    for (const entry of totals.vatBreakdown) {
      const baseDisplay = `${fromMinor(entry.baseMinor, currency).toFixed(decimals)} ${currency}`;
      const vatDisplay = `${fromMinor(entry.vatMinor, currency).toFixed(decimals)} ${currency}`;
      html += `
      <div class="totals-row">
        <span>${escapeHtmlSafe(strings.vatOn(entry.ratePercent.toString(), baseDisplay))}</span>
        <span class="totals-amount">${escapeHtmlSafe(vatDisplay)}</span>
      </div>
`;
    }
  }

  const grossDisplay = `${fromMinor(totals.grossMinor, currency).toFixed(decimals)} ${currency}`;
  const grossLabel = totalLabelIncludesCommon ? strings.totalIncludingCommonLines : strings.total;
  html += `
      <div class="totals-row summary">
        <span>${escapeHtmlSafe(grossLabel)}</span>
        <span class="totals-amount">${escapeHtmlSafe(grossDisplay)}</span>
      </div>
`;

  if (totals.warnings.length > 0) {
    html += `
      <div class="warnings-section">
`;
    for (const warning of totals.warnings) {
      html += `        <div class="warning-item">${escapeHtmlSafe(warning)}</div>\n`;
    }
    html += `      </div>\n`;
  }

  return html;
}

/**
 * Renders the "lines" array field as several grouped, labelled tables - one per option - instead of
 * the ordinary single flat table `renderFieldValue`'s 'array' case produces. Reuses that EXACT case
 * for each group's own table (by handing it a synthetic field descriptor whose `fields` drop the
 * grouping subfield itself - the option name is already the group's own heading, a redundant column
 * for it would repeat the same word on every single row): no separate table-rendering logic to keep in
 * sync with the ordinary one, which is also what makes an old document's own `hideWhenEmpty` column
 * rules (e.g. the quote line's `date`) apply identically inside a group as they do outside one.
 */
function renderOptionGroupsField(
  field: DocumentFieldDescriptor,
  value: unknown,
  optionGroups: NonNullable<RenderDocumentHtmlInput['optionGroups']>,
  referenceLabels: Record<string, string>,
  documentData: Record<string, unknown>,
  strings: PdfChromeStrings,
  // The company's own accent color (`renderDocumentHtml`'s own `accentColor` local) - applied INLINE
  // here rather than through a static CSS rule referencing it: a static rule would put the literal
  // color into the <style> block of EVERY document, options or not, which is exactly the "PDF
  // unchanged" byte-for-byte guarantee a 0/1-option quote (and every other document type) still holds
  // - see this file's own `renderDocumentHtml` header on `optionGroups`.
  accentColor: string,
): string {
  const allRows = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  const fieldWithoutGroupKey: DocumentFieldDescriptor = {
    ...field,
    fields: (field.fields ?? []).filter((subField) => subField.key !== optionGroups.groupFieldKey),
  };

  let html = '';
  for (const group of optionGroups.groups) {
    // Issue #373 follow-up ("common lines") - the ONE synthetic group `render-instance-pdf.ts` ever
    // builds with `isCommon: true`: its own rows are every line with NO `option` tag at all, never
    // matched by `row[groupFieldKey] === group.label` (an empty `label` would never equal a genuinely
    // untagged row's own empty string reliably across browsers' own trim/coercion quirks, so this is
    // matched explicitly instead). A REAL option's group still matches exactly as before - an empty
    // (never trimmed-to-empty) `option` value can never accidentally equal one of THOSE labels either,
    // since `deriveQuoteOptions` never derives an empty string as an option name.
    const groupRows = group.isCommon
      ? allRows.filter((row) => {
          const raw = row[optionGroups.groupFieldKey];
          return typeof raw !== 'string' || raw.trim() === '';
        })
      : allRows.filter((row) => {
          const raw = row[optionGroups.groupFieldKey];
          return typeof raw === 'string' && raw.trim() === group.label;
        });
    // The common group is never "the accepted option" - it was never a choice to begin with.
    const isAccepted = !group.isCommon && optionGroups.acceptedOption === group.label;
    const heading = group.isCommon ? strings.commonToAllOptionsHeading : escapeHtmlSafe(group.label);
    // Issue #373 follow-up ("no meaningless common total") - the common group prints its OWN lines
    // only, never a "Total" underneath them: that figure looked like a price the client could pay on
    // its own, when it is really only ever billed as part of whichever option is chosen. Each REAL
    // option's own totals block below still folds the common lines' amounts in exactly as before
    // (`group.totals` is already the MERGED figure, `computeQuoteOptionTotals`'s own header) - only
    // the label changes, to say so, whenever a common group exists at all alongside it.
    const hasCommonGroup = optionGroups.groups.some((g) => g.isCommon);
    const totalsBlock = group.isCommon
      ? ''
      : `
      <div class="totals-section">
${renderTotalsRows(group.totals, strings, hasCommonGroup)}
      </div>`;

    html += `
    <div class="option-group">
      <div class="option-group-heading" style="color: ${accentColor};">${heading}${
        isAccepted
          ? `<span class="accepted-badge">(${escapeHtmlSafe(strings.acceptedOptionBadge)})</span>`
          : ''
      }</div>
      <div class="field-value">${renderFieldValue(fieldWithoutGroupKey, groupRows, referenceLabels, documentData, strings)}</div>${totalsBlock}
    </div>
`;
  }
  return html;
}

/** One country-mandated mention to print in the footer block — see `RenderDocumentHtmlInput.legalMentions`.
 *  `legalRef` is deliberately UNUSED by the renderer below: it is carried so a reader of the DATA can
 *  check it, never surfaced on the document itself — the same convention
 *  `mentions/invoice-notes.ts#ResolvedInvoiceNote` already documents at its own source. */
export interface RenderableLegalMention {
  text: string;
  legalRef: string;
}

export interface RenderDocumentHtmlInput {
  descriptor: DocumentTypeDescriptor;
  instance: {
    id: string;
    status: string;
    data: Record<string, unknown>;
    createdAt: Date;
    /** See DocumentInstance's own schema comment and numbering/ — absent/null before the type's own
     *  `numbering.onEnterStatus` is first reached, or for a type that never declares `numbering` at
     *  all (e.g. "expense", "credit-note" — see their own descriptors). Optional so every existing
     *  caller/fixture that never mentions numbering keeps compiling unchanged. */
    displayNumber?: string | null;
    /** Portugal's ATCUD (`ATCUD:CodigodeValidação-NumeroSequencial`, Portaria n.º 195/2020, art. 4.º
     *  n.º 1) — frozen onto the instance the same moment `displayNumber` is (`actions/
     *  atcud-issuance.ts`). Absent/null for every document that is not a numbered Portuguese invoice.
     *  Printed once here, near the document number, for anyone reading this HTML directly; the "on
     *  EVERY page" legal requirement (art. 4.º n.º 3) is instead satisfied by a REPEATING PDF footer —
     *  see `render-pdf.ts#RenderPdfOptions.footerText` and `render-instance-pdf.ts`, which is the only
     *  caller that ever fills this same string into both places. */
    atcud?: string | null;
  };
  /**
   * Issue #494: whether the header prints the "Status: <status>" line at all. Decided by the caller
   * (`render-instance-pdf.ts`, through `status-line-policy.ts`), never here: this pure function does
   * not know whether it is rendering a working copy or the copy a client keeps. Absent means printed,
   * so every caller that never asked (the branding preview, dozens of specs) keeps its exact bytes.
   */
  printStatus?: boolean;
  company: {
    name: string;
    address?: string | null;
    city?: string | null;
    postalCode?: string | null;
    country?: string | null;
  };
  referenceLabels: Record<string, string>;
  totals?: DocumentTotals;
  /**
   * Issue #373 ("quotes with options") - when the quote offers 2+ options
   * (`options/quote-options.ts#computeQuoteOptionTotals`), the caller passes THIS instead of `totals`,
   * never both: a quote with several options prints NO global total (summing them together would be
   * exactly the meaningless number this issue exists to stop printing) - see this file's own
   * `renderDocumentHtml`, which renders each group as its own labelled table with its own totals, in
   * place of the ordinary single `lines` table + global totals section. `arrayFieldKey`/`groupFieldKey`
   * name which array field and which of ITS OWN subfields to group by ("lines"/"option" for the quote
   * today) - kept as data, not hardcoded to "quote", the same "a descriptor is data" discipline this
   * whole render layer already holds, even though only the quote descriptor declares an `option`
   * subfield today. Absent (every OTHER document type, and a quote with fewer than two options) means
   * exactly what it always meant before this field existed: the ordinary single-table, single-totals
   * render, byte-for-byte.
   */
  optionGroups?: {
    arrayFieldKey: string;
    groupFieldKey: string;
    /** The option currently recorded as ACCEPTED (`DocumentInstance.acceptedOption`), so its own group
     *  gets the "Accepted" badge - null/undefined (not yet chosen, still "draft"/"sent") marks none. */
    acceptedOption?: string | null;
    /**
     * One entry per real option, PLUS an optional leading entry for the lines nobody tagged at all
     * (`options/quote-options.ts#computeCommonLineTotals`) - `isCommon: true` on that one entry only.
     * `label` is ignored for it (the heading comes from `PdfChromeStrings.commonToAllOptionsHeading`
     * instead, so it is translated like every other chrome string this render layer owns); its rows
     * are matched by "no `option` tag at all", never by label equality - see
     * `renderOptionGroupsField`'s own header. It never gets the "Accepted" badge (a common line was
     * never itself a choice) and its OWN totals are purely informational: each REAL option's own
     * totals already fold the common contribution in (`computeQuoteOptionTotals`'s own header), so
     * this group exists only so a reader can see where that contribution came from.
     */
    groups: { label: string; totals: DocumentTotals; isCommon?: boolean }[];
  };
  /**
   * The mentions to print in their OWN footer block, resolved by the caller (`render-instance-pdf.ts`'s
   * `legalMentionsFor`, gated on `descriptor.usesLegalMentions`): the country-mandated ones (from the
   * seller's country and this instance's own issue date) FOLLOWED by the tax engine's own
   * `__crossBorderMentions` sidecar, when this instance has one (a cross-border invoice, or a domestic
   * invoice from a seller under a non-STANDARD tax scheme — see that function's own comment). Absent
   * or empty prints NO block at all — not an empty framed section, nothing (see this file's
   * own `renderDocumentHtml`) — so a country with no mentions, or a document type that never opts
   * in, produces byte-for-byte the same HTML this function always produced.
   *
   * Deliberately a SEPARATE parameter from the descriptor's own `fields` loop below, never folded
   * into the document's user-editable `notes` field: mixing the two would let a user delete or edit
   * a mention whose absence is an administrative offence — this is a fact about a JURISDICTION, not
   * about this one document instance.
   */
  legalMentions?: RenderableLegalMention[];
  /**
   * "QR SEPA / GiroCode" — the pre-rendered EPC069-12 QR bitmap (already a
   * `data:image/png;base64,...` URI, from `sepa-qr.ts#renderSepaQrDataUri`) to print near the totals,
   * so the payer can scan it straight from the PDF. A TOP-LEVEL input, deliberately not folded into
   * `company` above: unlike the company's own address, this is not a fact ABOUT the company, it is the
   * outcome of gating THIS document instance's own currency/amount/type (see `render-instance-pdf.ts`'s
   * `sepaPaymentQrFor`, the only caller that ever fills this in). Absent prints NO block at all — same
   * "nothing, not an empty frame" discipline `legalMentions` above already holds — so a document with
   * no IBAN on file, a non-EUR currency, a zero/negative total, or a type that never opts in
   * (`descriptor.usesPaymentQr`) renders byte-for-byte the same HTML this function always produced.
   */
  paymentQr?: { dataUri: string };
  /**
   * "Payment methods" — every ENABLED payment method's own presentation
   * (payment-methods/persistence.ts#resolveEnabledPaymentMethodPresentations, gated by the caller on
   * `descriptor.usesPaymentMethods` — see that flag's own header in descriptors/types.ts). A TOP-LEVEL
   * input, the same reasoning `paymentQr` right above already gives: this is the outcome of resolving
   * THIS company's own configuration against THIS document's own amount/currency, not a fact about the
   * company header block. Absent OR EMPTY prints NO block at all — the same "nothing, not an empty
   * frame" discipline `paymentQr`/`legalMentions` already hold, so a company with no method enabled
   * yet, or a document type that never opts in, renders byte-for-byte the same HTML this function
   * always produced.
   */
  paymentMethods?: PaymentMethodPresentation[];
  /**
   * Custom fields — the company's OWN custom fields that
   * actually carry a value on THIS instance, resolved by the caller
   * (`render-instance-pdf.ts#companyCustomFieldsFor`) from `company-custom-fields/`. Deliberately its
   * OWN top-level block, never merged into the ordinary `descriptor.fields` loop above: the feature's
   * own spec calls for a single "additional fields" section at the END of the document, not scattered
   * insertions among the type's native fields — the same "a dedicated block, not a free insertion"
   * decision `legalMentions` already models for a different, country-mandated concern. Absent or
   * empty prints NO block at all — the same "nothing, not an empty frame" discipline every other
   * optional block on this page already holds, so a document whose company has defined no custom
   * field (or filled none in) renders byte-for-byte the same HTML it always did.
   *
   * Carries the RAW descriptor + value pair (not a pre-formatted string): the block below runs each
   * one through this file's own `renderFieldValue`, the exact same per-KIND formatter (money/date/
   * boolean/select, …) the main fields loop above already uses, rather than a second, divergent
   * formatting path the caller (`render-instance-pdf.ts#companyCustomFieldsFor`) would have to keep
   * in sync with this one by hand.
   */
  customFields?: { field: DocumentFieldDescriptor; value: unknown }[];
  /**
   * Per-recipient document language — which language this render's
   * OWN chrome vocabulary (`language/pdf-chrome-strings.ts`: "Status", "Totals", "VAT … on …", …) is
   * printed in. Resolved by the caller (`render-instance-pdf.ts`, from the document's own client and
   * the company's default — see `language/resolve-recipient-language.ts`), never guessed here.
   *
   * Absent defaults to `DEFAULT_RENDER_LANGUAGE` ('en') rather than being required: every pre-existing
   * caller of this function (dozens of specs, plus any third-party code built against this signature
   * before this feature existed) keeps producing byte-for-byte the same English chrome it always did,
   * without having to learn about a language it never asked for. This does NOT extend to
   * `descriptor.label`/`field.label`/`option.label` — those stay exactly what the descriptor wrote,
   * whatever language that is (see `descriptors/types.ts`'s own comment on `label`: "plain data, not
   * an i18n key").
   */
  language?: RenderLanguage;
  /**
   * Chantier B (2026-09-15 product decision) — the company's OWN document
   * branding, resolved by the caller (`render-instance-pdf.ts`) from `Company.brandingAccentColor`/
   * `brandingFont`/`brandingLogoId`. The PDF itself stays a FIXED document — no user-editable HTML or
   * template, ever; this is three presentation values applied over the one hardcoded layout below,
   * the same "a country is data" discipline this codebase already holds elsewhere, turned toward
   * typography/color instead of law.
   *
   * Absent, or every field inside it absent/null, renders BYTE-FOR-BYTE the same HTML this function
   * always produced — `render-html.spec.ts`'s own non-regression test pins exactly that. Each field
   * degrades independently: an unrecognized `font` key (a stale value from a since-shrunk catalog)
   * falls back to the system stack exactly like an absent one, never a broken `font-family`; a missing
   * `logoDataUri` prints no logo block at all, not an empty frame — the same "nothing, not an empty
   * frame" discipline `legalMentions`/`paymentQr` above already hold for their own absent case.
   */
  branding?: {
    /** Hex `#rrggbb`, validated by `company/branding/branding.service.ts` before it ever reaches
     *  here — this function trusts it verbatim and applies it to the four rules that used to
     *  hardcode `#007bff` (the header rule, field labels, totals label, custom-fields heading). */
    accentColor?: string | null;
    /** A `branding/font-catalog.ts` key. */
    font?: string | null;
    /** Already a `data:image/...;base64,...` URI — resolved by the caller, never fetched by this
     *  pure function itself (the same discipline `paymentQr`'s own header documents for its own
     *  pre-rendered image). */
    logoDataUri?: string | null;
  };
}

/**
 * Pure function: renders a document as self-contained HTML with inline styles.
 * Never relies on external CSS or fonts — everything is inline.
 */
export function renderDocumentHtml(input: RenderDocumentHtmlInput): string {
  const { descriptor, instance, company, referenceLabels } = input;
  const strings = pdfChromeStrings(input.language ?? DEFAULT_RENDER_LANGUAGE);

  const createdDate = new Date(instance.createdAt).toISOString().split('T')[0];

  // Chantier B — see `RenderDocumentHtmlInput.branding`'s own header for the byte-for-byte guarantee
  // every one of these three defaults exists to uphold when `input.branding` (or a given field on it)
  // is absent.
  const accentColor = input.branding?.accentColor || DEFAULT_ACCENT_COLOR;
  const bodyFontStack = fontStackFor(input.branding?.font) ?? DEFAULT_BODY_FONT_STACK;
  const fontFaceCss = fontFaceCssFor(input.branding?.font);
  // A trailing `\n  ` (matching this file's own indentation) ONLY when non-empty, so splicing this
  // right after the main `</style>` below adds nothing at all — not even a blank line — for the
  // default, unbranded case.
  const fontFaceStyleBlock = fontFaceCss ? `\n  <style>${fontFaceCss}</style>` : '';
  const logoDataUri = input.branding?.logoDataUri || null;
  // Same "adds nothing at all when absent" discipline as `fontFaceStyleBlock` above — see this
  // block's own splice point in the header markup below.
  const logoBlockHtml = logoDataUri
    ? `<img src="${escapeHtmlSafe(logoDataUri)}" alt="" style="max-height:64px;max-width:240px;margin-bottom:12px;display:block;">\n      `
    : '';

  let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${escapeHtmlSafe(descriptor.label)}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: ${bodyFontStack};
      line-height: 1.6;
      color: #333;
      background: white;
      padding: 20px;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      background: white;
    }
    .header {
      border-bottom: 2px solid ${accentColor};
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .company-info {
      margin-bottom: 16px;
    }
    .company-name {
      font-size: 18px;
      font-weight: bold;
      margin-bottom: 4px;
    }
    .company-address {
      font-size: 13px;
      color: #666;
    }
    .document-title {
      font-size: 24px;
      font-weight: bold;
      margin: 16px 0 8px 0;
    }
    .document-number {
      font-size: 15px;
      color: #555;
      margin-bottom: 8px;
    }
    .document-atcud {
      font-size: 12px;
      color: #555;
      margin-bottom: 8px;
      font-family: monospace;
    }
    .document-meta {
      display: flex;
      gap: 32px;
      font-size: 13px;
      color: #666;
      margin-top: 12px;
    }
    .field-row {
      margin-bottom: 20px;
      padding: 12px;
      background: #f9f9f9;
      border-radius: 4px;
    }
    .field-label {
      font-weight: bold;
      font-size: 13px;
      color: ${accentColor};
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }
    .field-value {
      font-size: 14px;
      color: #333;
      word-break: break-word;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin-top: 8px;
    }
    thead tr {
      background: #f0f0f0;
      border-bottom: 2px solid #ddd;
    }
    th {
      padding: 8px;
      text-align: left;
      font-weight: bold;
      font-size: 12px;
    }
    tbody tr {
      border-bottom: 1px solid #eee;
    }
    td {
      padding: 8px;
      font-size: 13px;
    }
    pre {
      white-space: pre-wrap;
      word-wrap: break-word;
      font-family: monospace;
      font-size: 12px;
      background: #f5f5f5;
      padding: 8px;
      border-radius: 4px;
      overflow-x: auto;
    }
    ul {
      margin: 8px 0 8px 20px;
    }
    li {
      margin-bottom: 4px;
    }
    .totals-section {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 2px solid #ddd;
    }
    .totals-label {
      font-weight: bold;
      font-size: 13px;
      color: ${accentColor};
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
    }
    .totals-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      font-size: 14px;
      border-bottom: 1px solid #eee;
    }
    .totals-row.summary {
      font-weight: bold;
      border-bottom: 2px solid #333;
      margin-top: 8px;
      padding-top: 12px;
    }
    .totals-amount {
      text-align: right;
      min-width: 120px;
    }
    .option-group {
      margin-top: 24px;
    }
    .option-group-heading {
      font-weight: bold;
      font-size: 14px;
      margin-bottom: 4px;
    }
    .option-group-heading .accepted-badge {
      font-weight: normal;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-left: 8px;
    }
    .warnings-section {
      margin-top: 16px;
      padding: 8px;
      background: #fff9f0;
      border-left: 3px solid #ff9800;
      border-radius: 2px;
    }
    .warning-item {
      font-size: 11px;
      color: #e65100;
      margin-bottom: 4px;
    }
    .legal-mentions {
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid #ddd;
    }
    .legal-mention-item {
      font-size: 11px;
      color: #555;
      margin-bottom: 4px;
    }
    .custom-fields-section {
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid #ddd;
    }
    .custom-fields-heading {
      font-weight: bold;
      font-size: 13px;
      color: ${accentColor};
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
    }
    .custom-field-item {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      font-size: 13px;
      padding: 4px 0;
    }
    .custom-field-label {
      color: #666;
    }
    .payment-qr-section {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-top: 16px;
      padding: 12px;
      background: #f9f9f9;
      border-radius: 4px;
    }
    .payment-qr-image {
      width: 130px;
      height: 130px;
    }
    .payment-qr-label {
      font-size: 12px;
      color: #555;
    }
    .payment-methods-section {
      margin-top: 16px;
      padding: 12px;
      background: #f9f9f9;
      border-radius: 4px;
    }
    .payment-methods-heading {
      font-size: 12px;
      font-weight: bold;
      color: #333;
      margin-bottom: 8px;
    }
    .payment-method-item {
      margin-bottom: 8px;
    }
    .payment-method-item:last-child {
      margin-bottom: 0;
    }
    .payment-method-label {
      font-size: 12px;
      font-weight: bold;
      color: #333;
    }
    .payment-method-line {
      font-size: 11px;
      color: #555;
    }
    .payment-method-link {
      font-size: 11px;
      color: #1a5fb4;
      word-break: break-all;
    }
  </style>${fontFaceStyleBlock}
</head>
<body>
  <div class="container">
    <div class="header">
      ${logoBlockHtml}<div class="company-info">
        <div class="company-name">${escapeHtmlSafe(company.name)}</div>
        <div class="company-address">
          ${company.address ? escapeHtmlSafe(company.address) : ''}
          ${company.postalCode ? escapeHtmlSafe(company.postalCode) : ''}
          ${company.city ? escapeHtmlSafe(company.city) : ''}
          ${company.country ? escapeHtmlSafe(company.country) : ''}
        </div>
      </div>
      <div class="document-title">${escapeHtmlSafe(descriptor.label)}</div>
      ${
        descriptor.numbering
          ? `<div class="document-number">${escapeHtmlSafe(
              instance.displayNumber ??
                // PR #473 review point 3: this USED to read `isNumberingAllowedFrom` directly, which
                // answers a different question ("would this status be allowed to number on ITS OWN
                // next transition") and, for a type with no `numbering.onlyFrom` (quote, invoice,
                // purchase order, goods receipt), returns true for EVERY status - so a document stuck
                // "sending" without a number (the race review point 1 of this PR closes) printed
                // "Draft, no number yet" here while the screen already showed "Issued without a
                // number" for the SAME record, directly contradicting this file's own promise that the
                // two must never disagree. `numberingDisplayState` (numbering/display-state.ts) is now
                // the ONE rule both this PDF and the frontend's own `numberingDisplayState`
                // (types.ts) compute from - see that file's own header for why it is a mirrored
                // formula, not literal shared code, across the backend/frontend boundary.
                (numberingDisplayState(descriptor, instance) === 'awaiting'
                  ? strings.draftNoNumberYet
                  : strings.issuedWithoutNumber),
            )}</div>`
          : ''
      }
      ${instance.atcud ? `<div class="document-atcud">${escapeHtmlSafe(instance.atcud)}</div>` : ''}
      <div class="document-meta">
        ${
          input.printStatus === false
            ? ''
            : `<div><strong>${escapeHtmlSafe(strings.status)}:</strong> ${escapeHtmlSafe(instance.status)}</div>`
        }
        <div><strong>${escapeHtmlSafe(strings.date)}:</strong> ${escapeHtmlSafe(createdDate)}</div>
      </div>
    </div>
`;

  // Render each field
  for (const field of descriptor.fields) {
    // 'hiddenReference' is not merely `hideWhenEmpty` — it never gets a row
    // AT ALL, set or not (see types.ts's own `entity` doc comment for why a dedicated kind, not a
    // flag, was chosen). No top-level field is one today (only a line's own `articleId` is), but this
    // guard holds the SAME "never printed" contract if one ever is, exactly like the 'array' case's
    // own subfield filter just above holds it for a nested row.
    if (field.kind === 'hiddenReference') {
      continue;
    }

    const value = instance.data[field.key];

    // See `DocumentFieldDescriptor.hideWhenEmpty`'s own header (types.ts) — an opt-in escape from the
    // otherwise-universal "every field gets a row, even an empty one shows a '—' placeholder" rule
    // right below. Checked with the SAME emptiness test `validate.ts#isMissing` uses for required-ness
    // (undefined/null/'' — a 0 or `false` value is NOT empty), so a field that legitimately holds a
    // falsy value is never hidden by mistake.
    if (field.hideWhenEmpty && (value === undefined || value === null || value === '')) {
      continue;
    }

    // Issue #373 ("quotes with options") - the array field this document's own `optionGroups` names
    // (the quote's "lines") is rendered as several grouped, labelled tables (below), never through the
    // ordinary single-table `renderFieldValue` path: a flat table would mix every option's lines
    // together with no indication which total each one belongs to, exactly the confusion this feature
    // exists to remove.
    if (input.optionGroups && field.key === input.optionGroups.arrayFieldKey && field.kind === 'array') {
      html += renderOptionGroupsField(
        field,
        value,
        input.optionGroups,
        referenceLabels,
        instance.data,
        strings,
        accentColor,
      );
      continue;
    }

    const renderedValue = renderFieldValue(field, value, referenceLabels, instance.data, strings);

    html += `
    <div class="field-row">
      <div class="field-label">${escapeHtmlSafe(field.label)}</div>
      <div class="field-value">${renderedValue}</div>
    </div>
`;
  }

  // Render totals section if provided - never alongside `optionGroups` (see that input's own header:
  // a quote with 2+ options prints NO global total, only what `renderOptionGroupsField` already wrote
  // above, one mini totals block per option).
  if (input.totals && !input.optionGroups) {
    html += `
    <div class="totals-section">
      <div class="totals-label">${escapeHtmlSafe(strings.totals)}</div>
${renderTotalsRows(input.totals, strings)}
    </div>
`;
  }

  // "QR SEPA / GiroCode" — sits right after the totals block it pays, before
  // the legal mentions footer. Absent (no IBAN on file, non-EUR currency, a zero/negative total, or a
  // type that never opts in — see `paymentQr`'s own header above) prints NOTHING here, not an empty
  // frame, same rule `legalMentions` right below already holds.
  if (input.paymentQr) {
    // `src` is escaped like the branding logo's own `src` above, not interpolated bare. Today's only
    // caller hands over a `qrcode`-generated base64 URI whose alphabet contains nothing to escape, so
    // this changes not one byte of any real render — it is here so the ATTRIBUTE, not the caller, is
    // what guarantees a quote can never close it and open an event handler after it. Escaping at the
    // one point that composes the markup is the only version of that rule a future caller cannot
    // forget.
    html += `
    <div class="payment-qr-section">
      <img class="payment-qr-image" src="${escapeHtmlSafe(input.paymentQr.dataUri)}" alt="SEPA payment QR code" width="130" height="130">
      <div class="payment-qr-label">${escapeHtmlSafe(strings.scanToPaySepa)}</div>
    </div>
`;
  }

  // "Payment methods" — see `paymentMethods`'s own header above. Prints NOTHING
  // when the array is absent or empty (no method enabled, or a type that never opts in) — same rule
  // `paymentQr` right above already holds.
  if (input.paymentMethods && input.paymentMethods.length > 0) {
    html += `
    <div class="payment-methods-section">
      <div class="payment-methods-heading">${escapeHtmlSafe(strings.paymentMethodsHeading)}</div>
`;
    for (const method of input.paymentMethods) {
      html += `
      <div class="payment-method-item">
        <div class="payment-method-label">${escapeHtmlSafe(method.label)}</div>
`;
      for (const line of method.lines) {
        html += `        <div class="payment-method-line">${escapeHtmlSafe(line)}</div>\n`;
      }
      if (method.link) {
        html += `        <div class="payment-method-link">${escapeHtmlSafe(method.link)}</div>\n`;
      }
      html += `      </div>\n`;
    }
    html += `    </div>\n`;
  }

  // Mandatory mentions get their OWN footer block, never mixed into the fields
  // loop above (see this parameter's own doc comment on `RenderDocumentHtmlInput.legalMentions`). A
  // country with no mentions, or a document type that never opts in, gets NOTHING here — not an
  // empty framed section, no `<div class="legal-mentions">` at all.
  if (input.legalMentions && input.legalMentions.length > 0) {
    html += `
    <div class="legal-mentions">
`;
    for (const mention of input.legalMentions) {
      html += `      <div class="legal-mention-item">${escapeHtmlSafe(mention.text)}</div>\n`;
    }
    html += `    </div>\n`;
  }

  // Custom fields — the company's own custom fields, LAST on the
  // page (after the legal mentions footer): see `RenderDocumentHtmlInput.customFields`'s own header
  // for why this is a dedicated, end-of-document block rather than an insertion into the ordinary
  // fields loop above. Absent or empty prints NOTHING here — same "nothing, not an empty frame"
  // discipline every other optional block on this page already holds.
  if (input.customFields && input.customFields.length > 0) {
    html += `
    <div class="custom-fields-section">
      <div class="custom-fields-heading">${escapeHtmlSafe(strings.customFieldsHeading)}</div>
`;
    for (const entry of input.customFields) {
      const renderedValue = renderFieldValue(
        entry.field,
        entry.value,
        referenceLabels,
        instance.data,
        strings,
      );
      html += `
      <div class="custom-field-item">
        <span class="custom-field-label">${escapeHtmlSafe(entry.field.label)}</span>
        <span>${renderedValue}</span>
      </div>
`;
    }
    html += `    </div>\n`;
  }

  html += `
  </div>
</body>
</html>
`;

  return html;
}
