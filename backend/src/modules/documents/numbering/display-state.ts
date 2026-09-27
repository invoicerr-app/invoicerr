/**
 * PR #473 review point 3: the ONE rule that decides what an UNNUMBERED document's number placeholder
 * should say - "still a draft, no number yet" vs. "issued, but will never get one" - mirrored,
 * previously, in TWO independently-written places that quietly disagreed: this backend's own
 * `rendering/render-html.ts` (the PDF) used `isNumberingAllowedFrom(descriptor.numbering,
 * instance.status)` directly, which answers a DIFFERENT question ("would THIS status be allowed to
 * receive a number on its OWN next transition") - true for ANY status once `numbering.onlyFrom` is
 * absent (quote, invoice, purchase order, goods receipt), regardless of whether that status is even
 * one the record could still be numbered FROM. A document stuck in "sending" without a number (the
 * exact failure review point 1 of this same PR closes) would print "Draft, no number yet" on its PDF
 * forever, while the frontend's own `numberingDisplayState` (frontend/src/components/documents/
 * types.ts) already asked the RIGHT question and showed "Issued without a number" for the same
 * record - directly contradicting the comment in render-html.ts that said the two must never diverge.
 *
 * This function IS that frontend rule, moved here so the backend has its own canonical copy to render
 * the PDF from, instead of reaching for the differently-shaped `isNumberingAllowedFrom` (which stays,
 * unchanged, for its own three real callers - see that file's own header - none of which are a
 * display concern). There is no runtime code-sharing across the backend/frontend TypeScript
 * boundary (two independent projects, two independent builds - see the repository's own CLAUDE.md),
 * so "one shared definition" here means: ONE formula, written once on each side, each a single
 * one-line boolean expression a reviewer can diff by eye - frontend/src/components/documents/types.ts
 * `numberingDisplayState` mirrors this function's own body exactly, and carries a comment pointing
 * back here. `numbering/display-state.spec.ts` and the frontend's own `types.spec.ts` each pin their
 * own copy against the SAME table of (numbering, initialStatus, instance) cases, so a future edit to
 * either side that silently drifts from the other fails a test, not just a PDF a human has to notice.
 */

/** Only the fields this predicate actually reads - never the full `DocumentTypeDescriptor` type, so a
 *  caller building a bespoke literal (a test) never has to satisfy fields it has no reason to invent. */
export interface NumberingDisplayStateDescriptor {
  numbering?: { onlyFrom?: string[] };
  initialStatus?: string;
}

export interface NumberingDisplayStateInstance {
  displayNumber?: string | null;
  status: string;
}

/**
 *  - `'numbered'`: `displayNumber` is set - show it verbatim, the normal case.
 *  - `'awaiting'`: no number yet, but this record's CURRENT status is one it could still receive a
 *    number FROM (`descriptor.initialStatus` itself - a plain draft - or, when `numbering.onlyFrom`
 *    is declared, any status in that list).
 *  - `'issuedWithoutNumber'`: no number, and the status is neither of the above - the record left its
 *    "could still be numbered" window while genuinely unnumbered (a legacy, pre-#471 credit note that
 *    reached "sent"/"send_failed" before this type was numbered at all, OR - the bug this PR's review
 *    point 1 closes - a numbered type stuck "sending" with no number due to a since-fixed race).
 *
 * Callers must already have checked `descriptor.numbering` is declared at all (this function has
 * nothing to say for a never-numbered type like "expense" - see each call site's own gate).
 */
export function numberingDisplayState(
  descriptor: NumberingDisplayStateDescriptor,
  instance: NumberingDisplayStateInstance,
): 'numbered' | 'awaiting' | 'issuedWithoutNumber' {
  if (instance.displayNumber) return 'numbered';
  const stillAwaiting =
    instance.status === descriptor.initialStatus ||
    (descriptor.numbering?.onlyFrom?.includes(instance.status) ?? false);
  return stillAwaiting ? 'awaiting' : 'issuedWithoutNumber';
}
