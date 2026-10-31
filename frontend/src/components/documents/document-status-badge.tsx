import { StatusMark } from "@/components/ui/status-mark"
import { statusPresentation } from "./status-presentation"

/**
 * A document instance's `status` is arbitrary data — no descriptor declares a closed set of
 * statuses up front (see DocumentInstance.status, and DocumentActionDescriptor.availableWhen, which
 * only ever compares against whatever string a status happens to be). There is therefore no enum
 * this core could switch on by name, and it must not invent one per document TYPE (that would be
 * exactly the kind of per-type branching the generic render exists to avoid).
 *
 * What IS shared across pretty much any business document's status, regardless of which type
 * produced it, is a small, generic VOCABULARY: something is a draft, in flight, accepted/settled,
 * or refused/void. `statusPresentation` maps THAT vocabulary to a tone and a glyph, never a document
 * type. A status that matches nothing still renders, neutral, not hidden.
 */
// Generic — never keyed to any one status name: a snake_case id (e.g. "send_failed", the async
// "send" mechanism's own failure status) reads as space-separated words, the same
// way a plain one-word status already did before this case existed.
function capitalize(value: string): string {
  const spaced = value.replace(/_/g, " ")
  return spaced.length > 0 ? spaced[0].toUpperCase() + spaced.slice(1) : spaced
}

interface DocumentStatusBadgeProps {
  status: string
  /**
   * The status's own DECLARED, already-translated label — e.g.
   * `descriptor.statuses?.find((s) => s.id === status)?.label`, where `descriptor` came back through
   * `useDocumentType` (hooks/queries/use-document-types.ts), which already ran it through the
   * `documents.descriptors.<typeId>.statuses.<statusId>` derivation (see lib/descriptor-i18n.ts).
   * Absent — a status this descriptor never declared at all,
   * e.g. a data mismatch, or a THIRD-PARTY type whose status vocabulary this app has never heard of —
   * falls back to the capitalized raw id below, exactly this component's ENTIRE behavior before this
   * prop existed: a plugin's own status string still displays, unmolested, in any language it wrote
   * it in. */
  label?: string
  className?: string
}

/** Falls back to `capitalize(status)` — the raw status id, capitalized — when `label` is absent: the
 *  original, ENTIRE behavior of this component, kept as the escape hatch for a status no descriptor
 *  declares at all. Same convention as a descriptor's own `label` or an action's
 *  `policyBlockedReason` (see types.ts): plain data a plugin can name in any language, not a closed
 *  set this app's locale files could ever fully enumerate. */
export function DocumentStatusBadge({ status, label, className }: DocumentStatusBadgeProps) {
  return (
    <StatusMark {...statusPresentation(status)} className={className} data-cy="document-status-badge">
      {label ?? capitalize(status)}
    </StatusMark>
  )
}
