import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { toast } from "sonner"

import { PaymentMethodCard } from "@/pages/(app)/payment-methods/_components/payment-method-card"
import type { PaymentMethodConfig } from "@/types/payment-method"

/** Same fetch-boundary mocking convention as `article-upsert.spec.tsx` / `payments.settings.spec.tsx`. */
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

const PAYPAL_UNCONFIGURED: PaymentMethodConfig = {
  id: "paypal",
  label: "PayPal",
  fields: [{ key: "email", kind: "text", label: "PayPal e-mail", required: true }],
  enabled: false,
  config: {},
  configured: false,
}

const PAYPAL_CONFIGURED: PaymentMethodConfig = {
  ...PAYPAL_UNCONFIGURED,
  config: { email: "billing@acme.test" },
  configured: true,
}

const CASH: PaymentMethodConfig = {
  id: "cash",
  label: "Cash",
  fields: [],
  enabled: false,
  config: {},
  configured: true,
}

function renderCard(method: PaymentMethodConfig) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <PaymentMethodCard method={method} />
    </QueryClientProvider>,
  )
}

describe("<PaymentMethodCard> — activating an unconfigured method never round-trips into a raw error", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("flipping the switch on an UNCONFIGURED method opens the config dialog, and sends no PATCH at all", async () => {
    const fetchMock = installFetchMock({})
    renderCard(PAYPAL_UNCONFIGURED)

    fireEvent.click(screen.getByTestId("payment-method-toggle-paypal"))

    expect(await screen.findByTestId("payment-method-config-dialog")).toBeVisible()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("saving that dialog both fills in the field and activates the method — one PATCH, `enabled: true`", async () => {
    const fetchMock = installFetchMock({
      "PATCH /api/payment-methods/paypal": (_url, init) => {
        const body = JSON.parse(String(init?.body))
        expect(body).toEqual({ methodId: "paypal", config: { email: "billing@acme.test" }, enabled: true })
        return { body: { ...PAYPAL_CONFIGURED, enabled: true } }
      },
    })
    renderCard(PAYPAL_UNCONFIGURED)

    fireEvent.click(screen.getByTestId("payment-method-toggle-paypal"))
    const dialog = await screen.findByTestId("payment-method-config-dialog")
    fireEvent.change(screen.getByTestId("document-field-email-input"), {
      target: { value: "billing@acme.test" },
    })
    fireEvent.click(screen.getByTestId("payment-method-config-save"))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(toast.success).toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('the plain "Configure" button never activates the method — config only, `enabled` untouched', async () => {
    const fetchMock = installFetchMock({
      "PATCH /api/payment-methods/paypal": (_url, init) => {
        const body = JSON.parse(String(init?.body))
        expect(body).toEqual({ methodId: "paypal", config: { email: "billing@acme.test" } })
        return { body: PAYPAL_CONFIGURED }
      },
    })
    renderCard(PAYPAL_UNCONFIGURED)

    fireEvent.click(screen.getByTestId("payment-method-configure-paypal"))
    await screen.findByTestId("payment-method-config-dialog")
    fireEvent.change(screen.getByTestId("document-field-email-input"), {
      target: { value: "billing@acme.test" },
    })
    fireEvent.click(screen.getByTestId("payment-method-config-save"))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  })

  it("a method already configured toggles straight through the switch — no dialog", async () => {
    const fetchMock = installFetchMock({
      "PATCH /api/payment-methods/paypal": (_url, init) => {
        const body = JSON.parse(String(init?.body))
        expect(body).toEqual({ methodId: "paypal", enabled: true })
        return { body: { ...PAYPAL_CONFIGURED, enabled: true } }
      },
    })
    renderCard(PAYPAL_CONFIGURED)

    fireEvent.click(screen.getByTestId("payment-method-toggle-paypal"))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId("payment-method-config-dialog")).not.toBeInTheDocument()
  })

  it("disabling an enabled method always goes straight through, regardless of `configured`", async () => {
    const fetchMock = installFetchMock({
      "PATCH /api/payment-methods/paypal": (_url, init) => {
        const body = JSON.parse(String(init?.body))
        expect(body).toEqual({ methodId: "paypal", enabled: false })
        return { body: { ...PAYPAL_CONFIGURED, enabled: false } }
      },
    })
    renderCard({ ...PAYPAL_CONFIGURED, enabled: true })

    fireEvent.click(screen.getByTestId("payment-method-toggle-paypal"))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId("payment-method-config-dialog")).not.toBeInTheDocument()
  })

  it("a method with zero fields (Cash) is always `configured` — the switch never opens a dialog for it", async () => {
    const fetchMock = installFetchMock({
      "PATCH /api/payment-methods/cash": () => ({ body: { ...CASH, enabled: true } }),
    })
    renderCard(CASH)

    fireEvent.click(screen.getByTestId("payment-method-toggle-cash"))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId("payment-method-config-dialog")).not.toBeInTheDocument()
  })
})
