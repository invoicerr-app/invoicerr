import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { LegalMarkdown } from "./legal-markdown"

/**
 * `documentation/docs/legal/*.md` ships its "Draft — not yet reviewed by counsel" banner as a
 * Docusaurus admonition (`:::warning Draft` … `:::`), which used to reach the app verbatim as raw
 * `:::` punctuation (`/legal/privacy-policy` showed literally "Draft — not yet reviewed by
 * counsel." wrapped in stray colons). These specs pin the three cases that matter: the block renders
 * as a callout, markdown nested inside it still renders, and ordinary content with no admonition at
 * all is completely unaffected.
 */
describe("LegalMarkdown", () => {
  it("renders an admonition block as a callout, not raw `:::` punctuation", () => {
    render(
      <LegalMarkdown
        content={[":::warning Draft", "Draft — not yet reviewed by counsel.", ":::", "", "Body text."].join(
          "\n",
        )}
      />,
    )

    expect(screen.queryByText(/:::/)).not.toBeInTheDocument()
    expect(screen.getByText("Draft")).toBeInTheDocument()
    expect(screen.getByText("Draft — not yet reviewed by counsel.")).toBeInTheDocument()
    expect(screen.getByText("Body text.")).toBeInTheDocument()
  })

  it("renders markdown nested inside an admonition body", () => {
    render(
      <LegalMarkdown
        content={[":::note", "A **bold** word and:", "", "- one item", "- another item", ":::"].join("\n")}
      />,
    )

    const bold = screen.getByText("bold")
    expect(bold.tagName).toBe("STRONG")
    expect(screen.getByText("one item")).toBeInTheDocument()
    expect(screen.getByText("another item").tagName).toBe("LI")
  })

  it("leaves plain content with no admonition unchanged", () => {
    render(
      <LegalMarkdown
        content={["## Section 1", "", "Some **bold** prose with a [link](https://example.com)."].join("\n")}
      />,
    )

    expect(screen.queryByText(/:::/)).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 2, name: "Section 1" })).toBeInTheDocument()
    const link = screen.getByRole("link", { name: "link" })
    expect(link).toHaveAttribute("href", "https://example.com")
    expect(link).toHaveAttribute("target", "_blank")
  })
})
