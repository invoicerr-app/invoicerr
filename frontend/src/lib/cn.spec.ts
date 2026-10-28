import { describe, expect, it } from "vitest"

import { cn } from "./utils"

describe("cn", () => {
  it("lets a named theme shadow be replaced by any other shadow", () => {
    expect(cn("shadow-sheet", "shadow-[0_1px_0_red]")).toBe("shadow-[0_1px_0_red]")
    expect(cn("shadow-xs", "shadow-inset")).toBe("shadow-inset")
    expect(cn("shadow-sheet", "shadow-none")).toBe("shadow-none")
  })

  it("lets a named theme radius be replaced", () => {
    expect(cn("rounded-panel", "rounded-none")).toBe("rounded-none")
  })
})
