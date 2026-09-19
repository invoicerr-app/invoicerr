import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ArticleUpsert } from "@/pages/(app)/articles/_components/article-upsert"
import { ArticleType, type Article } from "@/types/article"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { toast } from "sonner"

/** Same fetch-boundary mocking as `document-create-dialog.spec.tsx` (kept local, same convention). */
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
    return jsonResponse(handler(url, init))
  })
  vi.stubGlobal("fetch", fn)
  return fn
}

const ARTICLE: Article = {
  id: "article-1",
  companyId: "company-1",
  name: "Consulting",
  description: "",
  type: ArticleType.SERVICE,
  unitPrice: 120,
  vatRate: 20,
  quantity: null,
  lowStockThreshold: null,
}

function renderDialog(article: Article) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ArticleUpsert article={article} open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  )
}

/** `SteppedDialog`'s `DialogContent` (Radix) teleports into a portal appended straight to
 *  `document.body`, a SIBLING of `render()`'s own returned `container` div, not a descendant of it —
 *  querying `container` alone would never see it. `document.body.querySelector` reaches it, the same
 *  root `screen`'s own queries already resolve against. */
function fieldInput(name: string): HTMLInputElement {
  const input = document.body.querySelector(`input[name="${name}"]`)
  if (!input) throw new Error(`No input named "${name}" in the document`)
  return input as HTMLInputElement
}

describe("<ArticleUpsert>", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("rejects an emptied price as a validation error instead of silently saving it as 0", async () => {
    const patch = vi.fn()
    installFetchMock({
      "GET /api/company/info": () => ({ id: "company-1", currency: "EUR" }),
      "PATCH /api/articles/article-1": (_url, init) => {
        patch(init?.body ? JSON.parse(init.body as string) : undefined)
        return { ...ARTICLE, unitPrice: 0 }
      },
    })

    renderDialog(ARTICLE)

    fireEvent.click(await screen.findByTestId("article-dialog-step-pricing"))
    const priceInput = fieldInput("unitPrice")
    expect(priceInput).toHaveValue(120)

    // Select the price and clear it — exactly the reported scenario.
    fireEvent.change(priceInput, { target: { value: "" } })
    fireEvent.click(screen.getByTestId("article-dialog-continue"))

    // Blocked right here: a visible "required" error, the wizard stays on this step, and the API is
    // never reached with a fabricated zero.
    expect(await screen.findByText("Price is required")).toBeInTheDocument()
    expect(screen.getByTestId("article-dialog-step-body-pricing")).toBeInTheDocument()
    expect(patch).not.toHaveBeenCalled()
  })

  it("shows a field error instead of an unhandled rejection when a stale, unrevalidated step is submitted", async () => {
    const patch = vi.fn()
    installFetchMock({
      "GET /api/company/info": () => ({ id: "company-1", currency: "EUR" }),
      "PATCH /api/articles/article-1": (_url, init) => {
        patch(init?.body ? JSON.parse(init.body as string) : undefined)
        return ARTICLE
      },
    })

    renderDialog(ARTICLE)

    // Clear the name on the Identity step, then jump STRAIGHT to Stock via its header chip —
    // `stepperJumpTo` never revalidates a step it lands on, so Identity's own emptied, now-invalid
    // field is never re-checked before the final "Continue" is pressed from a completely different
    // step.
    const nameInput = fieldInput("name")
    fireEvent.change(nameInput, { target: { value: "" } })
    fireEvent.click(screen.getByTestId("article-dialog-step-stock"))

    fireEvent.click(await screen.findByTestId("article-submit"))

    // No unhandled rejection, no silent no-op: the API is never called with the stale, invalid data.
    // `SteppedDialog` itself now re-validates the WHOLE form on the last step's submit
    // (`stepped-dialog.tsx`'s own `handleContinue`) and jumps back to the first step carrying an
    // error BEFORE ever calling this component's `onSubmit` — so the `safeParse` branch below (and
    // its `toast.error`) never even runs here; that branch stays as this form's own last line of
    // defense for whatever `SteppedDialog`'s generic gate cannot see, not the layer that catches
    // THIS scenario.
    await waitFor(() => expect(patch).not.toHaveBeenCalled())
    expect(toast.error).not.toHaveBeenCalled()
    expect(screen.getByTestId("article-dialog")).toBeInTheDocument()

    // The error is visible RIGHT NOW, with no further action — the wizard itself jumped back to
    // Identity (the step that actually renders the "name" field) the moment the whole-form
    // `form.trigger()` found the error there, rather than leaving it attached to a field sitting
    // behind the Stock step the user was still looking at.
    expect(await screen.findByText("Name is required")).toBeInTheDocument()
    expect(screen.getByTestId("article-dialog-step-body-identity")).toBeInTheDocument()
  })
})
