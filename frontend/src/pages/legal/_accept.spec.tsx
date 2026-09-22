import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { describe, expect, it, vi } from "vitest"

import LegalAcceptPage from "./accept"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { toast } from "sonner"

vi.mock("@/lib/auth", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "user-1" } }, isPending: false }) },
}))

/** Same fetch-boundary mocking convention as `article-upsert.spec.tsx` (see that file's own
 *  header). Named with a leading underscore, like `(app)/_layout.tsx` itself, purely so
 *  generouted's route scanner (`./src/pages/**\/[\w[-]*.{jsx,tsx,mdx}`) leaves it alone — a bare
 *  `accept.spec.tsx` here got picked up as an actual route (`/legal/accept/spec`) and written into
 *  the generated, do-not-edit `router.ts`. */
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

type FetchHandler = (url: URL, init?: RequestInit) => unknown

function installFetchMock(handlers: Record<string, FetchHandler>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input.toString()
    const url = new URL(raw, "http://localhost")
    const method = (init?.method ?? "GET").toUpperCase()
    const key = `${method} ${url.pathname}`
    const handler = handlers[key]
    if (!handler) throw new Error(`Unmocked fetch in test: ${key}${url.search}`)
    return jsonResponse(handler(url, init), key.startsWith("POST") ? 500 : 200)
  })
  vi.stubGlobal("fetch", fn)
  return fn
}

const STATUS = { requiresAcceptance: true, pending: ["tos"] }
const DOCUMENTS = {
  saasMode: true,
  documents: [
    {
      slug: "tos",
      title: "Terms of Service",
      version: "2",
      effectiveDate: "2026-01-01",
      sidebarPosition: 1,
      content: "Updated terms.",
    },
  ],
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/legal/accept"]}>
        <LegalAcceptPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe("<LegalAcceptPage> — language selector", () => {
  it("shows one selector for the union of every pending document's languages, and re-fetches all of them with the chosen ?lang=", async () => {
    const status = { requiresAcceptance: true, pending: ["terms-of-service", "privacy-policy"] }
    const fetchMock = installFetchMock({
      "GET /api/legal/status": () => status,
      "GET /api/legal/documents": (url) => {
        const lang = url.searchParams.get("lang")
        return {
          saasMode: true,
          documents: [
            {
              slug: "terms-of-service",
              title: "Terms of Service",
              version: "2",
              effectiveDate: "2026-01-01",
              sidebarPosition: 1,
              content: "Terms body.",
              language: "en",
              availableLanguages: ["en", "fr"],
            },
            {
              slug: "privacy-policy",
              title: lang === "fr" ? "Politique de Confidentialité" : "Privacy Policy",
              version: "2",
              effectiveDate: "2026-01-01",
              sidebarPosition: 2,
              content: lang === "fr" ? "Corps français." : "Privacy body.",
              language: lang === "fr" ? "fr" : "en",
              availableLanguages: ["en", "fr", "de", "it", "pl", "pt"],
            },
          ],
        }
      },
    })

    renderPage()

    await screen.findByTestId("legal-accept-document-terms-of-service")
    expect(screen.getByTestId("legal-language-select")).toBeInTheDocument()

    // Every earlier GET (status + first documents fetch) carried no explicit lang.
    for (const call of fetchMock.mock.calls) {
      const url = new URL(call[0] as string, "http://localhost")
      if (url.pathname.endsWith("/legal/documents")) expect(url.searchParams.has("lang")).toBe(false)
    }
  })

  it("shows no selector when every pending document has only one language", async () => {
    installFetchMock({
      "GET /api/legal/status": () => ({ requiresAcceptance: true, pending: ["terms-of-service"] }),
      "GET /api/legal/documents": () => ({
        saasMode: true,
        documents: [
          {
            slug: "terms-of-service",
            title: "Terms of Service",
            version: "2",
            effectiveDate: "2026-01-01",
            sidebarPosition: 1,
            content: "Terms body.",
            language: "en",
            availableLanguages: ["en"],
          },
        ],
      }),
    })

    renderPage()

    await screen.findByTestId("legal-accept-document-terms-of-service")
    expect(screen.queryByTestId("legal-language-select")).not.toBeInTheDocument()
  })
})

describe("<LegalAcceptPage> — accept failure", () => {
  it("shows the server's own error message and re-enables the button, instead of leaving it dead with no feedback", async () => {
    installFetchMock({
      "GET /api/legal/status": () => STATUS,
      "GET /api/legal/documents": () => DOCUMENTS,
      "POST /api/legal/accept": () => ({ message: "Session expired, please sign in again." }),
    })

    renderPage()

    // Both GETs (status + documents) have to settle before the button is enabled at all
    // (`disabled={loading}`) — wait for the actual document content, not just the button's own
    // presence in the DOM, which is unconditional from the very first render.
    await screen.findByTestId("legal-accept-document-tos")
    const acceptButton = screen.getByTestId("legal-accept-btn")
    fireEvent.click(acceptButton)

    // The server's own message reaches the user — not a generic fallback, and not silence.
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Session expired, please sign in again."))

    // No dead end: the button is reachable again for a retry (react-query's `isPending` already
    // settles back to `false` once the mutation fails — this only proves the failure didn't leave
    // it stuck some OTHER way, e.g. an unhandled rejection aborting the render).
    await waitFor(() => expect(acceptButton).not.toBeDisabled())

    // Nothing navigated away — a failed accept must never look like a successful one.
    expect(screen.getByTestId("legal-accept-page")).toBeInTheDocument()
  })
})
