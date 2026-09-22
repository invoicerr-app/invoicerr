import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
import { toast } from "sonner"

// This screen's `<NoFreeSeatNotice>` pulls in `@/hooks/queries` several levels down — mocked here so
// it takes its `billingAvailable === false` early return and this suite never needs a QueryClient.
vi.mock("@/hooks/queries", () => ({
  useCompanies: () => ({ activeRole: "OWNER" }),
  useBillingStatus: () => ({ isSuccess: false }),
  useSeats: () => ({ data: undefined }),
}))

import InvitationsSettings from "@/pages/(app)/settings/_components/invitations.settings"

/** Same fetch-boundary mocking convention as `danger.settings.spec.tsx` — `useGet`/`usePost`
 *  (`@/hooks/use-fetch`) go through the same global `fetch`. */
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

const INVITATION = {
  id: "invite-1",
  code: "ABCD1234EFGH5678",
  role: "MEMBER",
  createdAt: "2026-09-01T00:00:00.000Z",
  expiresAt: null,
  usedAt: null,
  usedBy: null,
}

function renderScreen() {
  return render(
    <MemoryRouter>
      <InvitationsSettings />
    </MemoryRouter>,
  )
}

describe("<InvitationsSettings> — copy outcome", () => {
  const originalClipboard = navigator.clipboard
  const originalExecCommand = document.execCommand

  beforeEach(() => {
    vi.clearAllMocks()
    installFetchMock({
      "GET /api/invitations": () => ({ body: [INVITATION] }),
    })
  })

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: originalClipboard, configurable: true })
    document.execCommand = originalExecCommand
  })

  // The regression this guards: `navigator.clipboard`'s `writeText` rejecting (no permission, no focus,
  // no secure context) used to throw straight out of the row's copy handler instead of resolving to
  // a known outcome — the row button below is `copyCode`, independent from the create-then-copy path.
  it("shows an error toast, never the success one, when copying an existing code fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    })
    document.execCommand = vi.fn().mockReturnValue(false)

    renderScreen()
    fireEvent.click(await screen.findByTestId(`invitation-copy-${INVITATION.id}`))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Couldn't copy the code — copy it manually instead."),
    )
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("shows the success toast when copying an existing code actually lands", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })

    renderScreen()
    fireEvent.click(await screen.findByTestId(`invitation-copy-${INVITATION.id}`))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Code copied to clipboard"))
    expect(toast.error).not.toHaveBeenCalled()
  })
})
