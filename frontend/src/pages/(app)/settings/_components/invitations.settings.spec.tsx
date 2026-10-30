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

/** What the list route returns now: an eight-character preview, no plaintext code. */
const INVITATION = {
  id: "invite-1",
  code: "ABCD1234",
  role: "MEMBER",
  createdAt: "2026-09-01T00:00:00.000Z",
  expiresAt: null,
  usedAt: null,
  usedBy: null,
}

const CREATED_CODE = "ABCD1234EFGH5678IJKL9012MNOP3456"

function renderScreen() {
  return render(
    <MemoryRouter>
      <InvitationsSettings />
    </MemoryRouter>,
  )
}

async function createInvitation() {
  fireEvent.click(await screen.findByTestId("invitations-create-button"))
  return screen.findByTestId("invitation-created-code")
}

describe("<InvitationsSettings> — the code is shown once", () => {
  const originalClipboard = navigator.clipboard
  const originalExecCommand = document.execCommand

  beforeEach(() => {
    vi.clearAllMocks()
    installFetchMock({
      "GET /api/invitations": () => ({ body: [INVITATION] }),
      "POST /api/invitations": () => ({ status: 201, body: { ...INVITATION, code: CREATED_CODE } }),
    })
  })

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: originalClipboard, configurable: true })
    document.execCommand = originalExecCommand
  })

  it("shows the full code right after creation, since the list only ever returns a preview", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })

    renderScreen()
    const code = await createInvitation()

    // The code lives in its own read-only panel now (a `code` element, not a form field): there is
    // nothing to type into and nothing to copy out of an input, only the text plus its copy button.
    expect(code).toHaveTextContent(CREATED_CODE)
  })

  it("has no per-row copy button any more: copying a stored preview would hand out a dead code", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })

    renderScreen()
    await screen.findByTestId(`invitation-row-${INVITATION.id}`)

    expect(screen.queryByTestId(`invitation-copy-${INVITATION.id}`)).toBeNull()
  })

  // The regression this guards: `navigator.clipboard`'s `writeText` rejecting (no permission, no focus,
  // no secure context) must resolve to a known outcome, never throw out of the handler.
  it("shows an error toast, never the success one, when copying the new code fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    })
    document.execCommand = vi.fn().mockReturnValue(false)

    renderScreen()
    await createInvitation()
    vi.clearAllMocks()
    fireEvent.click(screen.getByTestId("invitation-created-code-copy"))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Couldn't copy the code — copy it manually instead."),
    )
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("shows the success toast when copying the new code lands", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })

    renderScreen()
    await createInvitation()
    vi.clearAllMocks()
    fireEvent.click(screen.getByTestId("invitation-created-code-copy"))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Code copied to clipboard"))
    expect(toast.error).not.toHaveBeenCalled()
  })
})
