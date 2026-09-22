import { z } from "zod"

export type LineItemTranslationPrefix = "invoices" | "quotes" | "recurringInvoices"

/**
 * Shared zod schema factory for a document line item (invoice / quote /
 * recurring invoice upserts). The item shape and validation messages are
 * identical across the three upserts; only two things vary and are therefore
 * parameters:
 * - `translationPrefix`: the i18n namespace of the validation messages
 * - `typeSchema`: invoices constrain `type` to the item-type enum (optional),
 *   quotes/recurring accept any string
 */
export function createLineItemSchema<TType extends z.ZodTypeAny>(
  t: (key: string) => string,
  translationPrefix: LineItemTranslationPrefix,
  typeSchema: TType,
) {
  return z.object({
    id: z.string().optional(),
    name: z
      .string()
      .min(1, t(`${translationPrefix}.upsert.form.items.name.errors.required`))
      .refine((val) => val !== "", {
        message: t(`${translationPrefix}.upsert.form.items.name.errors.required`),
      }),
    description: z.string().optional(),
    type: typeSchema,
    quantity: z
      .number({
        invalid_type_error: t(`${translationPrefix}.upsert.form.items.quantity.errors.required`),
      })
      .min(0.001, t(`${translationPrefix}.upsert.form.items.quantity.errors.min`))
      .refine((val) => !isNaN(val), {
        message: t(`${translationPrefix}.upsert.form.items.quantity.errors.invalid`),
      }),
    unitPrice: z
      .number({
        invalid_type_error: t(`${translationPrefix}.upsert.form.items.unitPrice.errors.required`),
      })
      .min(0, t(`${translationPrefix}.upsert.form.items.unitPrice.errors.min`))
      .refine((val) => !isNaN(val), {
        message: t(`${translationPrefix}.upsert.form.items.unitPrice.errors.invalid`),
      }),
    vatRate: z
      .number({
        invalid_type_error: t(`${translationPrefix}.upsert.form.items.vatRate.errors.required`),
      })
      .min(0, t(`${translationPrefix}.upsert.form.items.vatRate.errors.min`)),
    /**
     * EN 16931 BT-151, DECLARED by the issuer, and only ever meaningful on a 0% line.
     *
     * A 0 rate is the one value that does not determine its category: `Z` (zero-rated, taxed at 0),
     * `E` (exempt) and `O` (outside the scope) all carry it and ask contradictory things of the
     * document. No country fact settles it either — France levying no zero rate rules `Z` out and
     * still leaves two. So the issuer says, or leaves it to the engine.
     *
     * Deliberately NOT offering AE, K or G: those are cross-border determinations the engine makes
     * from the corridor, and letting a form override them would put a tax-liability decision behind
     * a dropdown.
     */
    vatCategory: z.enum(["E", "Z", "O"]).optional(),
    /** BT-120/BT-121 — why. Required by BR-E-10 for `E` and BR-O-10 for `O`. */
    vatExemptionReason: z.string().optional(),
    order: z.number(),
  })
}
