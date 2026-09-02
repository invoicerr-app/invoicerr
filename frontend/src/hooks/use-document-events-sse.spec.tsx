import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import * as useFetchModule from "./use-fetch"
import { useDocumentEventsSse } from "./use-document-events-sse"

/**
 * TODO_PRODUIT.md T1 / PLAN-V2 R8 — proves the hook's OWN contract in isolation: on a message the
 * underlying `useSse` hands back, invalidate the matching TanStack query; before any message, and for
 * every distinct message afterwards, never anything else. `useSse` itself (the real `EventSource`
 * wiring) is mocked here — jsdom has no real SSE transport, and the REAL Redis round trip this
 * mechanism depends on is proven on the backend side
 * (`queue/__tests__/document-events-bridge.redis.spec.ts`) and end-to-end by Cypress
 * (28-document-async-send.cy.ts's own extended assertion, timed to be impossible via the slow polling
 * fallback alone — see `use-document-types.ts`'s own `SENDING_POLL_INTERVAL_MS` comment for why that
 * timing is what makes SSE provable at all).
 */
vi.mock("./use-fetch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./use-fetch")>()
  return { ...actual, useSse: vi.fn() }
})

const mockedUseSse = vi.mocked(useFetchModule.useSse)

function buildWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function sseResult(data: useFetchModule.useSseResult["data"]): useFetchModule.useSseResult {
  return { data, loading: false, error: null, close: vi.fn() }
}

describe("useDocumentEventsSse", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("never invalidates anything before a message has arrived", () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries")
    mockedUseSse.mockReturnValue(sseResult(null))

    renderHook(() => useDocumentEventsSse(), { wrapper: buildWrapper(queryClient) })

    expect(invalidateSpy).not.toHaveBeenCalled()
  })

  it("invalidates the document type's own query key when a status nudge arrives", () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries")
    mockedUseSse.mockReturnValue(sseResult({ documentId: "doc-1", typeId: "invoice", kind: "send_failed" }))

    renderHook(() => useDocumentEventsSse(), { wrapper: buildWrapper(queryClient) })

    // Deliberately the TYPE-level key, never a documentId-scoped one — see the hook's own header:
    // TanStack's default fuzzy matching then also covers the detail/settlement/authority-events keys
    // nested under it, without three separate invalidateQueries calls.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["documents", "invoice"] })
    expect(invalidateSpy).toHaveBeenCalledTimes(1)
  })

  it("invalidates again for a conformity nudge (authority-event), keyed by that event's own type", () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries")
    mockedUseSse.mockReturnValue(sseResult({ documentId: "doc-2", typeId: "quote", kind: "authority-event" }))

    renderHook(() => useDocumentEventsSse(), { wrapper: buildWrapper(queryClient) })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["documents", "quote"] })
  })

  it("invalidates AGAIN for each distinct message a live connection hands it, in order", () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries")
    mockedUseSse.mockReturnValue(sseResult({ documentId: "doc-1", typeId: "invoice", kind: "sending" }))

    const { rerender } = renderHook(() => useDocumentEventsSse(), { wrapper: buildWrapper(queryClient) })
    expect(invalidateSpy).toHaveBeenCalledTimes(1)

    // Simulates the SAME EventSource connection handing the hook a SECOND, later message — exactly
    // what a real "sending" -> "sent" sequence looks like on screen, without a reload in between.
    mockedUseSse.mockReturnValue(sseResult({ documentId: "doc-1", typeId: "invoice", kind: "sent" }))
    rerender()

    expect(invalidateSpy).toHaveBeenCalledTimes(2)
    expect(invalidateSpy).toHaveBeenNthCalledWith(2, { queryKey: ["documents", "invoice"] })
  })
})
