import type * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer focus-ring data-[state=checked]:bg-primary data-[state=unchecked]:bg-input inline-flex h-6 w-[42px] shrink-0 items-center rounded-full border border-transparent p-[2px] transition-colors outline-none disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "bg-card dark:data-[state=checked]:bg-primary-foreground pointer-events-none block size-[18px] rounded-full shadow-[0_1px_2px_oklch(0.2_0.03_230/30%)] ring-0 transition-transform duration-150 ease-(--ease-out) data-[state=checked]:translate-x-[18px] rtl:data-[state=checked]:-translate-x-[18px] data-[state=unchecked]:translate-x-0",
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
