import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/hooks/use-api-query"
import * as queriesModule from "@/hooks/queries"
import { authClient } from "@/lib/auth"

import Layout from "./_layout"

/**
 * `(app)/_layout.tsx`'s own "no free seat" gate in isolation — every heavy child of
 * `AuthenticatedLayout` (sidebar, billing banner, PWA prompt, onboarding host, the real SSE
 * connection) is mocked away here: none of them is what this file's own gating logic is about, and
 * mounting them for real would mean chasing down every fetch a full app shell makes. `useSeats`
 * itself (`@/hooks/queries`) is mocked directly rather than through `fetch`, for the same reason
 * `use-document-events-sse.spec.tsx` mocks `useSse` rather than a real `EventSource`.
 */
vi.mock("@/lib/auth", () => ({ authClient: { useSession: vi.fn() } }))
vi.mock("@/hooks/use-document-events-sse", () => ({ useDocumentEventsSse: vi.fn() }))
vi.mock("@/components/sidebar", () => ({ Sidebar: () => null }))
vi.mock("@/components/billing-banner", () => ({ BillingBanner: () => null }))
vi.mock("@/components/pwa-install-prompt", () => ({ PwaInstallPrompt: () => null }))
vi.mock("@/components/onboarding", () => ({
  OnboardingDialogProvider: ({ children }: { children: React.ReactNode }) => children,
  OnboardingDialogHost: () => null,
}))
vi.mock("@/hooks/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/queries")>()
  return { ...actual, useLegalStatus: vi.fn(), useSeats: vi.fn() }
})

const mockedUseSession = vi.mocked(authClient.useSession)
const mockedUseLegalStatus = vi.mocked(queriesModule.useLegalStatus)
const mockedUseSeats = vi.mocked(queriesModule.useSeats)

const SESSION = { user: { id: "user-1" } }

/** A settled, non-blocking legal check — every test below is about the SEATS gate, not this one. */
function legalStatusResult() {
  return {
    data: { requiresAcceptance: false, pending: [] },
    isPending: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof queriesModule.useLegalStatus>
}

function seatsResult(overrides: Partial<ReturnType<typeof queriesModule.useSeats>>) {
  return {
    data: undefined,
    isPending: false,
    isError: false,
    error: null,
    ...overrides,
  } as unknown as ReturnType<typeof queriesModule.useSeats>
}

function renderLayout() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/dashboard" element={<div data-cy="dashboard-content">Dashboard</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe("(app)/_layout — no-free-seat gate", () => {
  // `SidebarProvider` (`@/components/ui/sidebar`, mounted by `AuthenticatedLayout` — not itself
  // mocked, unlike the app's own `Sidebar`) reads `matchMedia` via `useIsMobile` — jsdom implements
  // none of it. Same stub as `office-svg.spec.tsx`'s own.
  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it("renders nothing while the seats query is still in flight — no flash of the authenticated shell", () => {
    mockedUseSession.mockReturnValue({ data: SESSION, isPending: false } as never)
    mockedUseLegalStatus.mockReturnValue(legalStatusResult())
    mockedUseSeats.mockReturnValue(seatsResult({ isPending: true }))

    const { container } = renderLayout()

    expect(screen.queryByTestId("dashboard-content")).not.toBeInTheDocument()
    expect(screen.queryByText(/waiting/i)).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })

  it("does not fail open on a genuine seats-query error — a transient 500 never waves an over-capacity member through", () => {
    mockedUseSession.mockReturnValue({ data: SESSION, isPending: false } as never)
    mockedUseLegalStatus.mockReturnValue(legalStatusResult())
    mockedUseSeats.mockReturnValue(
      seatsResult({ isError: true, error: new ApiError(500, "Internal Server Error") }),
    )

    renderLayout()

    expect(screen.queryByTestId("dashboard-content")).not.toBeInTheDocument()
  })

  it("shows a visible retry screen (not a blank shell) once a genuine seats-query error settles", () => {
    mockedUseSession.mockReturnValue({ data: SESSION, isPending: false } as never)
    mockedUseLegalStatus.mockReturnValue(legalStatusResult())
    const refetch = vi.fn()
    mockedUseSeats.mockReturnValue(
      seatsResult({ isError: true, error: new ApiError(500, "Internal Server Error"), refetch }),
    )

    renderLayout()

    expect(screen.getByTestId("seat-check-error-screen")).toBeVisible()
    const retryButton = screen.getByTestId("seat-check-error-retry")
    expect(retryButton).toBeVisible()

    fireEvent.click(retryButton)
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it("a 404 (self-hosted, no billing at all) is treated as 'no seat gate', not as an error to block on", () => {
    mockedUseSession.mockReturnValue({ data: SESSION, isPending: false } as never)
    mockedUseLegalStatus.mockReturnValue(legalStatusResult())
    mockedUseSeats.mockReturnValue(seatsResult({ isError: true, error: new ApiError(404, "Not Found") }))

    renderLayout()

    expect(screen.getByTestId("dashboard-content")).toBeInTheDocument()
  })

  it("once the seats query resolves with nobody waiting, the authenticated shell renders normally", () => {
    mockedUseSession.mockReturnValue({ data: SESSION, isPending: false } as never)
    mockedUseLegalStatus.mockReturnValue(legalStatusResult())
    mockedUseSeats.mockReturnValue(seatsResult({ data: { seats: 3, members: [], waiting: [] } }))

    renderLayout()

    expect(screen.getByTestId("dashboard-content")).toBeInTheDocument()
  })
})
