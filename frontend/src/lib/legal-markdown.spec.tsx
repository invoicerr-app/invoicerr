import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { LegalMarkdown } from "./legal-markdown"

describe("LegalMarkdown", () => {
  it("renders a bracketed-title admonition as a callout with its title", () => {
    const { container } = render(
      <LegalMarkdown
        content={[
          "",
          ":::warning[Draft]",
          "Draft — not yet reviewed by counsel.",
          ":::",
          "",
          "Body text.",
        ].join("\n")}
      />,
    )

    expect(container).not.toHaveTextContent(":::")
    expect(container).not.toHaveTextContent("[Draft]")
    const title = screen.getByText("Draft")
    expect(title.parentElement).toHaveClass("border-s-warning")
    expect(title.parentElement).toHaveTextContent("Draft — not yet reviewed by counsel.")
    expect(screen.getByText("Body text.")).toBeInTheDocument()
  })

  it("renders a bracketed title containing spaces", () => {
    render(<LegalMarkdown content={[":::warning[Wersja robocza]", "Body.", ":::"].join("\n")} />)

    expect(screen.getByText("Wersja robocza").parentElement).toHaveClass("border-s-warning")
  })

  it("renders the space-separated title form as a callout", () => {
    const { container } = render(
      <LegalMarkdown
        content={[":::warning Draft", "Draft — not yet reviewed by counsel.", ":::"].join("\n")}
      />,
    )

    expect(container).not.toHaveTextContent(":::")
    expect(screen.getByText("Draft").parentElement).toHaveClass("border-s-warning")
  })

  it("renders a bracketed-title admonition with CRLF line endings", () => {
    const { container } = render(
      <LegalMarkdown content={[":::warning[Draft]", "Body.", ":::"].join("\r\n")} />,
    )

    expect(container).not.toHaveTextContent(":::")
    expect(screen.getByText("Draft").parentElement).toHaveClass("border-s-warning")
  })

  it("leaves a fence whose tone runs into other text as plain text", () => {
    const { container } = render(<LegalMarkdown content={[":::warningDraft", "Body.", ":::"].join("\n")} />)

    expect(container).toHaveTextContent(":::warningDraft")
    expect(container.querySelector(".border-s-warning")).toBeNull()
  })

  it("falls back to the tone's default title when none is given", () => {
    render(<LegalMarkdown content={[":::info", "Body.", ":::"].join("\n")} />)

    expect(screen.getByText("Info").parentElement).toHaveClass("border-s-info")
  })

  it("renders every admonition of a document with several, keeping the text between them", () => {
    const { container } = render(
      <LegalMarkdown
        content={[
          ":::warning[Draft]",
          "First body.",
          ":::",
          "",
          "Between.",
          "",
          ":::danger Careful",
          "Second body.",
          ":::",
          "",
          ":::tip[Hint]",
          "Third body.",
          ":::",
        ].join("\n")}
      />,
    )

    expect(container).not.toHaveTextContent(":::")
    expect(screen.getByText("Draft").parentElement).toHaveClass("border-s-warning")
    expect(screen.getByText("Careful").parentElement).toHaveClass("border-s-destructive")
    expect(screen.getByText("Hint").parentElement).toHaveClass("border-s-info")
    expect(screen.getByText("Between.")).toBeInTheDocument()
    expect(screen.getByText("Third body.")).toBeInTheDocument()
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
