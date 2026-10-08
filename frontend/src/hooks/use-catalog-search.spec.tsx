import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const useReferenceSearch = vi.fn()
vi.mock("@/hooks/queries", () => ({
  useReferenceSearch: (entity: string | undefined, query: string) => useReferenceSearch(entity, query),
}))

import { useCatalogSearch } from "@/hooks/use-catalog-search"

const OPTIONS = [{ id: "a1", label: "Widget" }]

describe("useCatalogSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useReferenceSearch.mockReset()
    useReferenceSearch.mockImplementation((entity: string | undefined) => ({
      data: entity ? OPTIONS : undefined,
    }))
  })
  afterEach(() => vi.useRealTimers())

  it("does not search until typing pauses", () => {
    const { result, rerender } = renderHook(({ q }) => useCatalogSearch("article", q, true), {
      initialProps: { q: "" },
    })
    rerender({ q: "wid" })
    expect(result.current.options).toEqual([])
    expect(useReferenceSearch).not.toHaveBeenCalledWith("article", "wid")

    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(useReferenceSearch).toHaveBeenCalledWith("article", "wid")
    expect(result.current.options).toEqual(OPTIONS)
  })

  it("withholds results while the debounce is behind the typed text", () => {
    const { result, rerender } = renderHook(({ q }) => useCatalogSearch("article", q, true), {
      initialProps: { q: "wid" },
    })
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(result.current.options).toEqual(OPTIONS)

    rerender({ q: "widg" })
    expect(result.current.options).toEqual([])
  })

  it("never searches an empty query or while disabled", () => {
    const { result, rerender } = renderHook(({ q, on }) => useCatalogSearch("article", q, on), {
      initialProps: { q: "   ", on: true },
    })
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(result.current.options).toEqual([])

    rerender({ q: "wid", on: false })
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(result.current.options).toEqual([])
    expect(useReferenceSearch.mock.calls.every(([entity]) => entity === undefined)).toBe(true)
  })
})
