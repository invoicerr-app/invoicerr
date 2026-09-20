import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router"
import { describe, expect, it, vi } from "vitest"

import LegalDocumentPage from "./[slug]"

/** Same fetch-boundary mocking convention as `_accept.spec.tsx` (see that file's own header). Named
 *  with a leading underscore so generouted's route scanner leaves it alone. */
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

type FetchHandler = (url: URL) => unknown

function installFetchMock(handler: FetchHandler) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const raw = typeof input === "string" ? input : input.toString()
    const url = new URL(raw, "http://localhost")
    return jsonResponse(handler(url))
  })
  vi.stubGlobal("fetch", fn)
  return fn
}

function privacyPolicyDoc(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    slug: "privacy-policy",
    title: "Privacy Policy",
    version: "2026-09-19",
    effectiveDate: "2026-09-19",
    sidebarPosition: 2,
    content: "English body.",
    language: "en",
    availableLanguages: ["en", "fr", "de", "it", "pl", "pt"],
    ...overrides,
  }
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/legal/privacy-policy"]}>
        <Routes>
          <Route path="/legal/:slug" element={<LegalDocumentPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe("<LegalDocumentPage> — language selector", () => {
  it("shows a language selector when the document has more than one language, and refetches with an explicit ?lang= on change", async () => {
    const fetchMock = installFetchMock((url) => {
      const lang = url.searchParams.get("lang")
      return {
        saasMode: false,
        documents: [
          lang === "de"
            ? privacyPolicyDoc({ language: "de", title: "Datenschutzerklärung", content: "Deutscher Text." })
            : privacyPolicyDoc(),
        ],
      }
    })

    renderPage()

    await screen.findByTestId("legal-document-content")
    expect(screen.getByText("Privacy Policy")).toBeInTheDocument()
    expect(screen.getByTestId("legal-language-select")).toBeInTheDocument()

    // First load never sent an explicit lang — the backend resolved it on its own.
    const firstUrl = new URL((fetchMock.mock.calls[0]?.[0] as string) ?? "", "http://localhost")
    expect(firstUrl.searchParams.has("lang")).toBe(false)
  })

  it("shows no language selector for a document with only one language", async () => {
    installFetchMock(() => ({
      saasMode: false,
      documents: [privacyPolicyDoc({ availableLanguages: ["en"] })],
    }))

    renderPage()

    await screen.findByTestId("legal-document-content")
    expect(screen.queryByTestId("legal-language-select")).not.toBeInTheDocument()
  })

  it("shows the not-found message when the slug does not match any served document in SaaS mode", async () => {
    // saasMode:true with a NONEMPTY catalogue that just doesn't carry THIS route's slug
    // (`/legal/privacy-policy` — see `renderPage()`) — an ordinary bad URL on a hosted instance,
    // distinct from the self-hosted case below (empty catalogue) even though both land on the same
    // `legal-document-not-found` test id.
    installFetchMock(() => ({
      saasMode: true,
      documents: [privacyPolicyDoc({ slug: "terms-of-service", title: "Terms of Service" })],
    }))

    renderPage()

    await waitFor(() => expect(screen.getByTestId("legal-document-not-found")).toBeInTheDocument())
    expect(screen.getByTestId("legal-document-not-found")).toHaveTextContent("could not be found")
  })
})

describe("<LegalDocumentPage> — self-hosted (empty catalogue)", () => {
  it("shows a distinct 'not published on this instance' notice, not the generic not-found wording, when the whole catalogue is empty", async () => {
    // The self-hosted shape: `saasMode:false` and `documents: []`, regardless of which slug was
    // requested — `legal.service.ts#listDocuments` serves NOTHING outside SaaS mode. A bookmark to a
    // real slug (privacy-policy here) must not look like a broken/missing page; it must say plainly
    // that this instance doesn't publish it.
    installFetchMock(() => ({ saasMode: false, documents: [] }))

    renderPage()

    const notice = await screen.findByTestId("legal-document-not-found")
    expect(notice).toHaveTextContent("doesn't publish this document")
    expect(notice).not.toHaveTextContent("could not be found")
  })
})
