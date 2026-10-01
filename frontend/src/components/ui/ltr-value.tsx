import type * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Issue #559 - wraps a value that must always read left-to-right regardless of the active locale's
 * direction: a monetary amount, a date, an IBAN, a VAT/SIRET number or any other identifier. Plain
 * `dir="ltr"` rather than `unicode-bidi: isolate` alone - isolation keeps the VALUE's own internal
 * character order stable but still lets the bidi algorithm place the whole run wherever a
 * neighbouring strong RTL character would put it (and decide where its own leading/trailing
 * punctuation, e.g. a minus sign or a currency code, lands); forcing the direction pins both. The
 * element itself stays `inline` (a `<span>`) so it drops into running text or a table cell exactly
 * like the plain string it replaces.
 */
export function LtrValue({ className, ...props }: React.ComponentProps<"span">) {
  return <span dir="ltr" className={cn("inline", className)} {...props} />
}
