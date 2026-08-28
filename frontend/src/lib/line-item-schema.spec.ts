import { describe, expect, it } from "vitest"
import { z } from "zod"
import { createLineItemSchema } from "./line-item-schema"

// The factory takes `t` only to localise its messages; returning the key keeps the assertions
// below about validation, not about English.
const t = (key: string) => key

// The same `typeSchema` the invoice upsert passes (`invoice-upsert.tsx`), so this exercises the
// stricter of the two call shapes.
const schema = createLineItemSchema(
  t,
  "invoices",
  z.enum(["HOUR", "DAY", "DEPOSIT", "SERVICE", "PRODUCT"]).optional(),
)

const validItem = {
  name: "Consulting",
  type: "SERVICE" as const,
  quantity: 2,
  unitPrice: 250,
  vatRate: 20,
  order: 0,
}

describe("createLineItemSchema", () => {
  it("parses a valid line item", () => {
    const result = schema.safeParse(validItem)

    expect(result.success).toBe(true)
    expect(result.success && result.data).toMatchObject({
      name: "Consulting",
      quantity: 2,
      unitPrice: 250,
      vatRate: 20,
      order: 0,
    })
  })

  describe("vatCategory (EN 16931 BT-151)", () => {
    // The three categories a 0% rate can mean, which the rate alone cannot disambiguate.
    it.each(["E", "Z", "O"])("accepts the issuer-declarable category %s", (category) => {
      const result = schema.safeParse({ ...validItem, vatRate: 0, vatCategory: category })

      expect(result.success).toBe(true)
      expect(result.success && result.data.vatCategory).toBe(category)
    })

    it("rejects AE, which is the engine's determination and not a form's", () => {
      // Reverse charge is decided from the corridor by the tax engine. Accepting it here would put
      // a tax-liability decision behind a dropdown.
      const result = schema.safeParse({ ...validItem, vatRate: 0, vatCategory: "AE" })

      expect(result.success).toBe(false)
      expect(result.success === false && result.error.issues.map((i) => i.path.join("."))).toContain(
        "vatCategory",
      )
    })

    it("is optional — omitting it leaves the category to the engine", () => {
      const result = schema.safeParse(validItem)

      expect(result.success).toBe(true)
      expect(result.success && result.data.vatCategory).toBeUndefined()
    })
  })
})
