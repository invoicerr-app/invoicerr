import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

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
  return { ...actual, useLegalStatus: vi.fn(), useSeats: vi.fn(), useLegalDocuments: vi.fn() }
})

const mockedUseSession = vi.mocked(authClient.useSession)
const mockedUseLegalStatus = vi.mocked(queriesModule.useLegalStatus)
const mockedUseSeats = vi.mocked(queriesModule.useSeats)
const mockedUseLegalDocuments = vi.mocked(queriesModule.useLegalDocuments)

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

/** Defaults to "still in flight" — `useLegalLinks()`'s own "assume yes" reasoning for `data ===
 *  undefined` means every test that doesn't care about the footer one way or the other keeps seeing
 *  it, the same as when this hook wasn't mocked at all. */
function legalDocumentsResult(overrides: Partial<ReturnType<typeof queriesModule.useLegalDocuments>> = {}) {
  return {
    data: undefined,
    isPending: true,
    isError: false,
    error: null,
    ...overrides,
  } as unknown as ReturnType<typeof queriesModule.useLegalDocuments>
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
    mockedUseLegalDocuments.mockReturnValue(legalDocumentsResult())
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

/**
 * The permanent legal-links `<footer>` — the wrapper this task added a border/padding to. It must
 * disappear along with its contents on a self-hosted instance, not sit there as an empty bordered
 * strip once `<LegalLinks/>` itself renders `null` (see `legal-links.tsx#useLegalLinks`'s own header
 * for why the border/padding living on the wrapper, not on what it contains, made that possible).
 */
describe("(app)/_layout — the legal-links footer", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )
    mockedUseSession.mockReturnValue({ data: SESSION, isPending: false } as never)
    mockedUseLegalStatus.mockReturnValue(legalStatusResult())
    mockedUseSeats.mockReturnValue(seatsResult({ data: { seats: 3, members: [], waiting: [] } }))
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it("renders no <footer> at all once a self-hosted instance's catalogue settles empty", () => {
    mockedUseLegalDocuments.mockReturnValue(
      legalDocumentsResult({ data: { saasMode: false, documents: [] } }),
    )

    const { container } = renderLayout()

    expect(screen.getByTestId("dashboard-content")).toBeInTheDocument()
    expect(container.querySelector("footer")).not.toBeInTheDocument()
    expect(screen.queryByTestId("legal-links")).not.toBeInTheDocument()
  })

  it("renders the <footer> with its links once the catalogue carries at least one document", () => {
    mockedUseLegalDocuments.mockReturnValue(
      legalDocumentsResult({
        data: {
          saasMode: true,
          documents: [
            {
              slug: "terms-of-service",
              title: "Terms of Service",
              version: "1",
              effectiveDate: "2026-09-20",
              sidebarPosition: 0,
              content: "…",
              language: "en",
              availableLanguages: ["en"],
            },
          ],
        },
      }),
    )

    const { container } = renderLayout()

    expect(container.querySelector("footer")).toBeInTheDocument()
    expect(screen.getByTestId("legal-links")).toBeInTheDocument()
    expect(screen.getByTestId("legal-link-terms-of-service")).toBeInTheDocument()
  })
})

/**
 * The public `/signature/:token` path (`ALLOWED_PATHS`) never reads `session`/`legalStatus`/
 * `seatsView` — regression for issue #380: `useSession()` refetches on its own (better-auth
 * revalidates on window focus), so `isPending` flips back to `true` long after the first load, not
 * only during it. The gate used to check `isPending` BEFORE the allowed-path branch, so every such
 * refetch blanked (`return null`) this page for one render and then REMOUNTED it on the next —
 * wiping whatever step/code a visitor was mid-entry on every tab-back.
 */
describe("(app)/_layout — the public signature path ignores session-refetch churn", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  function renderSignaturePath(sessionIsPending: boolean) {
    mockedUseSession.mockReturnValue({ data: null, isPending: sessionIsPending } as never)
    mockedUseLegalStatus.mockReturnValue(legalStatusResult())
    mockedUseSeats.mockReturnValue(seatsResult({}))

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/signature/abc123"]}>
          <Routes>
            <Route element={<Layout />}>
              <Route
                path="/signature/:token"
                element={<div data-cy="signature-page-content">Signature</div>}
              />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it("stays mounted while a background session refetch is in flight (isPending: true)", () => {
    renderSignaturePath(true)
    expect(screen.getByTestId("signature-page-content")).toBeInTheDocument()
  })

  it("renders identically once that refetch settles — the path never depended on it either way", () => {
    renderSignaturePath(false)
    expect(screen.getByTestId("signature-page-content")).toBeInTheDocument()
  })
})

describe("(app)/_layout — the authenticated shell survives a session refetch", () => {
  // The only block here that renders the REAL authenticated shell rather than a gate returning
  // null, so it is the only one that reaches the sidebar's mobile-breakpoint hook — jsdom ships no
  // `matchMedia`, and without this stub the shell throws before any assertion can run.
  beforeAll(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  /** A session that is already known, with a refetch in flight on top of it — the exact shape
   *  better-auth produces on every window focus: `data` still populated, `isPending` back to true. */
  function renderShell(sessionIsPending: boolean) {
    mockedUseSession.mockReturnValue({
      data: { user: { id: "u1" } },
      isPending: sessionIsPending,
    } as never)
    mockedUseLegalStatus.mockReturnValue(legalStatusResult())
    mockedUseSeats.mockReturnValue(seatsResult({}))
    mockedUseLegalDocuments.mockReturnValue(legalDocumentsResult())

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/dashboard"]}>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/dashboard" element={<div data-cy="shell-content">Dashboard</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it("keeps the shell mounted while a background session refetch is in flight", () => {
    renderShell(true)
    expect(screen.getByTestId("shell-content")).toBeInTheDocument()
  })

  it("renders the same shell once that refetch settles", () => {
    renderShell(false)
    expect(screen.getByTestId("shell-content")).toBeInTheDocument()
  })
})
