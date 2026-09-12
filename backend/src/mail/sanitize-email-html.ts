// `import x = require(...)`: this project's tsconfig has no esModuleInterop and sanitize-html is
// `export =` — the same CJS-compat form `utils/format-text.ts` already uses for markdown-it.
//
// The dependency is PINNED (exactly, in package.json) rather than floating on ^2: sanitize-html 2.17.1+
// swapped its parser to htmlparser2 v12, which is pure ESM with no CommonJS build at all, and a
// `require()` of it throws under jest's CJS module registry — every spec that merely imports this file
// (the whole send path does) would fail to load, which is exactly how that upgrade announced itself
// here. The pin is what keeps this library's behaviour, which was chosen on the two properties below.
import sanitizeHtml = require('sanitize-html');

/**
 * The allow-list every stored HTML email part is filtered through — see `sanitizeEmailHtml` below for
 * WHERE it runs (the write path, always) and why.
 *
 * ## Why this library
 *
 * Two properties decided it, both verified by this module's own spec rather than assumed:
 *  - a `{placeholder}` survives intact, INCLUDING inside an `href` — `href="{signatureUrl}"` is how the
 *    shipped signature-request template carries its link, and a filter that blanks an attribute it
 *    cannot parse as a URL (js-xss does exactly this) would silently destroy the one token that email
 *    exists to deliver. That is what makes sanitizing BEFORE interpolation possible at all.
 *  - a disallowed WRAPPER tag loses the tag and keeps its prose, rather than escaping the markup into
 *    visible `&lt;tags&gt;` in the recipient's mail.
 *
 * Tag list: what an email body legitimately needs (headings, paragraphs, emphasis, lists, tables,
 * links, images, a rule) and nothing that executes or loads behaviour — no `script`, no `style` TAG
 * (a stylesheet can carry `expression()`/`@import` and is meaningless in most mail clients anyway),
 * no `iframe`/`object`/`embed`, no `form`/`input` (a form in an email is a phishing shape, never a
 * feature of ours).
 *
 * `style` is allowed as an ATTRIBUTE on every tag, deliberately: inline CSS is the only styling
 * mechanism email clients reliably honor, and the shipped system templates are built from it. No
 * `allowedStyles` whitelist on top of that — enumerating every legitimate CSS property would break
 * real templates for no gain, because the dangerous part of CSS in mail is the stylesheet-level
 * constructs a `style` ATTRIBUTE cannot express.
 *
 * Event handlers (`onclick`, `onerror`, ...) need no mention: sanitize-html drops every attribute not
 * named here, so they are gone by construction rather than by a blacklist someone has to keep
 * complete.
 */
const EMAIL_HTML_POLICY: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'div',
    'span',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'small',
    'br',
    'hr',
    'a',
    'ul',
    'ol',
    'li',
    'blockquote',
    'pre',
    'code',
    'table',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'td',
    'th',
    'img',
  ],
  allowedAttributes: {
    '*': ['style', 'align', 'class'],
    a: ['href', 'style', 'target', 'rel', 'title'],
    img: ['src', 'alt', 'width', 'height', 'style'],
    table: ['style', 'width', 'border', 'cellpadding', 'cellspacing', 'align'],
    td: ['style', 'align', 'valign', 'colspan', 'rowspan', 'width'],
    th: ['style', 'align', 'valign', 'colspan', 'rowspan', 'width'],
  },
  // `javascript:` / `vbscript:` / `data:` URLs are refused for every attribute that takes a URL —
  // including `img[src]`, where a `data:` payload is the classic way to smuggle markup past a naive
  // filter. A bare relative/absolute path with no scheme is still allowed, which is what keeps a
  // `{placeholder}` usable as an `href` (see `sanitizeEmailHtml`).
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  // Nothing is "escaped into visible text" silently: a disallowed tag's CONTENT is kept (so a
  // paragraph wrapped in an unknown tag does not vanish) while the tag itself goes — except for these
  // three, whose content is markup/behaviour rather than prose a reader was meant to see.
  nonTextTags: ['script', 'style', 'textarea', 'option'],
};

/**
 * Filters one stored HTML email part through `EMAIL_HTML_POLICY` above.
 *
 * Runs on the WRITE path — every place a company's own HTML reaches the database
 * (`modules/documents/actions/company-email-templates.ts` for a per-document-type override,
 * `modules/company/company.service.ts` for a system template). Sanitizing at write time rather than
 * at send time is the deliberate choice: the stored value is then the SAFE value, so every reader —
 * this application's own sender, a future export, an admin reading the row in psql — sees the same
 * bytes, and no future send path can forget to filter. The mirror-image argument is what makes
 * sanitizing ONLY in a frontend preview worthless: that protects the one screen that happens to call
 * it and nothing else, least of all the mailbox the HTML is actually delivered to.
 *
 * NOT byte-preserving, and not meant to be: sanitize-html reserializes the markup it keeps, so CSS
 * declarations come back normalized (`background: #fff;` -> `background:#fff`) and void elements
 * self-closed (`<br>` -> `<br />`). Both are equivalent HTML; a company editing its template sees
 * tidied-but-equivalent markup come back, never silently dropped prose.
 *
 * `{placeholder}` tokens pass through untouched, in text AND in an attribute value (`href="{signatureUrl}"`
 * survives because a scheme-less URL is a legitimate relative one as far as the filter is concerned)
 * — which is what lets sanitization happen BEFORE interpolation rather than after. The values
 * substituted in later are escaped separately, at interpolation time, by `renderEmailTemplate`
 * (`modules/documents/actions/email-template.ts`): this filter only ever sees the TEMPLATE, so it
 * could not protect the html part from a hostile substituted value on its own.
 */
export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, EMAIL_HTML_POLICY);
}
