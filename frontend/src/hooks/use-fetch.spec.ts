import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { usePost } from "./use-fetch"

/**
 * `createMethodHook`'s own `trigger` builds the request in two passes — the caller's raw
 * `options`/`extraOptions`, then a computed `headers`/`body` — and the ORDER those are spread in is
 * what decides which one wins on a key collision. Both cases below pass an `extraOptions.headers` or
 * `options.body` a caller could realistically pass; before the fix, the later `...options`/
 * `...extraOptions` spread silently overwrote the merged headers and the serialized body with the
 * raw, unmerged ones.
 */
function mockFetchOnce() {
  // Typed with both params (even though the mock body ignores them) so `.mock.calls[0]` below comes
  // back as a real 2-tuple `[input, init]`, not the `[]` vitest would otherwise infer from a
  // zero-argument implementation.
  const fn = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("{}", { status: 200 }),
  )
  vi.stubGlobal("fetch", fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("createMethodHook (usePost) — request assembly order", () => {
  it("merges the hook's own header with a per-call one, instead of the later one dropping the other", async () => {
    const fetchMock = mockFetchOnce()
    // One header fixed at the HOOK's own creation (`options`), one added on this ONE call
    // (`extraOptions`) — the exact two sources `trigger` merges.
    const { result } = renderHook(() => usePost("/api/things", { headers: { "X-Api-Version": "2" } }))

    await act(async () => {
      await result.current.trigger({ name: "x" }, { headers: { "X-Trace-Id": "abc" } })
    })

    const [, init] = fetchMock.mock.calls[0]
    const headers = init?.headers as Record<string, string>
    expect(headers["X-Api-Version"]).toBe("2")
    expect(headers["X-Trace-Id"]).toBe("abc")
  })

  it("passes a FormData body through untouched, never JSON.stringify-ing it into '{}'", async () => {
    const fetchMock = mockFetchOnce()
    const { result } = renderHook(() => usePost("/api/uploads"))

    const form = new FormData()
    form.append("file", new Blob(["content"]), "file.txt")

    await act(async () => {
      await result.current.trigger(form)
    })

    const [, init] = fetchMock.mock.calls[0]
    expect(init?.body).toBe(form)
  })

  it("still JSON-serializes a plain object body, from options.body as well as the trigger argument", async () => {
    const fetchMock = mockFetchOnce()
    // `UseRequestOptions.body` is typed `any` precisely so a caller CAN hand it a plain object here
    // (rather than an already-serialized `BodyInit`) — the cast only works around `RequestInit`'s own
    // stricter `body` type winning the literal check, not around anything this test itself needs.
    const optionsWithBody = { body: { fallback: true } } as unknown as Parameters<typeof usePost>[1]
    const { result } = renderHook(() => usePost("/api/things", optionsWithBody))

    await act(async () => {
      await result.current.trigger()
    })

    const [, init] = fetchMock.mock.calls[0]
    expect(init?.body).toBe(JSON.stringify({ fallback: true }))
  })
})
