import { describe, expect, it } from "vitest"

import { ApiError } from "@/hooks/use-api-query"
import { isNotFoundError } from "./document-load-state"

describe("isNotFoundError", () => {
  it("is true only when the server answered that the thing does not exist", () => {
    expect(isNotFoundError(new ApiError(404, "Not found"))).toBe(true)
    expect(isNotFoundError(new ApiError(400, "Unknown type"))).toBe(true)
  })

  it("is false for a request that never got an answer or a server failure", () => {
    expect(isNotFoundError(new TypeError("Failed to fetch"))).toBe(false)
    expect(isNotFoundError(new ApiError(500, "Internal server error"))).toBe(false)
    expect(isNotFoundError(new ApiError(503, "Unavailable"))).toBe(false)
  })
})
