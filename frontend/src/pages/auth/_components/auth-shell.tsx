import type * as React from "react"
import { useTranslation } from "react-i18next"

import { BrandWordmark } from "@/components/brand-wordmark"
import { BetaBanner } from "@/components/beta-banner"
import { Separator } from "@/components/ui/separator"
import { isBetaBannerEnabled } from "@/lib/runtime-config"

interface AuthShellProps {
  title: string
  description?: string
  /** Secondary links under the card body — "no account yet?", "already registered?". */
  footer?: React.ReactNode
  dataCy?: string
  children: React.ReactNode
}

/** A finished invoice, tilted on the accent ground: the product object instead of a stock image. */
function AuthPaper() {
  const { t, i18n } = useTranslation()
  const money = new Intl.NumberFormat(i18n.resolvedLanguage, {
    style: "currency",
    currency: t("auth.shell.sample.currency"),
  })
  const lines: [string, number][] = [
    [t("auth.shell.sample.line1"), 2080],
    [t("auth.shell.sample.line2"), 780],
    [t("auth.shell.sample.line3"), 290],
  ]
  return (
    <div
      aria-hidden="true"
      className="w-[min(380px,80%)] rotate-[-4deg] rounded-md bg-paper p-8 text-paper-ink shadow-sheet"
    >
      <p className="font-heading text-[28px] leading-none">{t("auth.shell.sample.title")}</p>
      <p className="mt-2 text-xs text-paper-mute">{t("auth.shell.sample.reference")}</p>
      <div className="mt-6 divide-y divide-paper-line text-sm">
        {lines.map(([label, amount]) => (
          <div key={label} className="flex items-baseline justify-between gap-4 py-2.5">
            <span>{label}</span>
            <span className="amount">{money.format(amount)}</span>
          </div>
        ))}
      </div>
      <p className="amount mt-5 text-end text-[32px] leading-none">{money.format(3737.95)}</p>
      <p className="mt-2 text-end text-xs text-paper-mute">{t("auth.shell.sample.approved")}</p>
    </div>
  )
}

/**
 * The one frame both auth pages share: the form in a quiet column on the ground, and on a wide
 * screen a second half showing an invoice sheet. Its own scroll container (`html` is
 * `overflow: hidden` app-wide), so a sign-up form taller than a small phone can still be scrolled.
 */
export function AuthShell({ title, description, footer, dataCy, children }: AuthShellProps) {
  const { t } = useTranslation()
  return (
    <div className="grid h-dvh overflow-y-auto bg-background text-foreground lg:grid-cols-2">
      <div className="flex min-h-full flex-col px-5 py-8 sm:px-12 lg:px-20 xl:px-24">
        <BrandWordmark />
        <div className="flex flex-1 flex-col justify-center py-10">
          {/* Instance-wide, never page-specific: checked once here for every auth page. */}
          {isBetaBannerEnabled() && <BetaBanner className="mb-6 w-full max-w-[430px]" />}
          <div className="w-full max-w-[430px]" data-cy={dataCy}>
            <h1 className="text-[34px] leading-tight">{title}</h1>
            {description && <p className="mt-2 text-ink-2">{description}</p>}
            <div className="mt-7 space-y-5">{children}</div>
            {footer && <div className="mt-6 flex flex-col gap-1.5 text-sm">{footer}</div>}
          </div>
        </div>
      </div>
      <div className="relative hidden flex-col items-center justify-center overflow-hidden bg-accent lg:flex">
        <AuthPaper />
        <p className="absolute start-12 bottom-12 max-w-xs font-heading text-[28px] leading-tight text-accent-foreground">
          {t("auth.shell.tagline")}
        </p>
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
      <span className="text-xs font-medium text-muted-foreground">{t("auth.or")}</span>
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
      className="focus-ring rounded-sm font-semibold text-link underline-offset-4 hover:underline"
      data-cy={dataCy}
    >
      {children}
    </a>
  )
}
