import { z } from "zod"

// Built-in messages in the wording the forms have always shown, for a field that sets none itself.

const receivedType = (input: unknown): string => {
  if (input === null) return "null"
  if (Array.isArray(input)) return "array"
  if (input instanceof Date) return "date"
  if (typeof input === "number") return Number.isNaN(input) ? "nan" : "number"
  return typeof input
}

const lowerBound = (exact: boolean | undefined, inclusive: boolean | undefined, over: string) =>
  exact ? "exactly" : inclusive ? "at least" : over

const upperBound = (exact: boolean | undefined, inclusive: boolean | undefined, under: string) =>
  exact ? "exactly" : inclusive ? "at most" : under

export const builtInMessage: z.core.$ZodErrorMap = (issue) => {
  switch (issue.code) {
    case "invalid_type":
      if (issue.input === undefined) return "Required"
      if (issue.expected === "int") return "Expected integer, received float"
      if (issue.expected === "date" && issue.input instanceof Date) return "Invalid date"
      return `Expected ${issue.expected}, received ${receivedType(issue.input)}`
    case "invalid_value":
      if (issue.input === undefined) return "Required"
      if (issue.inst && "type" in issue.inst._zod.def && issue.inst._zod.def.type === "literal")
        return `Invalid literal value, expected ${JSON.stringify(issue.values[0])}`
      return `Invalid enum value. Expected ${issue.values.map((v) => `'${String(v)}'`).join(" | ")}, received '${String(issue.input)}'`
    case "too_small": {
      const { exact, inclusive, minimum } = issue
      if (issue.origin === "string")
        return `String must contain ${lowerBound(exact, inclusive, "over")} ${minimum} character(s)`
      if (issue.origin === "array")
        return `Array must contain ${lowerBound(exact, inclusive, "more than")} ${minimum} element(s)`
      if (issue.origin === "number")
        return `Number must be ${exact ? "exactly equal to" : inclusive ? "greater than or equal to" : "greater than"} ${minimum}`
      return undefined
    }
    case "too_big": {
      const { exact, inclusive, maximum } = issue
      if (issue.origin === "string")
        return `String must contain ${upperBound(exact, inclusive, "under")} ${maximum} character(s)`
      if (issue.origin === "array")
        return `Array must contain ${upperBound(exact, inclusive, "less than")} ${maximum} element(s)`
      if (issue.origin === "number")
        return `Number must be ${exact ? "exactly equal to" : inclusive ? "less than or equal to" : "less than"} ${maximum}`
      return undefined
    }
    case "invalid_format":
      if (issue.format === "regex") return "Invalid"
      return `Invalid ${issue.format}`
    default:
      return undefined
  }
}

/** Messages for a missing value and for a value of the wrong type. A case left out keeps the
 *  built-in message. */
export const typeErrors =
  (messages: { required?: string; invalid?: string }): z.core.$ZodErrorMap =>
  (issue) => {
    if (issue.code !== "invalid_type") return undefined
    return issue.input === undefined ? messages.required : messages.invalid
  }

z.config({ customError: builtInMessage })
