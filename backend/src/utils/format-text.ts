function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escapes free text then converts a small markdown-like subset to HTML:
 * **text** becomes bold, *text* becomes italic. Used for item descriptions
 * and notes so users can emphasize text without allowing arbitrary HTML injection.
 */
export function formatRichText(text?: string | null): string {
  if (!text) return '';

  const escaped = escapeHtml(text);
  const withBold = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return withBold.replace(/\*(.+?)\*/g, '<em>$1</em>');
}
