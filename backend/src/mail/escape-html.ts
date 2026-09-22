/**
 * Minimal HTML-entity escaping for a single interpolated VALUE — never for a whole markup fragment,
 * which would turn its own tags into visible text. Originally written inline in
 * `system-email-templates.ts` for the ownership-transfer emails (the first system email whose HTML
 * reaches a DIFFERENT, unrelated user's inbox carrying values the INITIATING owner controls —
 * `companyName`, their own display name); moved here so `mail-layout.ts`'s shared template can reuse
 * the exact same rule instead of a second, possibly-drifting copy.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
