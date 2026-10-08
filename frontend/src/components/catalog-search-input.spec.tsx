import { fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const options = [
  { id: "a1", label: "Alpha" },
  { id: "b2", label: "Beta" },
]
const useCatalogSearch = vi.fn()
vi.mock("@/hooks/use-catalog-search", () => ({
  useCatalogSearch: (...args: unknown[]) => useCatalogSearch(...args),
}))

import { CatalogSearchInput } from "@/components/catalog-search-input"

function Harness({ onCatalogSelect }: Readonly<{ onCatalogSelect: (id: string) => void }>) {
  const [value, setValue] = useState("")
  return (
    <CatalogSearchInput
      data-cy="field"
      entity="article"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onCatalogSelect={onCatalogSelect}
    />
  )
}

function typeText(text: string) {
  const input = screen.getByTestId("field")
  fireEvent.change(input, { target: { value: text } })
  return input
}

describe("CatalogSearchInput", () => {
  beforeEach(() => {
    useCatalogSearch.mockReset()
    useCatalogSearch.mockImplementation((_entity: string, _query: string, enabled: boolean) => ({
      options: enabled ? options : [],
    }))
  })

  it("shows no list until the user types", () => {
    render(<Harness onCatalogSelect={vi.fn()} />)
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  it("opens the list on typing and keeps the typed text", () => {
    render(<Harness onCatalogSelect={vi.fn()} />)
    const input = typeText("al")
    expect(screen.getByRole("listbox")).toBeInTheDocument()
    expect(input).toHaveValue("al")
    expect(input).toHaveAttribute("aria-expanded", "true")
  })

  it("moves the active option with the arrows, wrapping, and picks with Enter", () => {
    const onSelect = vi.fn()
    render(<Harness onCatalogSelect={onSelect} />)
    const input = typeText("a")

    fireEvent.keyDown(input, { key: "ArrowDown" })
    expect(screen.getByTestId("catalog-search-option-0")).toHaveAttribute("aria-selected", "true")
    fireEvent.keyDown(input, { key: "ArrowDown" })
    expect(screen.getByTestId("catalog-search-option-1")).toHaveAttribute("aria-selected", "true")
    fireEvent.keyDown(input, { key: "ArrowDown" })
    expect(screen.getByTestId("catalog-search-option-0")).toHaveAttribute("aria-selected", "true")
    fireEvent.keyDown(input, { key: "ArrowUp" })
    expect(screen.getByTestId("catalog-search-option-1")).toHaveAttribute("aria-selected", "true")
    expect(input).toHaveAttribute("aria-activedescendant", screen.getByTestId("catalog-search-option-1").id)

    fireEvent.keyDown(input, { key: "Enter" })
    expect(onSelect).toHaveBeenCalledWith("b2")
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  it("lets Enter through when no option is active", () => {
    const onSelect = vi.fn()
    render(<Harness onCatalogSelect={onSelect} />)
    const input = typeText("a")
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(true)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it("closes on Escape without changing the text", () => {
    render(<Harness onCatalogSelect={vi.fn()} />)
    const input = typeText("alp")
    fireEvent.keyDown(input, { key: "Escape" })
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(input).toHaveValue("alp")
  })

  it("picks with the mouse", () => {
    const onSelect = vi.fn()
    render(<Harness onCatalogSelect={onSelect} />)
    typeText("a")
    fireEvent.mouseDown(screen.getByTestId("catalog-search-option-0"))
    expect(onSelect).toHaveBeenCalledWith("a1")
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  it("closes on blur", () => {
    render(<Harness onCatalogSelect={vi.fn()} />)
    const input = typeText("a")
    fireEvent.blur(input)
    expect(screen.queryByRole("listbox")).toBeNull()
  })
})
