import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { usePost, useSse } from "./use-fetch"

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

/** jsdom has no native `EventSource` — this fake is the minimum surface `useSse` actually touches
 *  (constructor, `.close()`, the three `on*` handler slots), plus a way for a test to fire an event
 *  on a specific instance and see how many instances the hook has created so far. */
class FakeEventSource {
  static instances: FakeEventSource[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  closed = false

  constructor(public url: string) {
    FakeEventSource.instances.push(this)
  }

  close() {
    this.closed = true
  }
}

function mockEventSource() {
  FakeEventSource.instances = []
  vi.stubGlobal("EventSource", FakeEventSource)
  return FakeEventSource
}

describe("useSse — reconnection after a network error", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("does not die permanently on the first error — reopens after the base backoff delay", () => {
    mockEventSource()
    renderHook(() => useSse("/api/documents/events"))
    expect(FakeEventSource.instances).toHaveLength(1)

    act(() => {
      FakeEventSource.instances[0].onerror?.(new Event("error"))
    })
    // The dead connection is closed immediately (disabling the browser's OWN auto-reconnect)...
    expect(FakeEventSource.instances[0].closed).toBe(true)
    // ...but nothing reopens until the backoff delay actually elapses.
    expect(FakeEventSource.instances).toHaveLength(1)

    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(FakeEventSource.instances).toHaveLength(2)
  })

  it("doubles the delay on consecutive failures, and resets it after a successful open", () => {
    mockEventSource()
    renderHook(() => useSse("/api/documents/events"))

    act(() => {
      FakeEventSource.instances[0].onerror?.(new Event("error"))
    })
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(FakeEventSource.instances).toHaveLength(2)

    // Second CONSECUTIVE failure, with no successful open in between — the delay doubled to 2s, so
    // waiting only the base 1s is not enough yet.
    act(() => {
      FakeEventSource.instances[1].onerror?.(new Event("error"))
    })
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(FakeEventSource.instances).toHaveLength(2)
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(FakeEventSource.instances).toHaveLength(3)

    // This one opens successfully before failing again — the backoff resets, so the NEXT failure
    // only waits the base delay, not a further-doubled one.
    act(() => {
      FakeEventSource.instances[2].onopen?.()
      FakeEventSource.instances[2].onerror?.(new Event("error"))
    })
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(FakeEventSource.instances).toHaveLength(4)
  })

  it("close() cancels any reconnect already scheduled", () => {
    mockEventSource()
    const { result } = renderHook(() => useSse("/api/documents/events"))

    act(() => {
      FakeEventSource.instances[0].onerror?.(new Event("error"))
    })
    act(() => {
      result.current.close()
    })
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  it("carries the last message's event id into the reconnect URL, when the server sent one", () => {
    mockEventSource()
    renderHook(() => useSse("/api/documents/events"))

    act(() => {
      FakeEventSource.instances[0].onmessage?.(new MessageEvent("message", { data: "{}", lastEventId: "42" }))
      FakeEventSource.instances[0].onerror?.(new Event("error"))
    })
    act(() => {
      vi.advanceTimersByTime(1_000)
    })

    expect(FakeEventSource.instances[1].url).toContain("lastEventId=42")
  })
})
