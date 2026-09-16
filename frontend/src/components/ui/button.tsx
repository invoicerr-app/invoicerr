import type * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip"
import { Loader2Icon } from "lucide-react"

const buttonVariants = cva(
  // disabled:opacity-70, not the old 50: a UNIFORM fade converges a colored surface AND its own
  // paired text toward the same page-background color, collapsing their contrast (measured: the
  // filled variants below fell to ~2-4:1 at 50%, under AA, on both themes — scratchpad). 70% keeps
  // outline/ghost/link (whose disabled state only fades foreground text over an unchanged
  // background) at 6.5:1+; the three filled variants override opacity back to 100% and swap to the
  // muted pair instead, which does not have that convergence problem (~5.2-5.7:1 either theme).
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-70 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90 disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none",
        destructive:
          // text-destructive-solid-foreground, not text-destructive-foreground: the latter flips to
          // dark ink in the dark theme (correct for destructive used as plain text) but this button's
          // dark:bg-destructive/60 composites at partial opacity, staying too dark for that ink to
          // clear AA — see index.css's own comment on that token. Disabled falls back to the same
          // neutral muted pair as every other filled variant (a disabled delete button has nothing
          // destructive left to warn about).
          "bg-destructive text-destructive-solid-foreground shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60 disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80 disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none",
        ghost: "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

function ButtonWithoutTooltip({
  loading,
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & {
  loading?: boolean
} & VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props}>
      {loading && <Loader2Icon className="mr-2 animate-spin" />}
      {props.children}
    </Comp>
  )
}

function Button({
  loading,
  disabled,
  tooltip,
  className,
  variant,
  size,
  asChild = false,
  dataCy,
  ...props
}: React.ComponentProps<"button"> & {
  loading?: boolean
} & VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    tooltip?: string
    dataCy?: string
  }) {
  if (!tooltip) {
    return (
      <ButtonWithoutTooltip
        loading={loading}
        className={className}
        variant={variant}
        size={size}
        asChild={asChild}
        data-cy={dataCy}
        disabled={disabled || loading}
        {...props}
      />
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ButtonWithoutTooltip
          loading={loading}
          className={className}
          variant={variant}
          size={size}
          asChild={asChild}
          disabled={disabled || loading}
          data-cy={dataCy}
          {...props}
        />
      </TooltipTrigger>
      <TooltipContent>
        <span className="text-xs">{tooltip}</span>
      </TooltipContent>
    </Tooltip>
  )
}

export { Button, buttonVariants }
