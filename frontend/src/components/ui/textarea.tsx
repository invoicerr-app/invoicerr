import type * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border border-input bg-card rounded-md shadow-inset dark:shadow-none focus-field placeholder:text-muted-foreground aria-invalid:border-destructive flex field-sizing-content min-h-16 w-full px-3.5 py-2.5 text-base outline-none disabled:cursor-not-allowed disabled:bg-sunken disabled:text-muted-foreground disabled:shadow-none md:text-[15px]",
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
