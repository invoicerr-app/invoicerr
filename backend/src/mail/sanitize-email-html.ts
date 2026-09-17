// `import x = require(...)`: this project's tsconfig has no esModuleInterop and sanitize-html is
// `export =` — the same CJS-compat form `utils/format-text.ts` already uses for markdown-it.
//
// The dependency is PINNED (exactly, in package.json) rather than floating on ^2: sanitize-html 2.17.6+
// (reached again via 2.17.7, the version that closes every GHSA advisory open against 2.17.1 — see
// below) bumps its `htmlparser2` dependency to v12, which ships `"type": "module"` with no `require`
// export condition at all — genuinely ESM-only. `require()`-ing it throws under jest's CJS module
// registry ("Cannot use import statement outside a module") — every spec that merely imports this file
// (the whole send path does) would fail to load. Verified directly (not merely inferred from the
// advisory text): installing 2.17.7 in isolation and requiring it under a bare Jest project reproduces
// the exact failure. 2.17.2 through 2.17.5 use htmlparser2 v10 instead (a genuine dual CJS/ESM
// package, `require`-safe) — but the one advisory below that survives past 2.17.5 needs 2.17.6+
// regardless, so no version both fixes it and keeps a `require`-able parser.
//
// Three GHSA advisories are open against 2.17.1: GHSA-vccv-cmxp-4j9h (`javascript:` via
// action/formaction/data/poster/background attributes), GHSA-g8qq-57p8-ggw5 (SVG SMIL), and
// GHSA-jxwj-j7wr-gfrw (mutation-XSS via a literal `</textarea/>` close tag confusing the parser).
// NONE is reachable through `EMAIL_HTML_POLICY` below, each for its own concrete reason:
//  - the first two need an attribute/tag `EMAIL_HTML_POLICY.allowedAttributes`/`allowedTags` simply
//    never grants (no `action`/`formaction`/`poster`/`background` anywhere in `allowedAttributes`, no
//    `svg`-family tag in `allowedTags`);
//  - the third's own advisory states outright: "Requires `textarea` (or `xmp`) in `allowedTags` …
//    The default configuration is not affected" — this policy's `allowedTags` never includes either,
//    and `textarea` is ALSO listed in `nonTextTags` below (belt-and-suspenders: even a disallowed
//    tag's content is normally KEPT as prose, but `nonTextTags` discards it instead for exactly this
//    one). Verified directly: the advisory's own PoC payload,
//    `<textarea></textarea/><img src=x onerror=alert(document.domain)>`, sanitizes to the EMPTY
//    STRING through this exact policy (see `sanitize-email-html.spec.ts`'s own regression test) — not
//    merely "no `onerror` substring", the entire payload is discarded, leaving nothing for a later
//    mutation-XSS re-parse to act on.
//
// Net effect: upgrading would trade a real, verified breakage (Jest) for a fix to three advisories
// that are independently unreachable through this file's own configuration. The pin stays; this
// comment — not the version number — is the actual mitigation record. Revisit if `EMAIL_HTML_POLICY`
// ever grows to allow `textarea`/`xmp`, SVG, or any of the four named attributes.
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

/**
 * Tags whose CONTENT is markup/behaviour rather than prose a reader was meant to see — shared with
 * `actions/email-template.ts#stripHtmlTags`, which strips ALL tags (not just the ones this policy
 * disallows) to derive a plain-text email part: a single list keeps "what must never survive as
 * visible text" from drifting between the two policies, rather than a second copy silently missing a
 * tag this one adds later.
 */
export const EMAIL_NON_TEXT_TAGS = ['script', 'style', 'textarea', 'option'];

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
  // paragraph wrapped in an unknown tag does not vanish) while the tag itself goes — except for these,
  // whose content is markup/behaviour rather than prose a reader was meant to see.
  nonTextTags: EMAIL_NON_TEXT_TAGS,
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
