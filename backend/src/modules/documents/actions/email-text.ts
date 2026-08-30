interface LineLike {
  description?: unknown;
  quantity?: unknown;
  unitPrice?: unknown;
}

/**
 * Renders a document's `lines` field as a plain-text list for an email body — shared by every
 * document type built on the (description, quantity, unitPrice) line shape (the quote, and now the
 * invoice). Presentational only: it lists the lines exactly as entered, computes nothing (no total,
 * no tax, no rounding rule) — that was the removed compliance engine's job, not this module's.
 */
export function formatLinesText(data: Record<string, unknown>): string {
  const currency = typeof data.currency === 'string' ? data.currency : '';
  const lines = Array.isArray(data.lines) ? (data.lines as LineLike[]) : [];

  if (lines.length === 0) return '  (no lines)';

  return lines
    .map(
      (line) => `  - ${line.description ?? ''}: ${line.quantity ?? ''} x ${line.unitPrice ?? ''} ${currency}`,
    )
    .join('\n');
}

/** A trailing "\n\nNotes: ..." block, or "" when there is nothing to say — shared for the same
 *  reason as formatLinesText above: quote and invoice both carry a plain `notes` field. */
export function formatNotesText(data: Record<string, unknown>): string {
  const notes = typeof data.notes === 'string' && data.notes.length > 0 ? data.notes : undefined;
  return notes ? `\n\nNotes: ${notes}` : '';
}
