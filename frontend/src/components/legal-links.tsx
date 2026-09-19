import { useTranslation } from "react-i18next"

import { cn } from "@/lib/utils"

/** slug + i18n key + English fallback, in the order they should read. */
const LEGAL_LINKS = [
  { slug: "terms-of-service", key: "legal.links.terms", fallback: "Terms" },
  { slug: "privacy-policy", key: "legal.links.privacy", fallback: "Privacy" },
  { slug: "data-processing-agreement", key: "legal.links.dpa", fallback: "DPA" },
  { slug: "legal-notice", key: "legal.links.legalNotice", fallback: "Legal notice" },
  { slug: "cookies-and-acceptable-use", key: "legal.links.cookies", fallback: "Cookies" },
] as const

/**
 * A quiet row of links to the five legal documents (`pages/legal/[slug].tsx`) — Terms · Privacy ·
 * DPA · Legal notice · Cookies. Meant to sit below the sign-in/sign-up card.
 *
 * NOT wired into `pages/auth/_components/auth-shell.tsx` itself: that shell's own outer frame is a
 * fixed `h-dvh` region with no slot below the card, and it is one of the files this task was told not
 * to touch (a parallel branding change owns it this cycle) — see this feature's own final report.
 * `sign-in.tsx`/`sign-up.tsx` render this component as a sibling of `<AuthShell>`, which is the most
 * this file can do without editing that shell; making it visually reachable below the fold is left to
 * whoever next touches `auth-shell.tsx`.
 */
export function LegalLinks({ className }: { className?: string }) {
  const { t } = useTranslation()

  return (
    <nav
      className={cn(
        "flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground",
        className,
      )}
      data-cy="legal-links"
      aria-label={t("legal.links.navLabel", "Legal")}
    >
      {LEGAL_LINKS.map((link, index) => (
        <span key={link.slug} className="flex items-center gap-x-3">
          <a
            href={`/legal/${link.slug}`}
            className="underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 rounded-sm"
            data-cy={`legal-link-${link.slug}`}
          >
            {t(link.key, link.fallback)}
          </a>
          {index < LEGAL_LINKS.length - 1 && <span aria-hidden="true">·</span>}
        </span>
      ))}
    </nav>
  )
}
