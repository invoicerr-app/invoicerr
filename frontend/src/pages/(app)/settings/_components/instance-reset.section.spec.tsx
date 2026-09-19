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

async function openModalAndFillForm() {
  fireEvent.click(await screen.findByTestId("instance-reset-button"))
  await screen.findByTestId("instance-reset-otp-input")
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
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/auth/log-out"))
  })

  it("keeps the confirm button disabled until the confirmation word matches EXACTLY", async () => {
    installFetchMock({
      "GET /api/instance/danger/preflight": () => ({ body: { companies: 1, users: 1, documents: 0 } }),
      "POST /api/instance/danger/otp": () => ({ body: { message: "OTP sent successfully" } }),
    })

    renderSection()
    fireEvent.click(await screen.findByTestId("instance-reset-button"))
    await screen.findByTestId("instance-reset-otp-input")
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

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Locked out",
        expect.objectContaining({
          description: expect.stringContaining("locked for your account"),
        }),
      ),
    )
  })
})
