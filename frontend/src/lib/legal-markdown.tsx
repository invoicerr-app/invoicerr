import { Fragment, type AnchorHTMLAttributes, type ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { cn } from "@/lib/utils"

type AdmonitionTone = "note" | "tip" | "info" | "warning" | "danger"

interface TextSegment {
  kind: "text"
  content: string
}

interface AdmonitionSegment {
  kind: "admonition"
  tone: AdmonitionTone
  title: string
  content: string
}

type Segment = TextSegment | AdmonitionSegment

/**
 * Matches a Docusaurus container-directive admonition (`:::tone [Title]` … `:::`) — the syntax
 * `documentation/docs/legal/*.md` uses for its "Draft — not yet reviewed by counsel" banner. The
 * fence must sit at column 0 on its own line, true of every admonition these documents actually
 * contain, so a single non-greedy body match (stopping at the first closing `:::`) is enough; there
 * is no nesting to track.
 */
const ADMONITION_RE = /^:::(note|tip|info|warning|danger)(?:[ \t]+([^\n]*))?\r?\n([\s\S]*?)\r?\n:::[ \t]*$/gm

const ADMONITION_DEFAULT_TITLE: Record<AdmonitionTone, string> = {
  note: "Note",
  tip: "Tip",
  info: "Info",
  warning: "Warning",
  danger: "Danger",
}

// The design system only has three toned tokens (`--info`, `--warning`, `--destructive`, see
// `index.css`) — note/tip/info all read as the same neutral "informational" tone, and danger borrows
// the destructive token. There is no separate "success" reading for an admonition.
const ADMONITION_TONE_CLASSNAME: Record<AdmonitionTone, string> = {
  note: "border-l-info bg-info/10",
  tip: "border-l-info bg-info/10",
  info: "border-l-info bg-info/10",
  warning: "border-l-warning bg-warning/10",
  danger: "border-l-destructive bg-destructive/10",
}

/**
 * Splits a legal document's markdown body into an ordered list of plain-markdown and admonition
 * segments, each rendered by its own `ReactMarkdown` call. Deliberately a pre-processing pass on the
 * raw string rather than a remark plugin: these documents never nest one admonition inside another,
 * so an AST-level plugin would buy nothing over a single regex here, and it keeps this file's only
 * markdown dependencies the ones it already had (`react-markdown` + `remark-gfm`). Text with no
 * admonition at all comes back as one segment holding the untouched input, so the no-admonition case
 * renders exactly as it did before this split existed.
 */
function splitAdmonitions(content: string): Segment[] {
  const segments: Segment[] = []
  let lastIndex = 0
  for (const match of content.matchAll(ADMONITION_RE)) {
    const [full, rawTone, rawTitle, body] = match
    const index = match.index ?? 0
    if (index > lastIndex) {
      segments.push({ kind: "text", content: content.slice(lastIndex, index) })
    }
    const tone = rawTone as AdmonitionTone
    segments.push({
      kind: "admonition",
      tone,
      title: rawTitle?.trim() || ADMONITION_DEFAULT_TITLE[tone],
      content: body,
    })
    lastIndex = index + full.length
  }
  if (lastIndex < content.length || segments.length === 0) {
    segments.push({ kind: "text", content: content.slice(lastIndex) })
  }
  return segments
}

// Every link in these documents is either a cross-document reference or an external URL — never
// in-app navigation — so it always opens in a new tab, with `rel="noopener"` since `target="_blank"`
// alone still leaks a `window.opener` handle to the destination. Shared by both the plain-text and
// admonition-body renders below so a link never behaves differently depending on which block it's in.
const markdownComponents = {
  a: ({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
      {children}
    </a>
  ),
}

function renderMarkdown(content: string): ReactNode {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {content}
    </ReactMarkdown>
  )
}

/**
 * Renders a legal document's markdown body as real React elements (via `react-markdown` +
 * `remark-gfm` for the one table these documents use — Privacy Policy §"Data We Collect") instead of
 * `dangerouslySetInnerHTML`: there is no HTML string produced at all, so there is nothing to sanitize
 * and nothing for `lint/security/noDangerouslySetInnerHtml` to flag. The backend serves these five
 * documents as plain markdown text with no server-side sanitization of its own
 * (`legal-documents.ts`) — this is still the one place that renders it, just without ever turning it
 * into a raw-HTML string first. Shared by `pages/legal/[slug].tsx` and `pages/legal/accept.tsx` so the
 * two never drift on how a legal document actually renders. `:::note|tip|info|warning|danger [Title]`
 * … `:::` blocks (Docusaurus admonitions — these documents currently only ever use `:::warning
 * Draft`) are pulled out via `splitAdmonitions` and rendered as a toned, left-bordered callout instead
 * of showing up as raw `:::` punctuation.
 */
export function LegalMarkdown({ content, className }: { content: string; className?: string }) {
  const segments = splitAdmonitions(content)
  // `index` as `key` is safe here: `segments` is a fixed split of one static string on every
  // render, never reordered or individually inserted/removed. The `className` is hoisted into its
  // own short-named variable so the opening tag stays a single line — biome's `biome-ignore` for
  // `noArrayIndexKey` below only takes effect when the tag it's suppressing on isn't itself
  // reformatted onto multiple lines.
  const rendered = segments.map((segment, index) => {
    if (segment.kind === "admonition") {
      const toneClassName = cn(
        "my-4 rounded-r-md border-l-4 px-4 py-3",
        ADMONITION_TONE_CLASSNAME[segment.tone],
      )
      return (
        // biome-ignore lint/suspicious/noArrayIndexKey: see the comment above this map() call.
        <div key={index} className={toneClassName}>
          <p className="font-semibold">{segment.title}</p>
          {renderMarkdown(segment.content)}
        </div>
      )
    }
    // A `Fragment`, not a wrapping element: the parsed markdown's own top-level elements (h2, p, ul,
    // hr, table…) need to land as direct children of the container `div` below, exactly as they did
    // before admonitions were split out, so `LEGAL_CONTENT_CLASSNAME`'s `space-y-4` (which only
    // spaces *direct* children) keeps working unchanged for ordinary text.
    // biome-ignore lint/suspicious/noArrayIndexKey: see the comment above this map() call.
    return <Fragment key={index}>{renderMarkdown(segment.content)}</Fragment>
  })
  return <div className={className}>{rendered}</div>
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
