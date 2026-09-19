import type * as React from "react"
import { useTranslation } from "react-i18next"

import { BrandWordmark } from "@/components/brand-wordmark"
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

interface AuthShellProps {
  title: string
  description?: string
  /** Secondary links under the card body — "no account yet?", "already registered?". */
  footer?: React.ReactNode
  dataCy?: string
  children: React.ReactNode
}

/**
 * The one frame both auth pages share: a single card centred on the page background, the wordmark
 * above it, a faint radial wash of the primary hue behind everything. Its own scroll container
 * (`html` is `overflow: hidden` app-wide, see `index.css`), so a sign-up form taller than a small
 * phone's viewport can still be scrolled to its button.
 */
export function AuthShell({ title, description, footer, dataCy, children }: AuthShellProps) {
  return (
    <div className="flex h-dvh flex-col overflow-y-auto bg-background bg-radial-[90%_45%_at_50%_-15%] from-primary/15 to-transparent text-foreground">
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-10">
        <BrandWordmark className="mb-6" />
        <Card className="w-full max-w-sm gap-5 py-6 sm:max-w-md" data-cy={dataCy}>
          <CardHeader className="gap-1 text-center">
            <h1 className="font-heading text-xl font-semibold tracking-tight text-balance">{title}</h1>
            {description && <CardDescription className="text-pretty">{description}</CardDescription>}
          </CardHeader>
          <CardContent className="space-y-5">{children}</CardContent>
          {footer && <CardFooter className="flex-col gap-1.5 text-center text-sm">{footer}</CardFooter>}
        </Card>
      </div>
    </div>
  )
}

/** The "or" rule between the password form and the single-sign-on buttons. */
export function AuthSeparator() {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-3" role="separator" aria-orientation="horizontal">
      <Separator className="flex-1" />
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {t("auth.or")}
      </span>
      <Separator className="flex-1" />
    </div>
  )
}

/** A quiet inline link on the auth footer lines. */
export function AuthLink({
  href,
  dataCy,
  children,
}: {
  href: string
  dataCy?: string
  children: React.ReactNode
}) {
  return (
    <a
      href={href}
      className="font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 rounded-sm"
      data-cy={dataCy}
    >
      {children}
    </a>
  )
}
