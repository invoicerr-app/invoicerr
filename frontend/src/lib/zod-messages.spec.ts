import { describe, expect, it } from "vitest"
import { z } from "zod"

import { typeErrors } from "./zod-messages"

const firstMessage = (schema: z.ZodType, input: unknown) => {
  const result = schema.safeParse(input)
  return result.success ? undefined : result.error.issues[0]?.message
}

describe("built-in zod messages", () => {
  it.each<[string, z.ZodType, unknown, string]>([
    ["missing string", z.string(), undefined, "Required"],
    ["null string", z.string(), null, "Expected string, received null"],
    ["number as string", z.string(), 5, "Expected string, received number"],
    ["missing number", z.number(), undefined, "Required"],
    ["NaN number", z.number(), Number.NaN, "Expected number, received nan"],
    ["text as number", z.number(), "x", "Expected number, received string"],
    ["coerced text", z.coerce.number(), "abc", "Expected number, received nan"],
    ["float as int", z.number().int(), 1.5, "Expected integer, received float"],
    ["number below min", z.number().min(0), -1, "Number must be greater than or equal to 0"],
    ["number above max", z.number().max(10), 11, "Number must be less than or equal to 10"],
    ["number not above gt", z.number().gt(0), 0, "Number must be greater than 0"],
    ["number not below lt", z.number().lt(5), 5, "Number must be less than 5"],
    ["short string", z.string().min(3), "ab", "String must contain at least 3 character(s)"],
    ["long string", z.string().max(2), "abc", "String must contain at most 2 character(s)"],
    ["exact length", z.string().length(0), "a", "String must contain exactly 0 character(s)"],
    ["short array", z.array(z.string()).min(1), [], "Array must contain at least 1 element(s)"],
    ["long array", z.array(z.string()).max(1), ["a", "b"], "Array must contain at most 1 element(s)"],
    ["bad email", z.email(), "foo", "Invalid email"],
    ["regex mismatch", z.string().regex(/^a$/), "b", "Invalid"],
    ["missing date", z.date(), undefined, "Required"],
    ["invalid date", z.date(), new Date("x"), "Invalid date"],
    ["string as date", z.date(), "2020-01-01", "Expected date, received string"],
    ["string as boolean", z.boolean(), "x", "Expected boolean, received string"],
    ["missing object", z.object({ a: z.string() }), undefined, "Required"],
    ["missing key", z.object({ a: z.string() }), {}, "Required"],
    ["array as string", z.array(z.string()), "x", "Expected array, received string"],
    ["unknown option", z.enum(["A", "B"]), "C", "Invalid enum value. Expected 'A' | 'B', received 'C'"],
    ["missing option", z.enum(["A", "B"]), undefined, "Required"],
    ["other literal", z.literal(""), "x", 'Invalid literal value, expected ""'],
    ["failed refine", z.string().refine(() => false), "x", "Invalid input"],
  ])("%s", (_label, schema, input, expected) => {
    expect(firstMessage(schema, input)).toBe(expected)
  })

  it("keeps the built-in message for a case typeErrors leaves out", () => {
    const invalidOnly = z.number({ error: typeErrors({ invalid: "Not a number" }) })
    expect(firstMessage(invalidOnly, undefined)).toBe("Required")
    expect(firstMessage(invalidOnly, Number.NaN)).toBe("Not a number")

    const requiredOnly = z.string({ error: typeErrors({ required: "Name is required" }) })
    expect(firstMessage(requiredOnly, undefined)).toBe("Name is required")
    expect(firstMessage(requiredOnly, 5)).toBe("Expected string, received number")
  })

  it("reads a coerced value as invalid, never as missing", () => {
    const schema = z.coerce.number({ error: typeErrors({ required: "Missing", invalid: "Not a number" }) })
    expect(firstMessage(schema, undefined)).toBe("Not a number")
    expect(firstMessage(schema, "abc")).toBe("Not a number")
  })

  it("never replaces a message the schema sets itself", () => {
    expect(firstMessage(z.number({ error: "Price is required" }), Number.NaN)).toBe("Price is required")
    expect(firstMessage(z.string().min(1, "Empty"), "")).toBe("Empty")
  })
})
