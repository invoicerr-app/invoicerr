import { act, renderHook } from "@testing-library/react"
import { useForm } from "react-hook-form"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { DocumentFieldDescriptor } from "@/components/documents/types"
import { useDueDateDefault } from "@/components/documents/use-due-date-default"
import { usePaymentTerms } from "@/hooks/queries/use-payment-terms"
import type { ResolvedPaymentTerms } from "@/types"

vi.mock("@/hooks/queries/use-payment-terms", () => ({ usePaymentTerms: vi.fn() }))

const fields: DocumentFieldDescriptor[] = [
  { key: "issueDate", kind: "date", label: "Issue date" },
  { key: "dueDate", kind: "date", label: "Due date" },
]

function termsOf(partial: Partial<ResolvedPaymentTerms>): { data: ResolvedPaymentTerms } {
  return {
    data: { quote: null, invoice: null, cap: null, exceedsCap: { quote: false, invoice: false }, ...partial },
  }
}

function mockTerms(partial: Partial<ResolvedPaymentTerms>) {
  vi.mocked(usePaymentTerms).mockReturnValue(termsOf(partial) as never)
}

function setup(options: { typeId?: string; documentId?: string; seeded?: Record<string, unknown> } = {}) {
  return renderHook(() => {
    const form = useForm({ defaultValues: options.seeded ?? {} })
    useDueDateDefault(form, options.typeId ?? "invoice", fields, options.documentId, options.seeded?.dueDate)
    return form
  })
}

const pick = (form: ReturnType<typeof useForm>, name: string, value: string) =>
  act(() => form.setValue(name, value))

beforeEach(() => {
  vi.mocked(usePaymentTerms).mockReset()
})

describe("useDueDateDefault", () => {
  it("fills the due date as soon as the issue date is known", () => {
    mockTerms({ invoice: { days: 30, mode: "net" } })
    const { result } = setup()
    expect(result.current.getValues("dueDate")).toBeUndefined()
    pick(result.current, "issueDate", "2026-10-01")
    expect(result.current.getValues("dueDate")).toBe("2026-10-31")
  })

  it("uses the term of the document type", () => {
    mockTerms({ invoice: { days: 30, mode: "net" }, quote: { days: 15, mode: "endOfMonth" } })
    const { result } = setup({ typeId: "quote" })
    pick(result.current, "issueDate", "2026-10-01")
    expect(result.current.getValues("dueDate")).toBe("2026-10-31")
  })

  it("re-computes while the due date was never edited by hand", () => {
    mockTerms({ invoice: { days: 30, mode: "net" } })
    const { result } = setup()
    pick(result.current, "issueDate", "2026-10-01")
    pick(result.current, "issueDate", "2026-12-20")
    expect(result.current.getValues("dueDate")).toBe("2027-01-19")
  })

  it("keeps a due date edited by hand when the issue date changes", () => {
    mockTerms({ invoice: { days: 30, mode: "net" } })
    const { result } = setup()
    pick(result.current, "issueDate", "2026-10-01")
    pick(result.current, "dueDate", "2026-11-15")
    pick(result.current, "issueDate", "2026-12-20")
    expect(result.current.getValues("dueDate")).toBe("2026-11-15")
  })

  it("does not refill a due date the user cleared", () => {
    mockTerms({ invoice: { days: 30, mode: "net" } })
    const { result } = setup()
    pick(result.current, "issueDate", "2026-10-01")
    pick(result.current, "dueDate", "")
    pick(result.current, "issueDate", "2026-12-20")
    expect(result.current.getValues("dueDate")).toBe("")
  })

  it("fills in once the terms arrive after the issue date was already picked", () => {
    vi.mocked(usePaymentTerms).mockReturnValue({ data: undefined } as never)
    const { result, rerender } = setup({ seeded: { issueDate: "2026-10-01" } })
    expect(result.current.getValues("dueDate")).toBeUndefined()
    mockTerms({ invoice: { days: 30, mode: "endOfMonth" } })
    rerender()
    expect(result.current.getValues("dueDate")).toBe("2026-10-31")
  })

  it("leaves the due date blank when no default is configured", () => {
    mockTerms({})
    const { result } = setup()
    pick(result.current, "issueDate", "2026-10-01")
    expect(result.current.getValues("dueDate")).toBeUndefined()
  })

  it("never touches an existing record or a form seeded with a due date", () => {
    mockTerms({ invoice: { days: 30, mode: "net" } })
    const existing = setup({ documentId: "doc-1", seeded: { issueDate: "2026-10-01" } })
    expect(existing.result.current.getValues("dueDate")).toBeUndefined()
    const seeded = setup({ seeded: { dueDate: "2026-11-15" } })
    pick(seeded.result.current, "issueDate", "2026-10-01")
    expect(seeded.result.current.getValues("dueDate")).toBe("2026-11-15")
  })

  it("is inactive for other document types", () => {
    mockTerms({ invoice: { days: 30, mode: "net" } })
    const { result } = setup({ typeId: "expense" })
    pick(result.current, "issueDate", "2026-10-01")
    expect(result.current.getValues("dueDate")).toBeUndefined()
  })
})
