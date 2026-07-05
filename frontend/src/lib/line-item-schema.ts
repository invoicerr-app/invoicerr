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
        order: z.number(),
    })
}
