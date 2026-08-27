import MarkdownIt from 'markdown-it';

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
 * so users can emphasize text without allowing arbitrary HTML injection.
 */
export function formatRichText(text?: string | null): string {
    if (!text) return '';

    const escaped = escapeHtml(text);
    const withBold = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    return withBold.replace(/\*(.+?)\*/g, '<em>$1</em>');
}

// html: false escapes any raw HTML in user input instead of rendering it,
// which is the primary XSS defense for markdown notes.
const md = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: true,
});

/**
 * Renders full markdown (headings, lists, links, code, blockquotes...) to HTML.
 * Used for quote/invoice notes, which support richer formatting than item descriptions.
 */
export function formatNotes(text?: string | null): string {
    if (!text) return '';
    return md.render(text);
}
