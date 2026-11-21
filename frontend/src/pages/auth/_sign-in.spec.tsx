import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { authClient } from "@/lib/auth"
import { signOut } from "@/lib/sign-out"
import LoginPage from "./sign-in"
import LogoutPage from "./sign-out"

vi.mock("@/lib/auth", () => ({
  authClient: {
    signIn: { email: vi.fn(), social: vi.fn() },
    signOut: vi.fn(async () => ({ data: null })),
    getSession: vi.fn(),
  },
}))

// Leading underscore keeps generouted from registering this file as a route.
function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
    clone() {
      return this as Response
    },
  } as Response
}

type CanRegister = { allowed: boolean; requiresCode: boolean } | "pending" | "error"
type DemoInstance = { email: string; password: string; resetIntervalHours: number }

function installFetchMock(canRegister: CanRegister, demo: DemoInstance | null = null) {
  const handlers: Record<string, unknown> = {
    "/api/health": { status: "ok" },
    "/api/legal/documents": { saasMode: false, demoMode: demo !== null, demo, documents: [] },
    "/api/invitations/can-register": canRegister,
  }
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost")
    if (url.pathname === "/api/invitations/can-register" && canRegister === "pending") {
      return new Promise<Response>(() => {})
    }
    if (url.pathname === "/api/invitations/can-register" && canRegister === "error") {
      throw new Error("network down")
    }
    if (!(url.pathname in handlers)) throw new Error(`Unmocked fetch in test: ${url.pathname}`)
    return jsonResponse(handlers[url.pathname])
  })
  vi.stubGlobal("fetch", fn)
  return fn
}

function renderSignIn() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return client
}

const registrationSettled = (client: QueryClient) =>
  waitFor(() => expect(client.getQueryState(["registration", "status"])?.status).not.toBe("pending"))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  sessionStorage.clear()
})

describe("<LoginPage> sign-up link", () => {
  it("is offered while the server accepts new accounts", async () => {
    installFetchMock({ allowed: true, requiresCode: false })
    renderSignIn()

    expect(await screen.findByTestId("auth-signup-link")).toBeInTheDocument()
  })

  it("stays offered on an invitation-only instance, where a code still opens sign-up", async () => {
    installFetchMock({ allowed: false, requiresCode: true })
    renderSignIn()

    expect(await screen.findByTestId("auth-signup-link")).toBeInTheDocument()
  })

  it("is hidden once the server says sign-up is closed", async () => {
    installFetchMock({ allowed: false, requiresCode: false })
    const client = renderSignIn()

    await registrationSettled(client)
    expect(screen.queryByTestId("auth-signup-link")).not.toBeInTheDocument()
  })

  it("is not shown before the server has answered, so a closed instance never flashes it", async () => {
    installFetchMock("pending")
    renderSignIn()

    await screen.findByTestId("auth-card")
    expect(screen.queryByTestId("auth-signup-link")).not.toBeInTheDocument()
  })

  it("stays offered when the check fails: the server still refuses a closed sign-up itself", async () => {
    installFetchMock("error")
    const client = renderSignIn()

    await registrationSettled(client)
    expect(screen.getByTestId("auth-signup-link")).toBeInTheDocument()
  })
})

