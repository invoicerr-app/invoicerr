import { describe, expect, it } from "vitest"

import { statusPresentation } from "./status-presentation"

describe("statusPresentation", () => {
  it.each([
    ["draft", "neutral", "open"],
    ["sent", "info", "half"],
    ["imported", "info", "half"],
    ["sending", "warning", "half"],
    ["pending_approval", "warning", "half"],
    ["overdue", "destructive", "triangle"],
    ["paid", "success", "disc"],
    ["settled", "success", "disc"],
    ["partially_paid", "success", "half"],
    ["accepted", "success", "check"],
    ["signed", "success", "check"],
    ["approved", "success", "check"],
    ["rejected", "destructive", "circled-cross"],
    ["refused", "destructive", "circled-cross"],
    ["send_failed", "destructive", "circled-cross"],
    ["unpaid", "neutral", "open"],
  ])("%s reads as %s with the %s glyph", (status, tone, glyph) => {
    expect(statusPresentation(status)).toEqual({ tone, glyph, struck: false })
  })

  it("strikes a withdrawn document through, in the muted tone", () => {
    expect(statusPresentation("cancelled")).toEqual({ tone: "neutral", glyph: "cross", struck: true })
    expect(statusPresentation("void")).toEqual({ tone: "neutral", glyph: "cross", struck: true })
  })

  it("never hides a status it does not know: neutral, open circle", () => {
    expect(statusPresentation("on_hold_by_plugin")).toEqual({ tone: "neutral", glyph: "open", struck: false })
  })
})
