/**
 * Maps parsed CSV rows (`csv-parse.ts`'s `ParsedCsv`) onto the client schema, and validates each row
 * with the SAME `buildClientSchema` the create wizard uses - see `client-schema.ts`'s own header.
 * This is the "browser decodes and validates" half of the split described in the import's own design
 * doc (`client-import.service.ts`'s header, backend side); the wire shape sent to
 * `POST /clients/import/preview|import` mirrors `backend/.../import/client-import.types.ts#ClientImportRow`
 * exactly (kept in sync by hand - a TS type, not a generated one, matching how `Client`/`EditClientsDto`
 * already aren't shared across the two independent npm projects in this repo).
 */
import { buildClientSchema, type ClientSchemaIdentifierRequirement } from "@/lib/client-schema"
import { authenticatedFetch } from "@/hooks/use-fetch"
import { currencies } from "@/lib/constants/currencies"
import type { TFunction } from "i18next"

/** The same closed set `CurrencySelect` offers - checked here so an unrecognised `currency` cell is a
 *  REJECTED row (naming the value) rather than a value silently forwarded to the server to fail on
 *  later with a less specific message. */
const VALID_CURRENCIES = new Set(Object.keys(currencies))

/** The fixed (non-identifier) columns this import understands - mirrors
 *  `backend/.../import/client-import-template.ts#CLIENT_IMPORT_TEMPLATE_HEADERS` minus the
 *  `identifier:*` ones, which are matched by prefix instead (see `mapRow` below). */
const KNOWN_COLUMNS = [
  "type",
  "kind",
  "isSupplier",
  "name",
  "contactFirstname",
  "contactLastname",
  "contactEmail",
  "contactPhone",
  "address",
  "addressLine2",
  "postalCode",
  "city",
  "state",
  "country",
  "countryCode",
  "currency",
  "language",
  "description",
  "foundedAt",
] as const

export interface ClientImportRowWire {
  rowNumber: number
  type?: "COMPANY" | "INDIVIDUAL"
  kind?: "BUSINESS" | "GOVERNMENT"
  isSupplier?: boolean
  name?: string
  contactFirstname?: string
  contactLastname?: string
  contactEmail?: string
  contactPhone?: string
  address?: string
  addressLine2?: string
  postalCode?: string
  city?: string
  state?: string
  country?: string
  countryCode?: string
  currency?: string
  language?: string | null
  description?: string
  foundedAt?: string
  identifiers?: { scheme: string; value: string }[]
}

export interface ValidatedClientRow {
  rowNumber: number
  wire: ClientImportRowWire
  /** `undefined` when the row passed local validation (shape coercion below, plus zod) - only a
   *  locally-rejected row carries its own errors; a row that passes local validation is still
   *  subject to the SERVER's own preview/confirm checks (identifier pattern, name/type, custom
   *  fields, duplicates, country resolution), which this function never runs. */
  localErrors?: string[]
}

/** Explicit true/false spellings this import accepts for `isSupplier` - an EMPTY cell defaults to
 *  `false` (the wizard's own default), but any OTHER value not in one of these two closed lists is a
 *  REJECTED row (see `mapRow`'s own header): silently guessing "truthy" for an unrecognised word would
 *  hide a typo behind a wrong answer instead of surfacing it. */
const TRUE_SPELLINGS = new Set(["true", "1", "yes", "vrai", "oui"])
const FALSE_SPELLINGS = new Set(["false", "0", "no", "non", "faux"])

/** The ONLY date shape this import accepts - stated in the template (`identifier`/`foundedAt`
 *  columns' own header comment, backend `client-import-template.ts`). `new Date("01/02/2020")`
 *  guesses an MM/DD-vs-DD/MM order depending on the JS engine's own locale rules; a CSV import must
 *  never silently reinterpret what a user typed (the exact failure this replaces - a French
 *  `25/09/2020` used to either throw away the date or, worse, misread it as some other day). */