describe("<LoginPage> on a demo instance", () => {
  const signInEmail = vi.mocked(authClient.signIn.email)
  const demo = { email: "visitor@demo.test", password: "open-sesame", resetIntervalHours: 6 }
  const closed = { allowed: false, requiresCode: false }
  const servedAccount = { email: "visitor@demo.test", password: "open-sesame", rememberMe: true }

  it("signs the visitor in with the served demo account, with no click and no button", async () => {
    installFetchMock(closed, demo)
    signInEmail.mockReturnValue(new Promise(() => {}))
    renderSignIn()

    await waitFor(() => expect(signInEmail).toHaveBeenCalledWith(servedAccount))
    expect(screen.queryByTestId("demo-signin-btn")).not.toBeInTheDocument()
  })

  it("tries once, then shows the failure the way the form does and leaves the form usable", async () => {
    installFetchMock(closed, demo)
    signInEmail.mockResolvedValue({
      data: null,
      error: {
        status: 401,
        statusText: "Unauthorized",
        code: "INVALID_EMAIL_OR_PASSWORD",
        message: "Invalid email or password",
      },
    } as never)
    renderSignIn()

    expect(await screen.findByTestId("auth-signin-error")).toHaveTextContent("Invalid email or password")
    expect(screen.getByTestId("auth-submit-btn")).not.toBeDisabled()
    expect(screen.getByTestId("demo-credentials-notice")).toBeInTheDocument()
    expect(signInEmail).toHaveBeenCalledTimes(1)
  })

  it("does not sign straight back in after an explicit sign-out, and shows the credentials instead", async () => {
    await signOut()
    installFetchMock(closed, demo)
    renderSignIn()

    await screen.findByTestId("demo-credentials-notice")
    expect(screen.getByTestId("demo-credentials-email")).toHaveTextContent(/^visitor@demo\.test$/)
    expect(screen.getByTestId("demo-credentials-password")).toHaveTextContent(/^open-sesame$/)
    expect(screen.getByTestId("demo-credentials-notice")).toHaveTextContent("Data resets every 6 hours.")
    expect(signInEmail).not.toHaveBeenCalled()
  })

  it("treats the sign-out page as an explicit sign-out", async () => {
    installFetchMock(closed, demo)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/auth/sign-out"]}>
          <Routes>
            <Route path="/auth/sign-out" element={<LogoutPage />} />
            <Route path="/auth/sign-in" element={<LoginPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await screen.findByTestId("demo-credentials-notice")
    expect(authClient.signOut).toHaveBeenCalled()
    expect(signInEmail).not.toHaveBeenCalled()
  })

  it("says every hour, not every 1 hours", async () => {
    await signOut()
    installFetchMock(closed, { ...demo, resetIntervalHours: 1 })
    renderSignIn()

    expect(await screen.findByTestId("demo-credentials-notice")).toHaveTextContent("Data resets every hour.")
  })

  it("neither signs in nor renders the box outside demo mode", async () => {
    const fetchMock = installFetchMock(closed, null)
    renderSignIn()

    await screen.findByTestId("auth-card")
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/legal/documents"))).toBe(true),
    )
    await waitFor(() => expect(screen.queryByTestId("auth-signup-link")).not.toBeInTheDocument())
    expect(screen.queryByTestId("demo-credentials-notice")).not.toBeInTheDocument()
    expect(signInEmail).not.toHaveBeenCalled()
  })
})

describe("<LoginPage> failed sign-in", () => {
  const signInEmail = vi.mocked(authClient.signIn.email)
  const getSession = vi.mocked(authClient.getSession)

  function submit(email = "owner@example.test", password = "Password-1!") {
    fireEvent.change(screen.getByTestId("auth-email-input"), { target: { value: email } })
    fireEvent.change(screen.getByTestId("auth-password-input"), { target: { value: password } })
    fireEvent.click(screen.getByTestId("auth-submit-btn"))
  }

  afterEach(() => {
    signInEmail.mockReset()
    getSession.mockReset()
  })

  it("explains an address the server does not accept, naming the address used", async () => {
    installFetchMock({ allowed: true, requiresCode: false })
    signInEmail.mockResolvedValue({
      data: null,
      error: { status: 403, statusText: "Forbidden", code: "INVALID_ORIGIN", message: "Invalid origin" },
    } as never)
    renderSignIn()

    submit()

    const error = await screen.findByTestId("auth-signin-error")
    expect(error).toHaveTextContent(/not the address this instance is configured for/i)
    expect(error).toHaveTextContent(window.location.origin)
  })

  it("says so when the server signed in but the browser kept no session", async () => {
    installFetchMock({ allowed: true, requiresCode: false })
    signInEmail.mockResolvedValue({
      data: { user: { id: "u1", createdAt: new Date() } },
      error: null,
    } as never)
    getSession.mockResolvedValue({ data: null, error: null } as never)
    renderSignIn()

    submit()

    const error = await screen.findByTestId("auth-signin-error")
    expect(error).toHaveTextContent(/browser did not keep the session/i)
    expect(screen.getByTestId("auth-submit-btn")).not.toBeDisabled()
  })

  it("shows the server's reason for wrong credentials", async () => {
    installFetchMock({ allowed: true, requiresCode: false })
    signInEmail.mockResolvedValue({
      data: null,
      error: {
        status: 401,
        statusText: "Unauthorized",
        code: "INVALID_EMAIL_OR_PASSWORD",
        message: "Invalid email or password",
      },
    } as never)
    renderSignIn()

    submit()

    expect(await screen.findByTestId("auth-signin-error")).toHaveTextContent("Invalid email or password")
  })
})
