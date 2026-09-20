import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { toast } from "sonner"

vi.mock("@/lib/auth", () => ({ authClient: { useSession: vi.fn() } }))
import { authClient } from "@/lib/auth"

vi.mock("@/lib/after-company-gone", () => ({ afterCompanyGone: vi.fn() }))
import { afterCompanyGone } from "@/lib/after-company-gone"

import DangerZoneSettings from "@/pages/(app)/settings/_components/danger.settings"

/** Same fetch-boundary mocking convention as `client-upsert.spec.tsx` — the hooks under test here
 *  (`usePost`/`useGet`, `@/hooks/use-fetch`) go through the SAME global `fetch`, so intercepting it
 *  (rather than the hooks themselves) is what actually proves where the OTP travels on the wire and
 *  what the preflight read returns. */
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

// `<DangerZoneSettings>` also mounts `<TransferCompanySection>` (product decision 2026-09-17), which
// fires this GET on every render regardless of what a given test actually exercises — defaulted here,
// once, rather than repeated in every `installFetchMock` call below, none of which cares about
// ownership transfer at all.
const DEFAULT_HANDLERS: Record<string, FetchHandler> = {
  "GET /api/companies/transfer": () => ({ body: null }),
}

function installFetchMock(handlers: Record<string, FetchHandler>) {
  const merged = { ...DEFAULT_HANDLERS, ...handlers }
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input.toString()
    const url = new URL(raw, "http://localhost")
    const method = (init?.method ?? "GET").toUpperCase()
    const key = `${method} ${url.pathname}`
    const handler = merged[key]
    if (!handler) throw new Error(`Unmocked fetch in test: ${key}${url.search}`)
    const { status = 200, body } = handler(url, init)
    return jsonResponse(body, status)
  })
  vi.stubGlobal("fetch", fn)
  return fn
}

const OPEN_PREFLIGHT = {
  blocked: false,
  retainedDocuments: 0,
  retentionUntil: null,
  counts: {
    documents: 3,
    clients: 2,
    articles: 1,
    projects: 0,
    timeEntries: 0,
    bankStatements: 0,
    archives: 0,
  },
}

const BLOCKED_PREFLIGHT = {
  blocked: true,
  retainedDocuments: 2,
  retentionUntil: "2030-01-01T00:00:00.000Z",
  counts: {
    documents: 5,
    clients: 2,
    articles: 1,
    projects: 0,
    timeEntries: 0,
    bankStatements: 0,
    archives: 5,
  },
}

const SESSION = {
  companies: [{ id: "company-1", name: "Acme Corp" }],
  activeCompanyId: "company-1",
  activeRole: "OWNER",
}

function renderScreen() {
  // `<TransferCompanySection>` (mounted inside `<DangerZoneSettings>`) reads through
  // `useApiQuery`/TanStack Query — a fresh, no-retry client per render so a mocked 4xx/5xx in one
  // test can't linger and retry into the next.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DangerZoneSettings />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** `findBy*`'s own default (1000ms) is tight for this specific query, not because anything here
 *  waits on a real timer or an unresolved request — `requestOtp` flips `otpModalOpen` synchronously,
 *  BEFORE the OTP POST even fires (see that handler's own comment in the component), and Radix's
 *  `Presence` mounts the dialog via `useLayoutEffect`, not an animation-frame callback, so there is
 *  no genuine async gate between the click and this input existing. What IS real is the synchronous
 *  render/commit cost of the whole page this dialog lives on (this section plus
 *  `TransferCompanySection` and `InstanceResetSection`, each with their own i18n interpolation and
 *  Tailwind `cn()` merges) — CPU-bound work whose wall-clock cost scales with host contention, not
 *  with anything this test could await instead. Reproduced locally by pinning the test runner to 2
 *  cores and loading them with `yes`: click-to-input-visible grew from ~3ms idle to ~980ms under
 *  contention, i.e. genuinely on the edge of the default budget on a busy shared CI runner. Widening
 *  the wait (never the assertion) is the correct fix for that; `instance-reset.section.spec.tsx`
 *  carries the identical comment for its own sibling case. */
const DIALOG_MOUNT_TIMEOUT_MS = 5000

/** Vitest's own default test budget is 5000 ms too — the same number as the wait above. So a test
 *  that actually spends that wait is killed by the test budget BEFORE its own query can time out,
 *  which made the widened wait inert: both CI failures reported "Test timed out in 5000ms" at the
 *  `it()`, clocked at 5010 ms, never the query's own message. Widening a query wait only does
 *  something when the test budget sits strictly above it. */
vi.setConfig({ testTimeout: DIALOG_MOUNT_TIMEOUT_MS * 3 })

/** Opens the OTP modal for the "reset company data" action and fills both fields the confirm button
 *  requires — the fixed `RESET` keyword ("delete company" instead asks for the company's own name,
 *  unrelated to what this file tests). */
async function openResetModalAndFillForm() {
  fireEvent.click(await screen.findByTestId("danger-reset-company-data-button"))
  await screen.findByTestId("danger-otp-input", {}, { timeout: DIALOG_MOUNT_TIMEOUT_MS })
  fireEvent.change(screen.getByTestId("danger-otp-input"), { target: { value: "12345678" } })
  fireEvent.change(screen.getByTestId("danger-confirm-input"), { target: { value: "RESET" } })
}

describe("<DangerZoneSettings> — company-data reset preflight", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authClient.useSession).mockReturnValue({
      data: SESSION,
      isPending: false,
      refetch: vi.fn().mockResolvedValue(undefined),
    } as never)
  })

  it("enables the reset button and shows the counts once the preflight reports nothing retained", async () => {
    installFetchMock({
      "GET /api/danger/reset/company-data/preflight": () => ({ body: OPEN_PREFLIGHT }),
    })

    renderScreen()

    const button = await screen.findByTestId("danger-reset-company-data-button")
    await waitFor(() => expect(button).not.toBeDisabled())
    expect(await screen.findByTestId("danger-reset-counts")).toHaveTextContent("3")
    expect(screen.queryByTestId("danger-retention-blocked-alert")).not.toBeInTheDocument()
  })

  it("disables the reset button and shows the retention refusal BEFORE any OTP is requested", async () => {
    installFetchMock({
      "GET /api/danger/reset/company-data/preflight": () => ({ body: BLOCKED_PREFLIGHT }),
    })

    renderScreen()

    const button = await screen.findByTestId("danger-reset-company-data-button")
    await waitFor(() => expect(button).toBeDisabled())
    expect(await screen.findByTestId("danger-retention-blocked-alert")).toHaveTextContent("2")
  })
})

