import { afterEach, describe, expect, it, vi } from "vitest"

import { copyToClipboard } from "@/lib/clipboard"

describe("copyToClipboard", () => {
  const originalClipboard = navigator.clipboard
  const originalExecCommand = document.execCommand

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: originalClipboard, configurable: true })
    document.execCommand = originalExecCommand
  })

  it("falls back to execCommand when navigator.clipboard is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true })
    const execCommand = vi.fn().mockReturnValue(true)
    document.execCommand = execCommand

    const result = await copyToClipboard("hello")

    expect(result).toBe(true)
    expect(execCommand).toHaveBeenCalledWith("copy")
  })

  it("returns false when the async clipboard API rejects and the execCommand fallback also fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    })
    document.execCommand = vi.fn().mockReturnValue(false)

    const result = await copyToClipboard("hello")

    expect(result).toBe(false)
  })

  it("succeeds via the real clipboard API without touching the DOM fallback", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    const execCommand = vi.fn()
    document.execCommand = execCommand

    const result = await copyToClipboard("hello")

    expect(result).toBe(true)
    expect(writeText).toHaveBeenCalledWith("hello")
    expect(execCommand).not.toHaveBeenCalled()
  })
})
