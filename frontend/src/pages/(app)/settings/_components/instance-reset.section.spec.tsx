import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { toast } from "sonner"

const mockNavigate = vi.fn()
vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router")
  return { ...actual, useNavigate: () => mockNavigate }
})

import InstanceResetSection from "@/pages/(app)/settings/_components/instance-reset.section"

/** Same fetch-boundary mocking convention as `client-upsert.spec.tsx`/`danger.settings.spec.tsx` — the
 *  hooks under test (`useApiQuery`/`useApiMutation`, `@/hooks/use-api-query`) go through the SAME
 *  global `fetch`, so intercepting it is what actually proves the request shape on the wire. */
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

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <InstanceResetSection />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Same render-cost reasoning as `danger.settings.spec.tsx`'s own comment on this constant: `openModal`
 *  flips `otpModalOpen` synchronously, before the OTP POST even fires, and Radix mounts the dialog via
 *  `useLayoutEffect` — nothing here waits on a timer or an unresolved request. The default
 *  `findBy*`/`waitFor` budget (1000ms) is just tight for the synchronous render/commit cost of this
 *  page under CPU contention (a loaded shared CI runner), reproduced locally the same way. Applied to
 *  every wait downstream of a click here, not only the modal-mount one — see
 *  `.github/workflows/cypress.yml`'s own `--maxWorkers` comment for the actual contention fix; this
 *  constant only keeps the test from losing the race against it.
 *
 *  UNLIKE the sibling file, this one does NOT also need a "wait for the button to be enabled before
 *  clicking" guard: `instance-reset-button` has no `disabled` prop of its own (see the component —
 *  only `loading={requestOtp.isPending}`, false until a request actually starts), so it is never
 *  gated behind a pending preflight fetch the way `danger-reset-company-data-button` is. That gating
 *  is what made a click there a silent no-op under contention (see the sibling file's own comment on
 *  its `DIALOG_MOUNT_TIMEOUT_MS` for the actual repro) — a mechanism this file's button cannot hit. */
const DIALOG_MOUNT_TIMEOUT_MS = 5000

/** Vitest's own default test budget is 5000 ms too — the same number as the wait above. So a test
 *  that actually spends that wait is killed by the test budget BEFORE its own query can time out,
 *  which made the widened wait inert: both CI failures reported "Test timed out in 5000ms" at the
 *  `it()`, clocked at 5010 ms, never the query's own message. Widening a query wait only does
 *  something when the test budget sits strictly above it. */
vi.setConfig({ testTimeout: DIALOG_MOUNT_TIMEOUT_MS * 3 })

async function openModalAndFillForm() {
  fireEvent.click(await screen.findByTestId("instance-reset-button"))
  await screen.findByTestId("instance-reset-otp-input", {}, { timeout: DIALOG_MOUNT_TIMEOUT_MS })
  fireEvent.change(screen.getByTestId("instance-reset-otp-input"), { target: { value: "12345678" } })
  fireEvent.change(screen.getByTestId("instance-reset-confirm-input"), {
    target: { value: "RESET INSTANCE" },
  })
}

describe("<InstanceResetSection>", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders nothing when the preflight route is not 200 — no operator, or SaaS", async () => {
    installFetchMock({
      "GET /api/instance/danger/preflight": () => ({
        status: 403,
        body: { statusCode: 403, message: "This account is not an instance operator" },
      }),
    })

    const { container } = renderSection()
    await waitFor(() => expect(container).not.toHaveTextContent("Loading"))
    expect(container.querySelector('[data-cy="instance-reset-card"]')).toBeNull()
  })

  it("shows the counts from the preflight route once it resolves 200", async () => {
    installFetchMock({
      "GET /api/instance/danger/preflight": () => ({ body: { companies: 3, users: 7, documents: 120 } }),
    })

    renderSection()

    await waitFor(() =>
      expect(screen.getByTestId("instance-reset-counts")).toHaveTextContent(
        "3 companies, 7 users, 120 documents",
      ),
    )
  })

  it("confirms a reset with the OTP AND the exact confirmation word in the request BODY", async () => {
    let capturedUrl: URL | undefined
    let capturedBody: unknown
    installFetchMock({
      "GET /api/instance/danger/preflight": () => ({ body: { companies: 1, users: 1, documents: 0 } }),
      "POST /api/instance/danger/otp": () => ({ body: { message: "OTP sent successfully" } }),
      "POST /api/instance/danger/reset": (url, init) => {
        capturedUrl = url
        capturedBody = init?.body ? JSON.parse(init.body as string) : undefined
        return { body: { message: "Instance reset successfully" } }
      },
    })

    renderSection()
    await openModalAndFillForm()
    fireEvent.click(screen.getByTestId("instance-reset-modal-confirm"))

    await waitFor(() =>
      expect(capturedBody).toEqual({ otp: "1234-5678", confirmationWord: "RESET INSTANCE" }),
    )
    // Same discipline `danger.settings.spec.tsx` proves for the company-scoped screen: never a query
    // string for the OTP (or here, the confirmation word either).
    expect(capturedUrl?.search).toBe("")
    // Same `DIALOG_MOUNT_TIMEOUT_MS` budget — gated behind `confirmReset`'s own success chain, the
    // same render/commit cost as every other wait on this page.
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/auth/log-out"), {
      timeout: DIALOG_MOUNT_TIMEOUT_MS,
    })
  })

  it("keeps the confirm button disabled until the confirmation word matches EXACTLY", async () => {
    installFetchMock({
      "GET /api/instance/danger/preflight": () => ({ body: { companies: 1, users: 1, documents: 0 } }),
      "POST /api/instance/danger/otp": () => ({ body: { message: "OTP sent successfully" } }),
    })

    renderSection()
    fireEvent.click(await screen.findByTestId("instance-reset-button"))
    await screen.findByTestId("instance-reset-otp-input", {}, { timeout: DIALOG_MOUNT_TIMEOUT_MS })
    fireEvent.change(screen.getByTestId("instance-reset-otp-input"), { target: { value: "12345678" } })
    fireEvent.change(screen.getByTestId("instance-reset-confirm-input"), { target: { value: "RESET" } })

    expect(screen.getByTestId("instance-reset-modal-confirm")).toBeDisabled()
  })

  it("shows a distinct message once the backend reports this operator permanently locked out", async () => {
    installFetchMock({
      "GET /api/instance/danger/preflight": () => ({ body: { companies: 1, users: 1, documents: 0 } }),
      "POST /api/instance/danger/otp": () => ({
        status: 400,
        body: {
          statusCode: 400,
          message:
            "Too many failed attempts. This action is locked for this account and can no longer be confirmed by OTP.",
        },
      }),
    })

    renderSection()
    fireEvent.click(await screen.findByTestId("instance-reset-button"))

    // Same `DIALOG_MOUNT_TIMEOUT_MS` budget as `openModalAndFillForm`'s own wait — see that
    // constant's comment; `danger.settings.spec.tsx`'s identical "locked out" test is the one that
    // actually failed in CI on the unwidened default this used to have too.
    await waitFor(
      () =>
        expect(toast.error).toHaveBeenCalledWith(
          "Locked out",
          expect.objectContaining({
            description: expect.stringContaining("locked for your account"),
          }),
        ),
      { timeout: DIALOG_MOUNT_TIMEOUT_MS },
    )
  })
})