describe("<DangerZoneSettings> — reset company data: OTP transport", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authClient.useSession).mockReturnValue({
      data: SESSION,
      isPending: false,
      refetch: vi.fn().mockResolvedValue(undefined),
    } as never)
  })

  it("confirms a reset with the OTP in the request BODY, against the company-data endpoint, never a query string", async () => {
    let capturedUrl: URL | undefined
    let capturedBody: unknown
    installFetchMock({
      "GET /api/danger/reset/company-data/preflight": () => ({ body: OPEN_PREFLIGHT }),
      "POST /api/danger/otp": () => ({ body: { message: "OTP sent successfully" } }),
      "POST /api/danger/reset/company-data": (url, init) => {
        capturedUrl = url
        capturedBody = init?.body ? JSON.parse(init.body as string) : undefined
        return { body: { message: "Company data reset successfully" } }
      },
    })

    renderScreen()
    await openResetModalAndFillForm()
    fireEvent.click(screen.getByTestId("danger-modal-confirm"))

    await waitFor(() => expect(capturedBody).toEqual({ otp: "1234-5678" }))
    // The exact regression this proves: no `?otp=...` (or anything else) in the query string — a
    // confirmation code is a bearer secret for the duration of its own window, and a query string
    // lands in nginx access logs and browser history the same way a password would.
    expect(capturedUrl?.search).toBe("")
  })

  it("shows a translated, distinct message once the backend reports this company permanently locked out", async () => {
    installFetchMock({
      "GET /api/danger/reset/company-data/preflight": () => ({ body: OPEN_PREFLIGHT }),
      "POST /api/danger/otp": () => ({
        status: 400,
        body: {
          statusCode: 400,
          message:
            "Too many failed attempts. This action is locked for this company and can no longer be confirmed by OTP.",
          error: "Bad Request",
        },
      }),
    })

    renderScreen()
    fireEvent.click(await screen.findByTestId("danger-reset-company-data-button"))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Locked out", {
        description:
          "Too many failed attempts. This action is locked for your company and can no longer be confirmed by a one-time code.",
      }),
    )
    // Not the generic fallback path — the raw, untranslated backend string never reaches the toast.
    expect(toast.error).not.toHaveBeenCalledWith("Failed to send verification code", expect.anything())
  })
})

