import type * as React from "react"

import type { StatusGlyph, StatusTone } from "@/components/documents/status-presentation"
import { cn } from "@/lib/utils"

const TONE_TEXT: Record<StatusTone, string> = {
  neutral: "text-muted-foreground",
  info: "text-link",
  success: "text-success-foreground",
  warning: "text-warning-foreground",
  destructive: "text-destructive-soft-foreground",
}

function Glyph({ glyph }: { glyph: StatusGlyph }) {
  const common = { width: 12, height: 12, viewBox: "0 0 12 12", "aria-hidden": true, className: "shrink-0" }
  switch (glyph) {
    case "half":
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6 1.5a4.5 4.5 0 0 1 0 9z" fill="currentColor" />
        </svg>
      )
    case "check":
      return (
        <svg {...common}>
          <path
            d="M2 6.5 4.8 9 10 3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    case "disc":
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="4.5" fill="currentColor" />
        </svg>
      )
    case "triangle":
      return (
        <svg {...common}>
          <path d="M6 1.5 11 10.5H1z" fill="currentColor" />
        </svg>
      )
    case "circled-cross":
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
          <path
            d="m4.2 4.2 3.6 3.6m0-3.6-3.6 3.6"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
          />
        </svg>
      )
    case "cross":
      return (
        <svg {...common}>
          <path d="m3 3 6 6m0-6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
    default:
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      )
  }
}

interface StatusMarkProps extends React.ComponentProps<"span"> {
  tone: StatusTone
  glyph: StatusGlyph
  struck?: boolean
}

/** A status as a shape plus a word, never a filled pill and never colour alone. */
function StatusMark({ tone, glyph, struck, className, children, ...props }: StatusMarkProps) {
  return (
    <span
      data-slot="status-mark"
      data-tone={tone}
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1.5 whitespace-nowrap text-[13.5px] leading-5 font-semibold transition-colors duration-200",
        TONE_TEXT[tone],
        className,
      )}
      {...props}
    >
      <Glyph glyph={glyph} />
      <span className={cn(struck && "line-through decoration-1")}>{children}</span>
    </span>
  )
}

export { StatusMark }
