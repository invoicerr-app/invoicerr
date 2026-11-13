import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { toast } from "sonner"

import ApiKeysSettings from "@/pages/(app)/settings/_components/api-keys.settings"

/** Same fetch-boundary mocking convention as `danger.settings.spec.tsx`. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    clone() {
      return this as Response
    },
  } as Response
}

type FetchHandler = (url: URL, init?: RequestInit) => { status?: number; body: unknown }

function installFetchMock(handlers: Record<string, FetchHandler>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input.toString()
    const url = new URL(raw, "http://localhost")
    const method = (init?.method ?? "GET").toUpperCase()
    const key = `${method} ${url.pathname}`
    const handler = handlers[key]
    if (!handler) throw new Error(`Unmocked fetch in test: ${key}${url.search}`)
    const { status = 200, body } = handler(url, init)
    return jsonResponse(body, status)
  })
  vi.stubGlobal("fetch", fn)
  return fn
}

/** Renders the screen with a chosen outcome for the create call; every other endpoint is fixed. */
function renderSettings(createHandler: FetchHandler) {
  installFetchMock({
    "GET /api/api-keys": () => ({ body: [] }),
    "GET /api/api-keys/options": () => ({ body: { scopes: [] } }),
    "POST /api/api-keys": createHandler,
    // `useDemoMode` (issue #533) goes through `useLegalDocuments`, which needs a QueryClientProvider
    // ancestor (below) plus this endpoint mocked, same as every other fetch this component makes.
    "GET /api/legal/documents": () => ({ body: { saasMode: false, demoMode: false, documents: [] } }),
  })

  // A fresh, no-retry client per render: `useDemoMode`'s own `useQuery` call needs a
  // `QueryClientProvider` ancestor now that this component reads it (issue #533).
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiKeysSettings />
    </QueryClientProvider>,
  )
}

async function submitCreate(name: string) {
  fireEvent.change(await screen.findByLabelText("Name"), { target: { value: name } })
  fireEvent.click(screen.getByRole("button", { name: "Create API Key" }))
}

async function renderWithCreatedKey() {
  renderSettings(() => ({ body: { key: "ivr_live_abcdef123456" } }))
  await submitCreate("CLI on my laptop")

  // The created-key panel only exists once the create call resolves — its own Copy button is the
  // one and only "Copy" control on screen at that point.
  return screen.findByLabelText("Copy")
}

describe("<ApiKeysSettings> — create and copy outcomes", () => {
  const originalClipboard = navigator.clipboard
  const originalExecCommand = document.execCommand

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: originalClipboard, configurable: true })
    document.execCommand = originalExecCommand
  })

  // The regression this guards: `handleCopy` used to fire-and-forget `navigator.clipboard`'s `writeText`
  // with no toast at all — a rejection here was a silent no-op, indistinguishable from a real copy.
  // The key is shown only once (`createdKeyNotice`), so a silent failure meant it was gone for good.
  it("shows an error toast, never the success one, when the copy fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    })
    document.execCommand = vi.fn().mockReturnValue(false)

    const copyButton = await renderWithCreatedKey()
    fireEvent.click(copyButton)

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Couldn't copy — select the key above and copy it manually."),
    )
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("shows the success toast when the copy actually lands", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })

    const copyButton = await renderWithCreatedKey()
    fireEvent.click(copyButton)

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Copied to clipboard"))
    expect(toast.error).not.toHaveBeenCalled()
  })

  // Issue #708: creation used to fail into `console.error` only, with no visible feedback.
  it("shows an error toast when creating a key fails", async () => {
    renderSettings(() => ({ status: 500, body: { message: "Internal server error" } }))
    await submitCreate("CLI on my laptop")

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to create API key"))
    expect(screen.queryByLabelText("Copy")).not.toBeInTheDocument()
  })
})

describe("<ApiKeysSettings>: list load failure", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Before: a failed read left the list on its skeleton forever, with no way to tell it apart from a
  // slow one and nothing to click.
  it("shows a load error with a retry that reloads the list", async () => {
    let listCalls = 0
    installFetchMock({
      "GET /api/api-keys": () => {
        listCalls++
        return listCalls === 1
          ? { status: 500, body: { message: "boom" } }
          : {
              body: [
                {
                  id: "k1",
                  name: "CI key",
                  keyPrefix: "ivr_ab",
                  scopes: [],
                  lastUsedAt: null,
                  createdAt: "2026-11-01T00:00:00.000Z",
                },
              ],
            }
      },
      "GET /api/api-keys/options": () => ({ body: { scopes: [] } }),
      "GET /api/legal/documents": () => ({ body: { saasMode: false, demoMode: false, documents: [] } }),
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <ApiKeysSettings />
      </QueryClientProvider>,
    )

    const title = await screen.findByText("This list could not be loaded.")
    expect(title.closest('[role="alert"]')).not.toBeNull()
    expect(screen.queryByText("No API key created yet.")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Retry" }))

    expect(await screen.findByText("CI key")).toBeInTheDocument()
    expect(screen.queryByText("This list could not be loaded.")).toBeNull()
    expect(listCalls).toBe(2)
  })
})