describe("<DangerZoneSettings> — delete company: OTP + company name transport", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authClient.useSession).mockReturnValue({
      data: SESSION,
      isPending: false,
      refetch: vi.fn().mockResolvedValue(undefined),
    } as never)
  })

  it("sends BOTH the OTP and the typed company name in the request body", async () => {
    let capturedBody: unknown
    installFetchMock({
      "GET /api/danger/reset/company-data/preflight": () => ({ body: OPEN_PREFLIGHT }),
      "POST /api/danger/otp": () => ({ body: { message: "OTP sent successfully" } }),
      "POST /api/danger/delete-company": (_url, init) => {
        capturedBody = init?.body ? JSON.parse(init.body as string) : undefined
        return { body: { message: "Company deleted successfully" } }
      },
    })

    renderScreen()
    fireEvent.click(await screen.findByTestId("danger-delete-company-button"))
    await screen.findByTestId("danger-otp-input", {}, { timeout: DIALOG_MOUNT_TIMEOUT_MS })
    fireEvent.change(screen.getByTestId("danger-otp-input"), { target: { value: "87654321" } })
    // The company's own name (from the session, "Acme Corp") is the confirmation keyword here —
    // see `confirmKeyword`'s own comment in the component for why it differs from the fixed "RESET"
    // keyword the lesser "reset company data" action uses.
    fireEvent.change(screen.getByTestId("danger-confirm-input"), { target: { value: "Acme Corp" } })
    fireEvent.click(screen.getByTestId("danger-modal-confirm"))

    await waitFor(() => expect(capturedBody).toEqual({ otp: "8765-4321", companyName: "Acme Corp" }))
  })

  it("keeps the confirm button disabled until the typed text matches the company's own name exactly", async () => {
    installFetchMock({
      "GET /api/danger/reset/company-data/preflight": () => ({ body: OPEN_PREFLIGHT }),
      "POST /api/danger/otp": () => ({ body: { message: "OTP sent successfully" } }),
    })

    renderScreen()
    fireEvent.click(await screen.findByTestId("danger-delete-company-button"))
    await screen.findByTestId("danger-otp-input", {}, { timeout: DIALOG_MOUNT_TIMEOUT_MS })
    fireEvent.change(screen.getByTestId("danger-otp-input"), { target: { value: "87654321" } })
    fireEvent.change(screen.getByTestId("danger-confirm-input"), { target: { value: "not the name" } })

    expect(screen.getByTestId("danger-modal-confirm")).toBeDisabled()
  })

  it("re-fetches the session after a successful deletion, so a stale activeCompanyId never lingers", async () => {
    const refetch = vi.fn().mockResolvedValue(undefined)
    vi.mocked(authClient.useSession).mockReturnValue({ data: SESSION, isPending: false, refetch } as never)
    installFetchMock({
      "GET /api/danger/reset/company-data/preflight": () => ({ body: OPEN_PREFLIGHT }),
      "POST /api/danger/otp": () => ({ body: { message: "OTP sent successfully" } }),
      "POST /api/danger/delete-company": () => ({ body: { message: "Company deleted successfully" } }),
    })

    renderScreen()
    fireEvent.click(await screen.findByTestId("danger-delete-company-button"))
    await screen.findByTestId("danger-otp-input", {}, { timeout: DIALOG_MOUNT_TIMEOUT_MS })
    fireEvent.change(screen.getByTestId("danger-otp-input"), { target: { value: "87654321" } })
    fireEvent.change(screen.getByTestId("danger-confirm-input"), { target: { value: "Acme Corp" } })
    fireEvent.click(screen.getByTestId("danger-modal-confirm"))

    await waitFor(() => expect(refetch).toHaveBeenCalled())
  })

  it("hands off to afterCompanyGone (a hard reload) once the session refetch settles, never a plain SPA navigate", async () => {
    const refetch = vi.fn().mockResolvedValue(undefined)
    vi.mocked(authClient.useSession).mockReturnValue({ data: SESSION, isPending: false, refetch } as never)
    installFetchMock({
      "GET /api/danger/reset/company-data/preflight": () => ({ body: OPEN_PREFLIGHT }),
      "POST /api/danger/otp": () => ({ body: { message: "OTP sent successfully" } }),
      "POST /api/danger/delete-company": () => ({ body: { message: "Company deleted successfully" } }),
    })

    renderScreen()
    fireEvent.click(await screen.findByTestId("danger-delete-company-button"))
    await screen.findByTestId("danger-otp-input", {}, { timeout: DIALOG_MOUNT_TIMEOUT_MS })
    fireEvent.change(screen.getByTestId("danger-otp-input"), { target: { value: "87654321" } })
    fireEvent.change(screen.getByTestId("danger-confirm-input"), { target: { value: "Acme Corp" } })
    fireEvent.click(screen.getByTestId("danger-modal-confirm"))

    // The exact regression this proves: the screen no longer merely calls the SPA router's
    // `navigate("/dashboard")` (which would leave every other company-scoped query cached under
    // the just-deleted company) — it hands off to the shared hard-reload helper instead.
    await waitFor(() => expect(afterCompanyGone).toHaveBeenCalled())
  })
})
