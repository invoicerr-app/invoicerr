import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { LegalLinks } from "./legal-links"

/** Same fetch-boundary mocking convention as `pages/legal/_document.spec.tsx`. */
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

function installFetchMock(documents: unknown[]) {
  const fn = vi.fn(async () => jsonResponse({ saasMode: false, documents }))
  vi.stubGlobal("fetch", fn)
  return fn
}

/** Never settles — for asserting what renders BEFORE `useLegalDocuments()` resolves. */
function installPendingFetchMock() {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => {})),
  )
}

function doc(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    slug: "terms-of-service",
    title: "Terms of Service",
    version: "3",
    effectiveDate: "2026-09-20",
    sidebarPosition: 0,
    content: "…",
    language: "en",
    availableLanguages: ["en"],
    ...overrides,
  }
}

/** Every document the six-strong catalog serves as of this test — matches the curated list inside
 *  `legal-links.tsx` exactly, so these specs exercise the steady state before probing the guard. */
const CURATED_DOCUMENTS = [
  doc({ slug: "terms-of-service", title: "Terms of Service", sidebarPosition: 0 }),
  doc({ slug: "privacy-policy", title: "Privacy Policy", sidebarPosition: 1 }),
  doc({ slug: "data-processing-agreement", title: "Data Processing Agreement", sidebarPosition: 2 }),
  doc({ slug: "legal-notice", title: "Legal Notice", sidebarPosition: 3 }),
  doc({ slug: "cookies-and-acceptable-use", title: "Cookies & Acceptable Use", sidebarPosition: 4 }),
  doc({
    slug: "international-access-transparency",
    title: "International Access Transparency",
    sidebarPosition: 5,
  }),
]

function renderLinks() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <LegalLinks />
    </QueryClientProvider>,
  )
}

describe("<LegalLinks>", () => {
  it("links every one of the six documents currently served, each pointing at /legal/<slug>", async () => {
    installFetchMock(CURATED_DOCUMENTS)
    renderLinks()

    for (const document of CURATED_DOCUMENTS) {
      const link = await screen.findByTestId(`legal-link-${document.slug}`)
      expect(link).toHaveAttribute("href", `/legal/${document.slug}`)
    }
    // Nothing else slipped in or out — exactly the six, not five and not seven.
    expect(screen.getAllByRole("link")).toHaveLength(CURATED_DOCUMENTS.length)
  })

  it("still links a document the backend serves that has no curated label — the guard against an unlinked document", async () => {
    // A seventh document, added to the catalog after this component's own curated list was last
    // touched — exactly how `international-access-transparency` itself was served-but-unlinked
    // before it was added here. Nobody updated legal-links.tsx for it in this scenario on purpose.
    const laterDocument = doc({
      slug: "some-new-compliance-page",
      title: "Some New Compliance Page",
      sidebarPosition: 6,
    })
    installFetchMock([...CURATED_DOCUMENTS, laterDocument])
    renderLinks()

    const link = await screen.findByTestId("legal-link-some-new-compliance-page")
    expect(link).toHaveAttribute("href", "/legal/some-new-compliance-page")
    // Labelled from the document's own (already-localized) title — no translation key exists for it.
    expect(link).toHaveTextContent("Some New Compliance Page")

    await waitFor(() => {
      expect(screen.getAllByRole("link")).toHaveLength(CURATED_DOCUMENTS.length + 1)
    })
  })

  it("drops a curated entry once the backend stops serving it, instead of linking a dead page", async () => {
    const stillServed = CURATED_DOCUMENTS.filter((document) => document.slug !== "cookies-and-acceptable-use")
    installFetchMock(stillServed)
    renderLinks()

    await screen.findByTestId("legal-link-terms-of-service")
    await waitFor(() => {
      expect(screen.queryByTestId("legal-link-cookies-and-acceptable-use")).not.toBeInTheDocument()
    })
    expect(screen.getAllByRole("link")).toHaveLength(stillServed.length)
  })

  it("shows the curated baseline immediately, before the fetch to the backend has resolved", () => {
    installPendingFetchMock()
    renderLinks()

    // Synchronous assertion, deliberately with no `await`/`findBy`: a legal link list that blanks
    // out for however long the network takes (or forever, if the request never resolves) is a
    // regression, not a loading state — this is the whole reason the curated list stays hardcoded
    // rather than depending on the fetch to render at all.
    for (const document of CURATED_DOCUMENTS) {
      expect(screen.getByTestId(`legal-link-${document.slug}`)).toHaveAttribute(
        "href",
        `/legal/${document.slug}`,
      )
    }
  })
})
