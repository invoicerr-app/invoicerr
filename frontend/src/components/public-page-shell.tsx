import type * as React from "react"
import { useTranslation } from "react-i18next"

import { BrandWordmark } from "@/components/brand-wordmark"
import { cn } from "@/lib/utils"

interface PublicPageShellProps {
  /** The issuing company shown in the header — its name, and its branding logo when it uploaded one.
   *  Absent (nothing resolved yet, an invalid link) the header falls back to the product wordmark. */
  company?: { name: string; logo?: string | null } | null
  /** Right side of the header — at most one quiet control (sign out). */
  actions?: React.ReactNode
  /** `narrow` for a single centred card (signature), `default` for a document list (portal). */
  width?: "default" | "narrow"
  dataCy?: string
  children: React.ReactNode
}

/**
 * The one frame every PUBLIC page shares — the client portal and the signature page: no sidebar, no
 * staff session, the ISSUING company's identity in the header (this is their client's screen, not
 * ours) and a discreet "Powered by" line at the foot. Its own scroll container, because `html` is
 * `overflow: hidden` app-wide (`index.css`) and these pages sit outside the app layout that normally
 * provides the scrolling region — without it a long statement could not be scrolled on a phone.
 *
 * The background wash is the only decoration: a faint radial of the primary hue fading into the page
 * background, so the page reads as belonging to the same product as the app without an illustration.
 */
export function PublicPageShell({
  company,
  actions,
  width = "default",
  dataCy,
  children,
}: PublicPageShellProps) {
  const { t } = useTranslation()
  const column = width === "narrow" ? "max-w-md" : "max-w-3xl"

  return (
    <div
      className="flex h-dvh flex-col overflow-y-auto bg-background bg-radial-[90%_45%_at_50%_-15%] from-primary/15 to-transparent text-foreground"
      data-cy={dataCy}
    >
      <header
        className={cn("mx-auto flex w-full items-center justify-between gap-4 px-4 py-4 sm:px-6", column)}
      >
        {company ? (
          <div className="flex min-w-0 items-center gap-3">
            {company.logo && (
              <img
                src={company.logo}
                alt=""
                className="size-9 shrink-0 rounded-md bg-card object-contain ring-1 ring-border"
              />
            )}
            <span className="truncate font-heading text-lg font-semibold tracking-tight">{company.name}</span>
          </div>
        ) : (
          <BrandWordmark />
        )}
        {actions}
      </header>
      <main className={cn("mx-auto w-full flex-1 px-4 pb-10 sm:px-6", column)}>{children}</main>
      <footer
        className={cn(
          "mx-auto flex w-full items-center justify-center gap-1.5 px-4 py-6 text-xs text-muted-foreground sm:px-6",
          column,
        )}
      >
        <span>{t("publicPage.poweredBy")}</span>
        <BrandWordmark size="sm" className="text-muted-foreground [&>span]:text-muted-foreground" />
      </footer>
    </div>
  )
}
