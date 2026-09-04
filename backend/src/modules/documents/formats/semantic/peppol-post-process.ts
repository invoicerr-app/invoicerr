/**
 * PEPPOL-EN16931-R002 ("no more than one note is allowed on document level, unless both the buyer
 * and seller are German organizations" — `vendored/peppol/PEPPOL-EN16931-UBL.sch`, read verbatim) —
 * see `peppol-bis-provider.ts`'s own header for the full story of why this matters at all: a French
 * seller's THREE mandatory C. com. mentions (`mentions/data/fr.json`, wired generically through
 * `build-semantic-invoice.ts`'s own `legalMentionNotes` array) already emit three separate
 * `cbc:Note` elements for every OTHER syntax this codebase builds — CII, plain UBL, Factur-X,
 * FatturaPA, FA(3), Facturae — and that SHARED mechanism is not touched here (see
 * `build-semantic-invoice.ts`'s own header on `SemanticInvoiceInput`'s note array): the constraint
 * belongs to the Peppol BIS profile alone, so the fix lives HERE, confined to this one bridge, the
 * exact same shape `facturx-provider.ts`'s own `splitCiiIncludedNotesInObject` already takes for a
 * DIFFERENT note-shape defect without touching that shared builder either.
 *
 * ## Why merging unconditionally is correct, not just convenient
 *
 * R002's own test is `count(cbc:Note) <= 1 or ($supplierCountryIsDE and $customerCountryIsDE)` — an
 * OR. Collapsing every multi-note document down to exactly one note satisfies the LEFT branch
 * unconditionally, so the DE↔DE exception on the right never needs to be evaluated, let alone
 * reproduced here: a document carrying one note is compliant whether or not both parties are German.
 * Preserving multiple notes for a DE↔DE pair specifically would need this bridge to thread both
 * parties' resolved country codes down to a place that today only sees the rendered UBL object — for
 * a purely COSMETIC difference, since a DE↔DE invoice merged into one note is exactly as compliant as
 * one left as three. The simpler, always-conformant path is taken deliberately: merge unconditionally,
 * on every seller/buyer pair, never gated on nationality.
 *
 * ## Content preservation
 *
 * The merge is a lossless join by `\n` — every legal text (each C. com. mention, any free-text user
 * note) survives VERBATIM inside the single resulting note, in the same order it was already in the
 * array (user note first, then one entry per country-mandated mention — see
 * `build-semantic-invoice.ts`'s own header). See this file's own spec, and
 * `peppol-bis-provider.spec.ts`'s master proof, for the assertion that this holds against the REAL
 * vendored Schematron, never just against this function in isolation.
 *
 * BR-CL-08 (base EN 16931, "Invoiced note subject code shall be coded using UNCL4451") only inspects
 * the FIRST `#CODE#` pair anywhere in a note's own text (`substring-before(substring-after(.,'#'),
 * '#')` — verified directly against the vendored base Schematron's own `<assert>`, not assumed): once
 * several `#CODE#text` mentions are joined into one string, only the leading one is actually checked
 * against the UNTDID 4451 list. Every country-mandated mention this codebase resolves
 * (`mentions/invoice-notes.ts#toUblNote`) already uses a genuine UNTDID 4451 code (PMT/PMD/AAB for
 * France today), so whichever one lands first after the merge still passes BR-CL-08 — this holds for
 * any mentions file this codebase ships, not by luck of the current ordering. Only a user's OWN
 * free-text note containing a literal `#` ahead of the mentions could upset this — an edge case that
 * already existed per-note before this change and is not newly introduced by merging.
 *
 * ## Where this runs
 *
 * As the `postProcessor` `@e-invoice-eu/core`'s `InvoiceServiceOptions` already exposes as a public
 * extension point (verified directly against the vendored dependency — the same discovery
 * `cii-post-process.ts#splitCiiIncludedNotesInObject`'s own header documents, reused here for a
 * different shape), called on the UBL generator's own intermediate `{ Invoice: {...} }` /
 * `{ CreditNote: {...} }` object right before XML rendering — never on the shared `EuInvoice` input
 * every other syntax (including `xrechnung-provider.ts`, which carries no equivalent note-count rule
 * in its own vendored KoSIT delta — verified directly, see that file's own header) also consumes,
 * unmodified.
 */
export function mergePeppolNotesInObject(data: Record<string, unknown>): void {
  // The UBL formatter's own `generate()` produces exactly one of these two root keys (`Invoice` for
  // an invoice, `CreditNote` once it rewrites the tree for a credit-note type code) — see
  // `@e-invoice-eu/core`'s own `FormatUBLService#generate`. `peppol-bis-provider.ts` only ever builds
  // the invoice branch today (its own semantic bridge always sets `cbc:InvoiceTypeCode: '380'` — see
  // `build-semantic-invoice.ts`'s header), so the `CreditNote` branch is defensive, not yet reachable.
  const root = (data.Invoice ?? data.CreditNote) as Record<string, unknown> | undefined;
  if (!root) return; // neither key present — nothing this function knows how to touch, safe no-op

  const notes = root['cbc:Note'];
  if (!Array.isArray(notes) || notes.length <= 1) return; // 0 or 1 note is already R002-compliant

  root['cbc:Note'] = [notes.map((note) => String(note)).join('\n')];
}
