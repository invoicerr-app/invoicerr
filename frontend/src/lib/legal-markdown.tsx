import type { AnchorHTMLAttributes } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

/**
 * Renders a legal document's markdown body as real React elements (via `react-markdown` +
 * `remark-gfm` for the one table these documents use — Privacy Policy §"Data We Collect") instead of
 * `dangerouslySetInnerHTML`: there is no HTML string produced at all, so there is nothing to sanitize
 * and nothing for `lint/security/noDangerouslySetInnerHtml` to flag. The backend serves these five
 * documents as plain markdown text with no server-side sanitization of its own
 * (`legal-documents.ts`) — this is still the one place that renders it, just without ever turning it
 * into a raw-HTML string first. Shared by `pages/legal/[slug].tsx` and `pages/legal/accept.tsx` so the
 * two never drift on how a legal document actually renders.
 */
export function LegalMarkdown({ content, className }: { content: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Every link in these documents is either a cross-document reference or an external URL —
          // never in-app navigation — so it always opens in a new tab, with `rel="noopener"` since
          // `target="_blank"` alone still leaks a `window.opener` handle to the destination.
          a: ({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
            <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

/**
 * Hand-rolled typographic styling for rendered legal-document markup, via Tailwind's `[&_x]:`
 * arbitrary descendant variants — this project has no `@tailwindcss/typography` plugin installed, so
 * a bare `prose` class would be a silent no-op rather than a mistake worth chasing down later. Covers
 * exactly what these five documents actually use: headings, lists, links, `<hr>` section breaks,
 * `<strong>`, and the one table in the Privacy Policy.
 */
export const LEGAL_CONTENT_CLASSNAME =
  "space-y-4 text-sm leading-relaxed text-foreground " +
  "[&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight " +
  "[&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-semibold " +
  "[&_p]:mt-2 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mt-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mt-1 " +
  "[&_a]:underline [&_a]:decoration-border [&_a]:underline-offset-4 [&_a]:hover:decoration-foreground " +
  "[&_hr]:my-6 [&_hr]:border-border [&_strong]:font-semibold " +
  "[&_table]:mt-2 [&_table]:w-full [&_table]:border-collapse [&_table]:text-left [&_table]:text-xs " +
  "[&_th]:border-b [&_th]:border-border [&_th]:pb-1 [&_th]:pr-3 [&_td]:border-b [&_td]:border-border/50 [&_td]:py-1 [&_td]:pr-3"
