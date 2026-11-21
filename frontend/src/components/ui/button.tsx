import type * as React from "react"
import { Slot, Slottable } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip"
import { Loader2Icon } from "lucide-react"

const buttonVariants = cva(
  // Filled variants never fade when disabled: a uniform fade collapses a fill and its own text toward
  // the page colour, so they swap to the muted pair instead.
  "press focus-ring inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent text-sm font-semibold disabled:pointer-events-none disabled:opacity-70 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground border-primary-edge shadow-press hover:bg-primary-hover disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-transparent disabled:shadow-none",
        destructive:
          // The solid ink stays near-white in both themes; see index.css on --destructive-solid-foreground.
          "bg-destructive text-destructive-solid-foreground shadow-press-destructive hover:bg-destructive/90 dark:bg-destructive/60 disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none",
        outline:
          "border-input bg-card text-foreground shadow-control dark:shadow-none hover:bg-secondary dark:bg-transparent dark:hover:bg-secondary",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-accent disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground",
        ghost: "text-foreground hover:bg-secondary",
        link: "h-auto border-0 px-0 text-link underline-offset-4 hover:underline",
      },
      size: {
        default: "h-[38px] px-4 has-[>svg]:px-3.5",
        sm: "h-8 gap-1.5 px-3 text-[13.5px] has-[>svg]:px-2.5",
        lg: "h-[42px] px-5 text-[15px] has-[>svg]:px-4",
        icon: "size-[38px]",
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

  // Radix's `Slot` requires EXACTLY one element child (or a `Slottable`-wrapped one) to merge its own
  // props onto — `React.Children.count` counts a `false` entry as an occupied slot just like a real
  // element, so `{loading && <Icon/>}{children}` (two JSX expressions, only one of them typically
  // truthy) already reads as TWO children the instant `asChild` is true, regardless of `loading`'s
  // value — Slot then throws "Expected a single React element child or `Slottable`" rather than
  // silently picking one. `<Slottable>` marks `props.children` as the one Slot should actually forward
  // props to, letting the loading icon render alongside it as an ordinary sibling — the plain
  // `<button>` path (`asChild` false) is untouched, `Slottable` being a no-op wrapper there.
  return (
    <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props}>
      {loading && <Loader2Icon className="animate-spin motion-reduce:animate-none" />}
      {asChild ? <Slottable>{props.children}</Slottable> : props.children}
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
