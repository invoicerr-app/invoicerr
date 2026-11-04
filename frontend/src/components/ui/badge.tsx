import type * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// A tone variant is a status: a disc and a word in the tone's ink, never a filled pill. The neutral
// variants stay small chips for counts and categories.
const TONE_MARK =
  "border-0 bg-transparent px-0 py-0 text-[13px] before:size-2 before:shrink-0 before:rounded-full before:bg-current before:content-[''] has-[>svg]:before:hidden"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-sm border px-1.5 py-px text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--focus) [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-foreground text-background [a&]:hover:bg-foreground/90",
        secondary: "border-transparent bg-muted text-ink-2 [a&]:hover:bg-muted/80",
        outline: "text-ink-2 [a&]:hover:bg-sunken",
        destructive: `${TONE_MARK} font-semibold text-destructive-soft-foreground`,
        success: `${TONE_MARK} font-semibold text-success-foreground`,
        warning: `${TONE_MARK} font-semibold text-warning-foreground`,
        info: `${TONE_MARK} font-semibold text-info-foreground`,
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span"

  return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
