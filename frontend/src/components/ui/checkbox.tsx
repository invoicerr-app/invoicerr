import type * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { CheckIcon } from "lucide-react"

import { cn } from "@/lib/utils"

// Same "Lagune" tokens every other primitive in this folder rides (select.tsx, switch.tsx): the
// unchecked box is an explicit surface (bg-background/border-input, never a bare/transparent box a
// native <input type="checkbox"> would fall back to its OS chrome for — see index.css's own
// `color-scheme` comment for that failure mode on the native inputs elsewhere in the app). Checked
// state is bg-primary/border-primary with text-primary-foreground for the tick — --primary-foreground
// is deliberately dark ink over the azure --primary in BOTH themes in this identity, so the check
// mark stays readable without a per-theme override here.
function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer size-4 shrink-0 rounded-[4px] border border-input bg-background shadow-xs outline-none transition-shadow",
        "data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=checked]:text-primary-foreground",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current transition-none"
      >
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
