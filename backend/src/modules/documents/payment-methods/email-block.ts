import { escapeHtmlNode } from '../rendering/render-html';
import { pdfChromeStrings } from '../rendering/language/pdf-chrome-strings';
import { RenderLanguage } from '../rendering/language/supported-languages';
import { PaymentMethodPresentation } from './types';

/**
 * Appends the SAME "Payment methods" presentations the PDF just printed
 * (rendering/render-html.ts's own `paymentMethods` block) onto an already-composed email's `body`/
 * `html` — the owner's own brief for this feature ("PayPal will display the account's email and can
 * generate a link in the email") names the EMAIL as where a method's own link actually belongs, since
 * the PDF is a static artifact a bank/accounting system may also file away, while the email is what a
 * payer reads and can click straight from.
 *
 * Deliberately NOT a `{paymentInstructions}` template PLACEHOLDER (actions/email-template.ts's own
 * closed vocabulary — `typeLabel`/`companyName`/`totalGross`/`recipientName`/`displayNumber`): that
 * mechanism exists so a COMPANY can choose WHERE in its own wording a token lands, which fits a single
 * inline VALUE (a total, a name) but not a multi-line, conditionally-present BLOCK — appending it
 * after interpolation, the same way the PDF ATTACHMENT itself is glued on rather than referenced by a
 * placeholder, keeps every existing company template (including one that predates this feature and
 * mentions none of this) rendering with the block simply added at the end, never a new "unknown
 * placeholder" warning for text nobody wrote.
 *
 * Returns `body`/`html` UNCHANGED when there is nothing to append (no method enabled, or a document
 * type that never opts in — `resolveEnabledPaymentMethodPresentations` already returns `[]` for both)
 * — the exact same "nothing, not an empty block" discipline `render-html.ts`'s own `paymentMethods`
 * input holds.
 */
export function appendPaymentMethodsToEmail(
  body: string,
  html: string | undefined,
  presentations: PaymentMethodPresentation[],
  language: RenderLanguage,
): { body: string; html: string | undefined } {
  if (presentations.length === 0) return { body, html };

  const heading = pdfChromeStrings(language).paymentMethodsHeading;

  const textBlock = [
    heading,
    ...presentations.flatMap((method) => [
      '',
      method.label,
      ...method.lines,
      ...(method.link ? [method.link] : []),
    ]),
  ].join('\n');

  const htmlBlock =
    `<p><strong>${escapeHtmlNode(heading)}</strong></p>` +
    presentations
      .map((method) => {
        const lines = [
          `<strong>${escapeHtmlNode(method.label)}</strong>`,
          ...method.lines.map((line) => escapeHtmlNode(line)),
          ...(method.link
            ? [`<a href="${escapeHtmlNode(method.link)}">${escapeHtmlNode(method.link)}</a>`]
            : []),
        ];
        return `<p>${lines.join('<br>')}</p>`;
      })
      .join('');

  return {
    body: `${body}\n\n${textBlock}`,
    // Only appended onto an html part that ALREADY exists — a text-only template (every shipped
    // default, see descriptors/*.descriptor.ts's own `email`) stays text-only, unchanged by this
    // feature existing, the same "never invent a part that wasn't there" rule `renderEmailTemplate`
    // itself already holds for `html`.
    html: html ? `${html}${htmlBlock}` : undefined,
  };
}
