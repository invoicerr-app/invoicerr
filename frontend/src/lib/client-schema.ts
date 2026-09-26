import { z } from "zod"
import type { TFunction } from "i18next"

import { isValidPostalCode } from "@/pages/(app)/clients/_components/postal-code"

/** One identifier requirement, as `useRequiredIdentifiers` already shapes it - re-exported here
 *  rather than imported from that hook so this file (used from a plain, non-React context by the CSV
 *  import) has no dependency on a React hook module. */
export interface ClientSchemaIdentifierRequirement {
  scheme: string
  label: string
  required: boolean
  pattern?: string
}

/**
 * The client create/edit wizard's own zod schema, extracted out of `client-upsert.tsx` (where it used
 * to be built inline, around what was lines 930-1070) so a SECOND caller - the CSV import's per-row
 * validation, `frontend/src/lib/csv-import/client-rows.ts` - can validate against the exact same
 * rules instead of a hand-copied twin that could silently drift. The wizard itself now calls this
 * too; its own behaviour is unchanged (see `client-upsert.spec.tsx`, which still exercises the wizard
 * through its public behaviour, not this function directly).
 *
 * `requiredIdentifiers`/`originalIdentifierValues` are the two pieces of external state the wizard's
 * own `superRefine` used to read off `requiredIdentifiersRef`/`originalIdentifierValuesRef` - passed
 * in explicitly here instead, since a plain builder function has no render cycle to hang a ref off
 * of. The wizard passes its refs' `.current`; the import passes the per-row country's own
 * requirements and an empty map (a freshly imported row has no "value already on file" to
 * grandfather - see `validate-identifier-value.ts`'s own DECISION 2 for what that grandfather clause
 * is for on an EDIT, which an import row never is).
 */
export function buildClientSchema(
  t: TFunction,
  requiredIdentifiers: ClientSchemaIdentifierRequirement[],
  originalIdentifierValues: Map<string, string>,
) {
  return z
    .object({
      type: z.enum(["INDIVIDUAL", "COMPANY"]),
      kind: z.enum(["BUSINESS", "GOVERNMENT"]),
      isSupplier: z.boolean().optional(),
      name: z.string().optional(),
      description: z.string().max(500, t("clients.upsert.validation.description.maxLength")).optional(),
      currency: z.string().nullable().optional(),
      foundedAt: z
        .date()
        .optional()
        .refine((date) => !date || date <= new Date(), t("clients.upsert.validation.foundedAt.future")),
      contactFirstname: z.string().optional(),
      contactLastname: z.string().optional(),
      contactPhone: z
        .string()
        .optional()
        .refine((val) => {
          if (!val) return true
          return /^[+]?[0-9\s\-()]{8,20}$/.test(val)
        }, t("clients.upsert.validation.contactPhone.format")),
      contactEmail: z
        .string()
        .optional()
        .refine((val) => {
          if (!val) return true
          return z.string().email().safeParse(val).success
        }, t("clients.upsert.validation.contactEmail.format")),
      // Several named contacts per client (#415) - the wizard's own CONTACT step
      // (`client-upsert.tsx`'s `ContactsSection`). Optional/absent for the CSV import's row schema
      // (a row still carries only the four flat fields above, which stay meaning "the primary
      // contact" - see `client-import.service.ts`'s own header); the wizard always sends this array,
      // never the flat fields, once at least one contact row exists.
      contacts: z
        .array(
          z.object({
            id: z.string().optional(),
            firstName: z.string().optional(),
            lastName: z.string().optional(),
            role: z.string().optional(),
            email: z
              .string()
              .optional()
              .refine((val) => !val || z.string().email().safeParse(val).success, {
                message: t("clients.upsert.validation.contactEmail.format"),
              }),
            phone: z
              .string()
              .optional()
              .refine((val) => !val || /^[+]?[0-9\s\-()]{8,20}$/.test(val), {
                message: t("clients.upsert.validation.contactPhone.format"),
              }),
            isPrimary: z.boolean().optional(),
          }),
        )
        .optional(),
      address: z.string().min(1, t("clients.upsert.validation.address.required")),
      addressLine2: z.string().optional(),
      postalCode: z
        .string()
        .refine((val) => isValidPostalCode(val), t("clients.upsert.validation.postalCode.format")),
      city: z.string().min(1, t("clients.upsert.validation.city.required")),
      state: z.string().optional(),
      country: z.string().min(1, t("clients.upsert.validation.country.required")),
      countryCode: z.string().optional(),
      language: z.string().nullable().optional(),
      identifiers: z.array(z.object({ scheme: z.string(), value: z.string() })).optional(),
      peppolSchemeId: z.string().optional(),
      peppolEndpointId: z.string().optional(),
      customFields: z.record(z.string(), z.unknown()).optional(),
    })
    .superRefine((val, ctx) => {
      if (val.type === "INDIVIDUAL") {
        // The wizard folds the identity step's contactFirstname/contactLastname into the primary
        // contact at submit time (#415 - see `client-upsert.tsx`'s own `buildContactsPayload`), so
        // those two top-level fields are still the right thing to validate here regardless of
        // whether `contacts` is also present.
        if (!val.contactFirstname || val.contactFirstname.trim() === "") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["contactFirstname"],
            message:
              t("clients.upsert.validation.contactFirstname.required") ||
              "First name is required for individuals",
          })
        }
        if (!val.contactLastname || val.contactLastname.trim() === "") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["contactLastname"],
            message:
              t("clients.upsert.validation.contactLastname.required") ||
              "Last name is required for individuals",
          })
        }
      } else {
        if (!val.name || val.name.trim() === "") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["name"],
            message: t("clients.upsert.validation.name.required"),
          })
        }
      }

      for (const req of requiredIdentifiers) {
        const idx = (val.identifiers ?? []).findIndex((i) => i.scheme === req.scheme)
        const value = idx >= 0 ? val.identifiers?.[idx]?.value : undefined
        if (req.required && (!value || value.trim() === "")) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: idx >= 0 ? ["identifiers", idx, "value"] : ["identifiers"],
            message: `${req.label} is required`,
          })
          continue
        }
        if (!req.pattern || req.scheme === "VAT") continue
        if (!value || value.trim() === "") continue
        if (value === originalIdentifierValues.get(req.scheme)) continue
        let matches = true
        try {
          matches = new RegExp(req.pattern).test(value)
        } catch {
          matches = true
        }
        if (!matches) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["identifiers", idx, "value"],
            message: t(
              "clients.upsert.validation.identifiers.patternMismatch",
              "{{label}} format is invalid",
              { label: req.label },
            ),
          })
        }
      }
    })
}

export type ClientSchema = ReturnType<typeof buildClientSchema>
export type ClientSchemaValues = z.infer<ClientSchema>
