export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL"

export type Log = {
  id: string
  level: LogLevel
  category: string
  message: string
  timestamp: Date
  userId?: string
  path?: string
  details: Record<string, unknown>
}

/** The chip a log LEVEL renders as, everywhere one appears (the filter bar's own toggle, the table
 *  row, the detail dialog), mapped onto the semantic tokens rather than a raw palette colour so
 *  light/dark and the app's own accent stay in sync. FATAL is the one level a plain `Badge` variant
 *  can't reach (solid `destructive` is already spent on it): everything below it, including ERROR,
 *  gets the softer destructive fill so FATAL still reads as the loudest row on screen. */
export function levelBadgeProps(level: LogLevel): {
  variant?: "secondary" | "warning" | "info" | "destructive"
  className?: string
} {
  switch (level) {
    case "DEBUG":
      return { variant: "secondary" }
    case "INFO":
      return { variant: "info" }
    case "WARN":
      return { variant: "warning" }
    case "ERROR":
      return { className: "border-transparent bg-destructive-soft text-destructive-soft-foreground" }
    case "FATAL":
      return { variant: "destructive" }
  }
}
