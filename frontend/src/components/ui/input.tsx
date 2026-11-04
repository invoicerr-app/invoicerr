import type * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "border border-input bg-card rounded-md shadow-inset dark:shadow-none focus-field file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground flex h-[42px] w-full min-w-0 px-3.5 py-1 text-base outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-sunken disabled:text-muted-foreground disabled:shadow-none md:text-[15px]",
        "aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  )
}

export { Input }
