import type { TFunction } from "i18next"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { downloadDocumentPdf, previewDocumentPdf } from "@/components/documents/document-downloads"

const { authenticatedFetch } = vi.hoisted(() => ({ authenticatedFetch: vi.fn() }))
vi.mock("@/hooks/use-fetch", () => ({ authenticatedFetch }))

const t = ((key: string) => key) as unknown as TFunction

const quote = {
  id: "quote",
  label: "Quote",
  statuses: [
    { id: "draft", label: "Draft" },
    { id: "sent", label: "Sent" },
  ],
}

function pdfResponse() {
  return new Response(new Blob(["%PDF-1.7"], { type: "application/pdf" }), { status: 200 })
}

/** What a real `<a download>` click would hand the browser: the name it saves under. */
function captureSaves() {
  const saved: string[] = []
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    saved.push(this.download)
  })
  return saved
}

beforeEach(() => {
  authenticatedFetch.mockResolvedValue(pdfResponse())
  vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:pdf"), revokeObjectURL: vi.fn() })
  vi.spyOn(window, "open").mockImplementation(() => null)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("downloadDocumentPdf", () => {
  it("saves the PDF under the document's number", async () => {
    const saved = captureSaves()

    await downloadDocumentPdf(
      quote,
      { id: "0f3c9a1e-77aa-4d2b-9a51-3c1b2e4f5a6b", status: "sent", displayNumber: "QUOTE-2026-0007" },
      t,
    )

    expect(authenticatedFetch).toHaveBeenCalledWith(
      "/api/documents/0f3c9a1e-77aa-4d2b-9a51-3c1b2e4f5a6b/pdf?typeId=quote",
    )
    expect(saved).toEqual(["QUOTE-2026-0007.pdf"])
    expect(window.open).not.toHaveBeenCalled()
  })

  it("names a document without a number after its type, status and short id", async () => {
    const saved = captureSaves()

    await downloadDocumentPdf(
      quote,
      { id: "0f3c9a1e-77aa-4d2b-9a51-3c1b2e4f5a6b", status: "draft", displayNumber: null },
      t,
    )

    expect(saved).toEqual(["Quote Draft 0f3c9a1e.pdf"])
  })

  it("never lets a number's separator split the file name into folders", async () => {
    const saved = captureSaves()

    await downloadDocumentPdf(quote, { id: "0f3c9a1e", status: "sent", displayNumber: "FT A/12" }, t)

    expect(saved).toEqual(["FT A-12.pdf"])
  })
})

describe("previewDocumentPdf", () => {
  it("opens the PDF in a new tab and saves nothing", async () => {
    const saved = captureSaves()

    await previewDocumentPdf("quote", "0f3c9a1e", t)

    expect(window.open).toHaveBeenCalledWith("blob:pdf", "_blank")
    expect(saved).toEqual([])
  })
})
