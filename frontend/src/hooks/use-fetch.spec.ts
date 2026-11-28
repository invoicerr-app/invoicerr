import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { authenticatedFetch, usePost, useSse } from "./use-fetch"

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

describe("authenticatedFetch — Content-Type", () => {
  it("never forces application/json onto a FormData body — the browser computes its own multipart boundary", async () => {
    const fetchMock = mockFetchOnce()
    const form = new FormData()
    form.append("file", new Blob(["content"]), "file.txt")

    await authenticatedFetch("/api/documents/attachments/upload", { method: "POST", body: form })

    const [, init] = fetchMock.mock.calls[0]
    const headers = init?.headers as Record<string, string>
    expect(headers["Content-Type"]).toBeUndefined()
  })

  it("still defaults every OTHER body to application/json, unchanged", async () => {
    const fetchMock = mockFetchOnce()

    await authenticatedFetch("/api/things", { method: "POST", body: JSON.stringify({ a: 1 }) })

    const [, init] = fetchMock.mock.calls[0]
    const headers = init?.headers as Record<string, string>
    expect(headers["Content-Type"]).toBe("application/json")
  })
})

describe("createMethodHook (usePost) - request body", () => {
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

  it("still JSON-serializes a plain object body passed to trigger", async () => {
    const fetchMock = mockFetchOnce()
    const { result } = renderHook(() => usePost("/api/things"))

    await act(async () => {
      await result.current.trigger({ fallback: true })
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