const FOUNDED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** One row (headers + one data row's cells) mapped onto the wire shape, PLUS every closed-set column
 *  value checked against what it may actually contain. An EMPTY cell always takes the same default
 *  the wizard itself uses (COMPANY / BUSINESS / not a supplier / no founding date); any OTHER value
 *  the wizard's own pickers could never produce (a typo'd type, an unparseable date, a non-boolean
 *  supplier flag) is never silently coerced to that default - it is returned in `shapeErrors`, naming
 *  the column and the value, so `validateRow` can reject the row instead of guessing what the user
 *  meant. Any column NOT in `KNOWN_COLUMNS` and not prefixed `identifier:` is ignored (a stray extra
 *  column, or a typo'd HEADER, is not fatal - the columns that DO match still import); this is
 *  deliberately different from an unrecognised VALUE in a column this import DOES understand. */
export function mapRow(
  headers: string[],
  cells: string[],
  rowNumber: number,
): { wire: ClientImportRowWire; shapeErrors: string[] } {
  const byHeader = new Map<string, string>()
  headers.forEach((h, i) => {
    byHeader.set(h, cells[i] ?? "")
  })

  const get = (name: string) => byHeader.get(name)?.trim() || undefined

  const identifiers: { scheme: string; value: string }[] = []
  for (const [header, raw] of byHeader) {
    if (!header.startsWith("identifier:")) continue
    const value = raw.trim()
    if (!value) continue
    identifiers.push({ scheme: header.slice("identifier:".length).trim().toUpperCase(), value })
  }

  const shapeErrors: string[] = []

  const rawType = get("type")
  let type: "COMPANY" | "INDIVIDUAL" | undefined
  if (!rawType) {
    type = "COMPANY"
  } else if (rawType.toUpperCase() === "COMPANY") {
    type = "COMPANY"
  } else if (rawType.toUpperCase() === "INDIVIDUAL") {
    type = "INDIVIDUAL"
  } else {
    shapeErrors.push(`Unknown type: "${rawType}" (column "type", expected COMPANY or INDIVIDUAL).`)
  }

  const rawKind = get("kind")
  let kind: "BUSINESS" | "GOVERNMENT" | undefined
  if (!rawKind) {
    kind = "BUSINESS"
  } else if (rawKind.toUpperCase() === "BUSINESS") {
    kind = "BUSINESS"
  } else if (rawKind.toUpperCase() === "GOVERNMENT") {
    kind = "GOVERNMENT"
  } else {
    shapeErrors.push(`Unknown kind: "${rawKind}" (column "kind", expected BUSINESS or GOVERNMENT).`)
  }

  const rawSupplier = get("isSupplier")
  let isSupplier = false
  if (rawSupplier) {
    const lowered = rawSupplier.toLowerCase()
    if (TRUE_SPELLINGS.has(lowered)) {
      isSupplier = true
    } else if (FALSE_SPELLINGS.has(lowered)) {
      isSupplier = false
    } else {
      shapeErrors.push(`Unknown value: "${rawSupplier}" (column "isSupplier", expected true or false).`)
    }
  }

  const rawCurrency = get("currency")
  if (rawCurrency && !VALID_CURRENCIES.has(rawCurrency.toUpperCase())) {
    shapeErrors.push(`Unknown currency: "${rawCurrency}" (column "currency", expected an ISO 4217 code).`)
  }

  const rawFoundedAt = get("foundedAt")
  let foundedAt: string | undefined
  if (rawFoundedAt) {
    const validDate = FOUNDED_AT_PATTERN.test(rawFoundedAt) && !Number.isNaN(new Date(rawFoundedAt).getTime())
    if (validDate) {
      foundedAt = rawFoundedAt
    } else {
      shapeErrors.push(`Invalid date: "${rawFoundedAt}" (column "foundedAt", expected YYYY-MM-DD).`)
    }
  }

  return {
    wire: {
      rowNumber,
      type,
      kind,
      isSupplier,
      name: get("name"),
      contactFirstname: get("contactFirstname"),
      contactLastname: get("contactLastname"),
      contactEmail: get("contactEmail"),
      contactPhone: get("contactPhone"),
      address: get("address"),
      addressLine2: get("addressLine2"),
      postalCode: get("postalCode"),
      city: get("city"),
      state: get("state"),
      country: get("country"),
      countryCode: get("countryCode")?.toUpperCase(),
      currency: get("currency")?.toUpperCase(),
      language: get("language") ?? null,
      description: get("description"),
      foundedAt,
      identifiers: identifiers.length > 0 ? identifiers : undefined,
    },
    shapeErrors,
  }
}

/** The catalog endpoint the create wizard's own `useRequiredIdentifiers` hook calls - fetched here
 *  as a plain function (no React render cycle available while validating a whole file at once) so
 *  the import's per-row check asks the SAME source of truth, per row's own country. Cached by the
 *  caller (`(countryCode, partyType)` pair) - see the import dialog, which asks at most once per
 *  distinct pair in the file, not once per row.
 *
 *  THROWS on a non-OK response rather than returning `[]` - this is only ever a BEST-EFFORT input to
 *  the browser's own local zod pass (the actual authority on which identifiers are required is the
 *  server's `POST /clients/import/preview`, which resolves the catalog itself, independently, for
 *  every row it evaluates - see `client-import.service.ts`'s own header). Returning `[]` on a network
 *  failure would let a row with a missing required identifier sail through the LOCAL check silently;
 *  throwing surfaces the failure to the caller (the import dialog shows an error and stops) instead of
 *  quietly proceeding on data this function could not actually fetch. */
export async function fetchRequiredIdentifiers(
  countryCode: string,
  partyType: "COMPANY" | "INDIVIDUAL",
): Promise<ClientSchemaIdentifierRequirement[]> {
  const res = await authenticatedFetch(
    `/api/documents/required-identifiers?countryCode=${encodeURIComponent(countryCode)}&partyType=${partyType}`,
  )
  if (!res.ok) {
    throw new Error(`Could not fetch the required-identifiers catalog for "${countryCode}" (${partyType}).`)
  }
  const decision = (await res.json()) as { requirements: ClientSchemaIdentifierRequirement[] }
  return decision.requirements ?? []
}

/** Validates one already-mapped row: `shapeErrors` from `mapRow` (a value the wizard's own pickers
 *  could never produce) come first, then the shared zod schema - mirrors exactly what the wizard's
 *  `form.trigger()` would reject for the same field values; a row rejected here would have been
 *  rejected by the wizard too. Country resolution and the country-identifiers catalog's own verdict
 *  are NOT checked here (no Prisma reachable from the browser) - a row that passes this still goes
 *  through the server's `preview`, which is the actual authority on both (see this file's own header
 *  on `fetchRequiredIdentifiers`). */
export function validateRow(
  t: TFunction,
  wire: ClientImportRowWire,
  shapeErrors: string[],
  requiredIdentifiers: ClientSchemaIdentifierRequirement[],
): ValidatedClientRow {
  if (shapeErrors.length > 0) {
    return { rowNumber: wire.rowNumber, wire, localErrors: shapeErrors }
  }
  const schema = buildClientSchema(t, requiredIdentifiers, new Map())
  const candidate = {
    ...wire,
    foundedAt: wire.foundedAt ? new Date(wire.foundedAt) : undefined,
    identifiers: wire.identifiers ?? [],
  }
  const result = schema.safeParse(candidate)
  if (result.success) {
    return { rowNumber: wire.rowNumber, wire }
  }
  const errors = result.error.issues.map((issue) => issue.message)
  return { rowNumber: wire.rowNumber, wire, localErrors: errors }
}

export { KNOWN_COLUMNS }
