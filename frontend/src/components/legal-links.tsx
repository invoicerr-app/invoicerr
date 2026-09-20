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
  { slug: "refund-policy", key: "legal.links.refund", fallback: "Refund policy" },
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
 *
 * On a self-hosted instance `documents` settles to the empty array (never `undefined` — the fetch
 * does resolve, it just carries nothing): every curated entry is filtered out and there is nothing
 * uncurated to add, so this returns `[]` once settled. The brief "assume yes" flash before that
 * fetch resolves is accepted, not fixed here — the same tradeoff `legal-links.spec.tsx`'s own
 * "shows the curated baseline immediately" case already accepts for a slow/failed request generally.
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
 * The reconciled link list on its own, with no rendering — `(app)/_layout.tsx` needs this to decide
 * whether its OWN `<footer>` wrapper (the bordered strip around `<LegalLinks/>`) should exist at all:
 * a `<footer className="border-t px-4 py-2">` around a component that renders `null` is still a
 * visible empty strip, since the border/padding live on the wrapper, not on what's inside it. Sharing
 * this hook (rather than duplicating the fetch+reconcile) means both call sites agree on "nothing to
 * show" from the exact same data, off the same cached query.
 */
export function useLegalLinks(): LinkEntry[] {
  const { t } = useTranslation()
  const { data } = useLegalDocuments()
  return reconcileLinks(data?.documents, t)
}

/**
 * A quiet row of links to every legal document the backend currently serves — Terms · Privacy · DPA
 * · Refund policy · Legal notice · Cookies · International access · anything added after this comment
 * was written.
 * Mounted three times: below the sign-in/sign-up card (`sign-in.tsx`, `sign-up.tsx` — a visitor has
 * accepted nothing yet, so the destination page's own version/date is all there is to show), and as
 * a persistent line in the authenticated app shell (`(app)/_layout.tsx`) so a signed-in user is never
 * more than this one row away from what they agreed to, on any screen — not only a settings tab or
 * an account page they would first have to think to open. Renders nothing at all — not even an empty
 * `<nav>` — once the backend settles on an empty catalogue (self-hosted mode): there is nothing to
 * link to, and a landmark with no content is not an accessibility improvement.
 *
 * NOT wired into `pages/auth/_components/auth-shell.tsx` itself: that shell's own outer frame is a
 * fixed `h-dvh` region with no slot below the card, and it is one of the files this task was told not
 * to touch (a parallel branding change owns it this cycle). `sign-in.tsx`/`sign-up.tsx` render this
 * component as a sibling of `<AuthShell>`, which is the most this file can do without editing that
 * shell; making it visually reachable below the fold is left to whoever next touches `auth-shell.tsx`.
 */
export function LegalLinks({ className }: { className?: string }) {
  const { t } = useTranslation()
  const links = useLegalLinks()

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
