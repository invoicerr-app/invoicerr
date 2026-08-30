import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/**
 * A document instance's `status` is arbitrary data — no descriptor declares a closed set of
 * statuses up front (see DocumentInstance.status, and DocumentActionDescriptor.availableWhen, which
 * only ever compares against whatever string a status happens to be). There is therefore no enum
 * this core could switch on by name, and it must not invent one per document TYPE (that would be
 * exactly the kind of per-type branching the generic render exists to avoid).
 *
 * What IS shared across pretty much any business document's status, regardless of which type
 * produced it, is a small, generic VOCABULARY: something is a draft, in flight, accepted/settled,
 * or refused/void. This maps THAT vocabulary to a color, never a document type. A status that
 * matches nothing still renders — neutral, not hidden — the same "never hide" discipline as an
 * unsupported field kind.
 */
type Tone = "neutral" | "info" | "success" | "warning" | "destructive"

// Order matters: the first pattern to match wins, so a more specific word (e.g. "overdue") should
// stay ahead of a broader one it could also satisfy.
const TONE_PATTERNS: [Tone, RegExp][] = [
  ["destructive", /cancel|reject|refus|fail|void|error/i],
  ["warning", /overdue|pending|await|review/i],
  ["success", /paid|sign|accept|clear|complete|approved|settl/i],
  ["info", /sent|issued|submit|transmit|progress/i],
  ["neutral", /draft/i],
]

function toneOf(status: string): Tone {
  for (const [tone, pattern] of TONE_PATTERNS) {
    if (pattern.test(status)) return tone
  }
  return "neutral"
}

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-secondary text-secondary-foreground",
  info: "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300",
  success: "bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  destructive: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300",
}

function capitalize(value: string): string {
  return value.length > 0 ? value[0].toUpperCase() + value.slice(1) : value
}

interface DocumentStatusBadgeProps {
  status: string
  className?: string
}

/** `status` is shown AS-IS, capitalized only — never translated. Same convention as a descriptor's
 *  own `label` or an action's `policyBlockedReason` (see types.ts): plain data a plugin can name in
 *  any language, not a closed set this app's locale files could ever fully enumerate. */
export function DocumentStatusBadge({ status, className }: DocumentStatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn("border-transparent font-semibold", TONE_CLASSES[toneOf(status)], className)}
      data-cy="document-status-badge"
    >
      {capitalize(status)}
    </Badge>
  )
}
