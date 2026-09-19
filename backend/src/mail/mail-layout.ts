import { escapeHtml } from './escape-html';

/**
 * The ONE HTML shell every system mail this application sends already used, byte-for-byte, before
 * this file existed — pulled out of `system-email-templates.ts`, which had it typed out seven times
 * (`<h2>…</h2>`, an optional CTA button with the same inline `background: #007bff…` style, a closing
 * "Best regards" line, then `<hr>` and a 12px grey footer). Extracting it here does not change what
 * any existing mail looks like — no template has been migrated onto it yet, see this repository's own
 * mail-i18n handoff notes — it only gives the NEXT mail a shell to reuse instead of an eighth copy.
 */
export interface MailLayoutParams {
  /** Rendered as `<h2>`, HTML-escaped — a heading is always plain text, never markup a caller needs. */
  title: string;
  /**
   * Already-built HTML for the mail's own prose — INTENTIONALLY NOT escaped here, exactly like every
   * template in `system-email-templates.ts` today: the caller composes this from its own literal
   * markup (`<p>`, `<strong>`, `<div>`…) interleaved with values it has ALREADY run through
   * `escapeHtml` itself where those values are attacker-reachable (see that file's own comment on
   * why only the cross-user ownership-transfer emails needed to). Escaping the whole fragment here
   * would turn the caller's own tags into visible text instead of rendering them.
   */
  bodyHtml: string;
  /** Button label — HTML-escaped. Omit together with `ctaUrl` for a mail with no call to action. */
  ctaLabel?: string;
  /** Button target — HTML-escaped (it lands inside an `href="…"` attribute, not just inline text). */
  ctaUrl?: string;
  /** The small grey print under the `<hr>` (the "This email was sent from …" line every existing
   *  template ends on) — HTML-escaped. Optional: a mail with nothing to disclose there just omits it. */
  footer?: string;
}

const CTA_BUTTON_STYLE =
  'background: #007bff; color: white; padding: 12px 24px; text-decoration: none; ' +
  'border-radius: 6px; display: inline-block;';

/**
 * Builds the shared shell around one mail's own body. The CTA block is rendered only when BOTH
 * `ctaLabel` and `ctaUrl` are given — a button with a destination but no label, or a label with
 * nowhere to go, is a caller bug, and silently rendering half of it would only hide that bug in the
 * one place (a live mail) where it is hardest to notice.
 */
export function wrapMailLayout(params: MailLayoutParams): string {
  const { title, bodyHtml, ctaLabel, ctaUrl, footer } = params;

  const cta =
    ctaLabel && ctaUrl
      ? `<div style="text-align: center; margin: 30px 0;">` +
        `<a href="${escapeHtml(ctaUrl)}" style="${CTA_BUTTON_STYLE}">${escapeHtml(ctaLabel)}</a></div>`
      : '';

  const footerBlock = footer ? `<hr><p style="font-size: 12px; color: #666;">${escapeHtml(footer)}</p>` : '';

  return (
    `<h2>${escapeHtml(title)}</h2>` +
    bodyHtml +
    cta +
    '<p>Best regards,<br>The Invoicerr Team</p>' +
    footerBlock
  );
}
