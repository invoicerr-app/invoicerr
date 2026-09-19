import { useTranslation } from "react-i18next"

import { cn } from "@/lib/utils"
import { useLegalDocuments } from "@/hooks/queries"
import type { LegalDocumentView } from "@/hooks/queries"

/**
 * The curated set, in the order they should read — an instant, no-fetch baseline so this row never
 * blanks out while `useLegalDocuments()` below is still in flight (or fails outright: a legal link
 * list is exactly the thing that should keep working when the backend is having a bad moment).
 * Kept in sync manually for its LABELS (translated, short) — coverage is not: see `documents` below,
 * which is what actually decides which of these render, and what else renders alongside them.
 */
const LEGAL_LINKS = [
  { slug: "terms-of-service", key: "legal.links.terms", fallback: "Terms" },
  { slug: "privacy-policy", key: "legal.links.privacy", fallback: "Privacy" },
  { slug: "data-processing-agreement", key: "legal.links.dpa", fallback: "DPA" },
  { slug: "legal-notice", key: "legal.links.legalNotice", fallback: "Legal notice" },
  { slug: "cookies-and-acceptable-use", key: "legal.links.cookies", fallback: "Cookies" },
  // Regulation (EU) 2023/2854 (the EU Data Act), Article 28 requires this page to be *publicly
  // available*, not merely reachable by URL — it is served by `GET /api/legal/documents` like the
  // other five, and a hardcoded list here is exactly how it once ended up served but linked from
  // nothing. Kept as a curated entry (a short label reads better than the full document title in a
  // compact row) rather than relying only on the fallback path below.
  {
    slug: "international-access-transparency",
    key: "legal.links.internationalAccess",
    fallback: "International access",
  },
] as const

interface LinkEntry {
  slug: string
  label: string
}

/**
 * Reconciles the curated labels above against whatever `GET /api/legal/documents` actually serves
 * right now: a curated entry only renders while its document still exists (`documents` undefined —
 * fetch not settled yet — is treated as "assume yes", so the baseline shows immediately); any served
 * document that ISN'T in the curated list still gets a link, labelled with its own (already localized
 * by the backend) title. That second half is the whole point — it is what makes forgetting to add a
 * new document here harmless instead of a silent gap. See `legal-links.spec.tsx`.
 */
function reconcileLinks(
  documents: LegalDocumentView[] | undefined,
  t: (key: string, fallback: string) => string,
) {
  const curated: LinkEntry[] = LEGAL_LINKS.filter(
    (link) => documents === undefined || documents.some((doc) => doc.slug === link.slug),
  ).map((link) => ({ slug: link.slug, label: t(link.key, link.fallback) }))

  const curatedSlugs = new Set<string>(LEGAL_LINKS.map((link) => link.slug))
  const uncurated: LinkEntry[] = (documents ?? [])
    .filter((doc) => !curatedSlugs.has(doc.slug))
    .map((doc) => ({ slug: doc.slug, label: doc.title }))

  return [...curated, ...uncurated]
}

/**
 * A quiet row of links to every legal document the backend currently serves — Terms · Privacy · DPA
 * · Legal notice · Cookies · International access · anything added after this comment was written.
 * Mounted three times: below the sign-in/sign-up card (`sign-in.tsx`, `sign-up.tsx` — a visitor has
 * accepted nothing yet, so the destination page's own version/date is all there is to show), and as
 * a persistent line in the authenticated app shell (`(app)/_layout.tsx`) so a signed-in user is never
 * more than this one row away from what they agreed to, on any screen — not only a settings tab or
 * an account page they would first have to think to open.
 *
 * NOT wired into `pages/auth/_components/auth-shell.tsx` itself: that shell's own outer frame is a
 * fixed `h-dvh` region with no slot below the card, and it is one of the files this task was told not
 * to touch (a parallel branding change owns it this cycle). `sign-in.tsx`/`sign-up.tsx` render this
 * component as a sibling of `<AuthShell>`, which is the most this file can do without editing that
 * shell; making it visually reachable below the fold is left to whoever next touches `auth-shell.tsx`.
 */
export function LegalLinks({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { data } = useLegalDocuments()
  const links = reconcileLinks(data?.documents, t)

  if (links.length === 0) return null

  return (
    <nav
      className={cn(
        "flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground",
        className,
      )}
      data-cy="legal-links"
      aria-label={t("legal.links.navLabel", "Legal")}
    >
      {links.map((link, index) => (
        <span key={link.slug} className="flex items-center gap-x-3">
          <a
            href={`/legal/${link.slug}`}
            className="underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 rounded-sm"
            data-cy={`legal-link-${link.slug}`}
          >
            {link.label}
          </a>
          {index < links.length - 1 && <span aria-hidden="true">·</span>}
        </span>
      ))}
    </nav>
  )
}
