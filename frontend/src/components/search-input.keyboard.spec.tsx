import { fireEvent, render, screen, within } from "@testing-library/react"
import { useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import SearchSelect from "@/components/search-input"

const OPTIONS = [
  { value: "eur", label: "Euro" },
  { value: "usd", label: "US Dollar" },
  { value: "gbp", label: "Pound" },
]

function Harness({ onChange }: { onChange: (value: string) => void }) {
  const [value, setValue] = useState("")
  const [search, setSearch] = useState("")
  const filtered = OPTIONS.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
  return (
    <SearchSelect
      options={filtered}
      allOptions={OPTIONS}
      value={value}
      onSearchChange={setSearch}
      onValueChange={(v) => {
        setValue(v as string)
        onChange(v as string)
      }}
      data-cy="currency"
    />
  )
}

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

function openDropdown(onChange = vi.fn()) {
  render(<Harness onChange={onChange} />)
  fireEvent.click(screen.getByRole("button"))
  return { onChange, input: screen.getByRole("combobox") }
}

function press(input: HTMLElement, ...keys: string[]) {
  for (const key of keys) fireEvent.keyDown(input, { key })
}

function activeOption(input: HTMLElement) {
  return document.getElementById(input.getAttribute("aria-activedescendant") ?? "")
}

describe("SearchSelect keyboard navigation", () => {
  it("ArrowDown then Enter selects the second option", () => {
    const { onChange, input } = openDropdown()
    press(input, "ArrowDown", "Enter")
    expect(onChange).toHaveBeenCalledExactlyOnceWith("usd")
  })

  it("ArrowUp moves back to the previous option", () => {
    const { onChange, input } = openDropdown()
    press(input, "ArrowDown", "ArrowDown", "ArrowUp", "Enter")
    expect(onChange).toHaveBeenCalledExactlyOnceWith("usd")
  })

  it("clamps at both ends of the list", () => {
    const { onChange, input } = openDropdown()
    press(input, "ArrowUp", "ArrowUp")
    expect(activeOption(input)).toHaveTextContent("Euro")
    press(input, "ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown", "Enter")
    expect(onChange).toHaveBeenCalledExactlyOnceWith("gbp")
  })

  it("exposes the highlighted option to assistive technology", () => {
    const { input } = openDropdown()
    const listbox = screen.getByRole("listbox")
    expect(within(listbox).getAllByRole("option")).toHaveLength(3)
    expect(input).toHaveAttribute("aria-controls", listbox.id)
    press(input, "ArrowDown")
    expect(activeOption(input)).toHaveTextContent("US Dollar")
    expect(activeOption(input)).toHaveAttribute("role", "option")
  })

  it("scrolls the highlighted option into view", () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const { input } = openDropdown()
    press(input, "ArrowDown")
    expect(scrollIntoView.mock.contexts.at(-1)).toHaveTextContent("US Dollar")
  })

  it("Escape closes without changing the value", () => {
    const { onChange, input } = openDropdown()
    press(input, "ArrowDown", "Escape")
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it("typing a filter resets the highlight to the first match", () => {
    const { onChange, input } = openDropdown()
    press(input, "ArrowDown", "ArrowDown")
    fireEvent.change(input, { target: { value: "o" } })
    expect(activeOption(input)).toHaveTextContent("Euro")
    press(input, "Enter")
    expect(onChange).toHaveBeenCalledExactlyOnceWith("eur")
  })

  it("Enter with no match selects nothing", () => {
    const { onChange, input } = openDropdown()
    fireEvent.change(input, { target: { value: "zzz" } })
    press(input, "Enter")
    expect(onChange).not.toHaveBeenCalled()
  })

  it("a mouse click still selects", () => {
    const { onChange } = openDropdown()
    fireEvent.click(screen.getByRole("option", { name: "Pound" }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith("gbp")
  })
})
