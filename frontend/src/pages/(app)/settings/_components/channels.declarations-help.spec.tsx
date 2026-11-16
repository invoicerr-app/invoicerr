import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import i18n from "i18next"
import { afterEach, describe, expect, it, vi } from "vitest"

import ChannelsSettings from "@/pages/(app)/settings/_components/channels.settings"

const rawSourceText =
  "Read from codes.droit.org, extracted via pdftotext; Legifrance returned a Cloudflare wall (fr.json)."

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

function installFetchMock(reportingObligations: unknown[]) {
  const bodies: Record<string, unknown> = {
    "GET /api/company/channels": {
      configured: [],
      suggested: [],
      reportingObligations,
      legalChannels: [],
      banner: { tone: "none" },
    },
    "GET /api/documents/transports": [],
    "GET /api/documents/operators": [],
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost")
      const key = `${(init?.method ?? "GET").toUpperCase()} ${url.pathname}`
      if (!(key in bodies)) throw new Error(`Unmocked fetch in test: ${key}`)
      return jsonResponse(bodies[key])
    }),
  )
}

function renderScreen() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ChannelsSettings />
    </QueryClientProvider>,
  )
}

const obligation = (providerId: string) => ({
  providerId,
  appliesTo: "invoice",
  provenance: { kind: "legal", sourceText: rawSourceText, sourceCheckedAt: "2026-10-24" },
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("Channels settings - Declarations help", () => {
  it("shows the curated, translated explanation behind each declaration's help, never the research provenance", async () => {
    installFetchMock([obligation("pdp"), obligation("fr-pa"), obligation("pt-at")])
    renderScreen()

    for (const providerId of ["pdp", "fr-pa", "pt-at"]) {
      const help = await screen.findByTestId(`declaration-${providerId}-source-help`)
      expect(help).toHaveTextContent(i18n.t(`settings.channels.declarations.${providerId}.explanation`))
      expect(help).not.toHaveTextContent(rawSourceText)
    }
  })

  it("renders no help button for a declaration with no written explanation, rather than its provenance", async () => {
    installFetchMock([obligation("xx-unknown")])
    renderScreen()

    await screen.findByTestId("declaration-xx-unknown")
    expect(screen.queryByTestId("declaration-xx-unknown-source-help")).toBeNull()
  })
})
