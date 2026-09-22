import { useId } from "react"
import { useTranslation } from "react-i18next"

import { activeCauseDay } from "@/brand/cause-days"
import { cn } from "@/lib/utils"

interface BrandMarkProps {
  className?: string
  /** Radix `Slot`-style hooks (`BrandWordmark` sets `"brand-mark"`) — the one passthrough attribute
   * every current caller actually uses, kept narrow (rather than the old `ComponentPropsWithoutRef<"svg">`)
   * because this can now render either an inline `<svg>` or an `<a>`/`<img>` pair, and only their
   * common HTML attributes are safe to forward to both. */
  "data-slot"?: string
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
 *
 * On the calendar days `activeCauseDay` names (International Women's Day, Pride Month...) the mark
 * itself becomes the day's evidence instead of a banner or a settings toggle: the exact same
 * geometry, refilled with that cause's own colours (`brand/causes/<variant>.svg` — a static file
 * here, not inlined, because those colours are fixed regardless of theme and don't need
 * `currentColor`). It is a pure function of the reader's own local calendar (no user preference
 * exists for this, and none was asked for) so every visitor sees the same cause on the same local
 * day without needing to be told why. The name and one-sentence description come from
 * `brand.causeDays.<id>` in `translation.json` (Weblate-managed, unlike this file's own English-only
 * comments) so the hover text is localized like every other user-facing string; the link + `title`
 * carry both instead of a tooltip component, since this has to work identically in every context
 * `BrandMark` is used (sidebar, footer, auth screens) without risking a link nested inside one of
 * those callers' own `<a>`.
 */
export function BrandMark({ className, ...props }: BrandMarkProps) {
  const uid = useId()
  const clipA = `brand-mark-a-${uid}`
  const clipB = `brand-mark-b-${uid}`
  const { t } = useTranslation()

  const cause = activeCauseDay(new Date())
  if (cause) {
    const label = t(`brand.causeDays.${cause.id}.label`)
    const description = t(`brand.causeDays.${cause.id}.description`)
    return (
      <a
        href={cause.source}
        target="_blank"
        rel="noreferrer"
        title={`${label} — ${description}`}
        className={cn("inline-flex shrink-0", className)}
        {...props}
      >
        <img src={`/brand/causes/${cause.variant}.svg`} alt={label} className="size-full" />
      </a>
    )
  }

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
