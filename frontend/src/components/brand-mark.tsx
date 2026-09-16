import { useId, type ComponentPropsWithoutRef } from "react"

import { cn } from "@/lib/utils"

interface BrandMarkProps extends Omit<ComponentPropsWithoutRef<"svg">, "viewBox" | "fill" | "children"> {
  className?: string
}

/**
 * The Invoicerr mark alone — identity "Lagune", pick "07 Faille": a rounded plane (the document)
 * cut once by a single clean diagonal, both halves still legibly one shape — the moment an invoice
 * settles, not two unrelated pieces. Inlined (not an `<img>`) so `fill="currentColor"` lets the
 * caller's text color decide ink-on-light vs. near-white-on-dark: pass `text-foreground` /
 * `text-sidebar-foreground` and it never needs a separate light/dark file, and it can never land
 * as azure-on-azure (the brand rule this shape was measured against — ink-on-azure is 5.14:1,
 * white-on-azure fails WCAG AA at 3.27:1 — see the icon variant at `/brand/logo-icon.svg`, which
 * is the one place azure ever IS the ground).
 *
 * `useId()` namespaces the clip-path ids: this renders inline (not as an `<img src>`), so two
 * instances on one page (e.g. `PublicPageShell`'s header + footer, both via `BrandWordmark`) would
 * otherwise collide on the same `id` and silently clip nothing for the second one.
 */
export function BrandMark({ className, ...props }: BrandMarkProps) {
  const uid = useId()
  const clipA = `brand-mark-a-${uid}`
  const clipB = `brand-mark-b-${uid}`
  return (
    <svg
      viewBox="0 0 512 512"
      fill="none"
      aria-hidden="true"
      className={cn("shrink-0", className)}
      {...props}
    >
      <defs>
        <clipPath id={clipA}>
          <path d="M533.494 -600.41 L-61.136 1098.535 L-910.609 801.22 L-315.978 -897.725 Z" />
        </clipPath>
        <clipPath id={clipB}>
          <path d="M573.136 -586.535 L-21.494 1112.41 L827.978 1409.725 L1422.609 -289.22 Z" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipA})`}>
        <path
          d="M168 96H344A72 72 0 0 1 416 168V344A72 72 0 0 1 344 416H168A72 72 0 0 1 96 344V168A72 72 0 0 1 168 96Z"
          fill="currentColor"
        />
      </g>
      <g transform="translate(18.5 -52.856)" clipPath={`url(#${clipB})`}>
        <path
          d="M168 96H344A72 72 0 0 1 416 168V344A72 72 0 0 1 344 416H168A72 72 0 0 1 96 344V168A72 72 0 0 1 168 96Z"
          fill="currentColor"
        />
      </g>
    </svg>
  )
}
