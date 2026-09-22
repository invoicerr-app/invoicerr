import { describe, expect, it } from "vitest"

import { buildZodSchema } from "./schema"
import type { DocumentFieldDescriptor } from "./types"

/** A VAT-rate-shaped 'select' field: `options` holds today's catalog ids, `legacyOptions` the bare
 *  percentage a document saved before catalog ids existed still carries — the exact shape
 *  `descriptors/company-view.ts` sends for a `usesVatRateCatalog` field. */
const vatRateField: DocumentFieldDescriptor = {
  key: "vatRate",
  kind: "select",
  label: "VAT rate",
  required: true,
  options: [
    { value: "it-esente", label: "0% — Esente" },
    { value: "it-standard", label: "22% — Ordinaria" },
  ],
  legacyOptions: [
    { value: "0", label: "0% — Esente" },
    { value: "22", label: "22% — Ordinaria" },
  ],
}

describe("buildZodSchema — 'select' with legacyOptions", () => {
  it("accepts a current catalog id", () => {
    const schema = buildZodSchema([vatRateField])
    expect(schema.safeParse({ vatRate: "it-standard" }).success).toBe(true)
  })

  it("still accepts a value persisted before catalog ids existed (legacyOptions)", () => {
    const schema = buildZodSchema([vatRateField])
    expect(schema.safeParse({ vatRate: "22" }).success).toBe(true)
    expect(schema.safeParse({ vatRate: "0" }).success).toBe(true)
  })

  it("rejects a value in neither options nor legacyOptions", () => {
    const schema = buildZodSchema([vatRateField])
    expect(schema.safeParse({ vatRate: "de-standard" }).success).toBe(false)
  })

  it("never restricts a select with no options at all (allowCustomValue's own empty-list case)", () => {
    const noOptionsField: DocumentFieldDescriptor = { key: "custom", kind: "select", label: "Custom" }
    const schema = buildZodSchema([noOptionsField])
    expect(schema.safeParse({ custom: "anything" }).success).toBe(true)
  })
})
