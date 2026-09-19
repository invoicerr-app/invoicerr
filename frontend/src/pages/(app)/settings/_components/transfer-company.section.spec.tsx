import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
import { toast } from "sonner"

import TransferCompanySection from "./transfer-company.section"

/** Same fetch-boundary mocking convention as `danger.settings.spec.tsx` — the hooks under test here
 *  go through the SAME global `fetch`, so intercepting it (rather than the hooks themselves) is what
 *  actually proves the OTP travels in the body and the request shape reaching the backend. */
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
      <TransferCompanySection />
    </QueryClientProvider>,
  )
}

describe("<TransferCompanySection> — no pending transfer", () => {
  it("requests an OTP, opens the dialog, then sends {email, otp} to POST /api/companies/transfer", async () => {
    let otpRequested = false
    let capturedBody: unknown
    installFetchMock({
      "GET /api/companies/transfer": () => ({ body: null }),
      "POST /api/danger/otp": () => {
        otpRequested = true
        return { body: { message: "OTP sent successfully" } }
      },
      "POST /api/companies/transfer": (_url, init) => {
        capturedBody = init?.body ? JSON.parse(init.body as string) : undefined
        return {
          body: { message: "If an account exists for this address, a transfer request has been sent to it." },
        }
      },
    })

    renderSection()

    const emailInput = await screen.findByTestId("transfer-company-email-input")
    fireEvent.change(emailInput, { target: { value: "new-owner@example.com" } })
    fireEvent.click(screen.getByTestId("transfer-company-start-button"))

    await waitFor(() => expect(otpRequested).toBe(true))
    await screen.findByTestId("transfer-company-otp-input")

    fireEvent.change(screen.getByTestId("transfer-company-otp-input"), { target: { value: "12345678" } })
    fireEvent.click(screen.getByTestId("transfer-company-otp-confirm"))

    await waitFor(() => expect(capturedBody).toEqual({ email: "new-owner@example.com", otp: "1234-5678" }))
    // Our own translated, anti-enumeration copy — never the server's raw (always-English) message.
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "If an account exists for this address, a transfer request has been sent to it.",
      ),
    )
  })

  it("disables the confirm button until 8 OTP digits are entered", async () => {
    installFetchMock({
      "GET /api/companies/transfer": () => ({ body: null }),
      "POST /api/danger/otp": () => ({ body: { message: "OTP sent successfully" } }),
    })

    renderSection()
    fireEvent.change(await screen.findByTestId("transfer-company-email-input"), {
      target: { value: "new-owner@example.com" },
    })
    fireEvent.click(screen.getByTestId("transfer-company-start-button"))
    await screen.findByTestId("transfer-company-otp-input")

    expect(screen.getByTestId("transfer-company-otp-confirm")).toBeDisabled()
  })

  it("shows the server's own refusal (e.g. an already-pending conflict) rather than a generic message", async () => {
    installFetchMock({
      "GET /api/companies/transfer": () => ({ body: null }),
      "POST /api/danger/otp": () => ({ body: { message: "OTP sent successfully" } }),
      "POST /api/companies/transfer": () => ({
        status: 409,
        body: { message: "This company already has a pending ownership transfer" },
      }),
    })

    renderSection()
    fireEvent.change(await screen.findByTestId("transfer-company-email-input"), {
      target: { value: "new-owner@example.com" },
    })
    fireEvent.click(screen.getByTestId("transfer-company-start-button"))
    await screen.findByTestId("transfer-company-otp-input")
    fireEvent.change(screen.getByTestId("transfer-company-otp-input"), { target: { value: "12345678" } })
    fireEvent.click(screen.getByTestId("transfer-company-otp-confirm"))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("This company already has a pending ownership transfer"),
    )
  })
})

describe("<TransferCompanySection> — a transfer is already pending", () => {
  const CURRENT = {
    id: "transfer-1",
    companyId: "company-1",
    companyName: "Acme Corp",
    status: "PENDING",
    toEmail: "new-owner@example.com",
    fromUserId: "user-1",
    fromName: "Ada Owner",
    fromEmail: "ada@example.com",
    expiresAt: "2026-09-24T00:00:00.000Z",
    createdAt: "2026-09-17T00:00:00.000Z",
    acceptedAt: null,
    canceledAt: null,
  }

  it("shows the recipient instead of the form, and cancels via DELETE on confirm", async () => {
    let canceled = false
    installFetchMock({
      "GET /api/companies/transfer": () => ({ body: CURRENT }),
      "DELETE /api/companies/transfer/transfer-1": () => {
        canceled = true
        return { body: { success: true } }
      },
    })

    renderSection()

    await screen.findByTestId("transfer-company-pending")
    expect(screen.queryByTestId("transfer-company-email-input")).not.toBeInTheDocument()
    expect(screen.getByTestId("transfer-company-pending")).toHaveTextContent("new-owner@example.com")

    fireEvent.click(screen.getByTestId("transfer-company-cancel-button"))
    fireEvent.click(await screen.findByTestId("transfer-company-cancel-dialog-confirm"))

    await waitFor(() => expect(canceled).toBe(true))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Transfer canceled"))
  })
})
