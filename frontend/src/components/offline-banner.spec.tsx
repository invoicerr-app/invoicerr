import { act, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { OfflineBanner } from "./offline-banner"

function setOnline(value: boolean) {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(value)
  act(() => {
    window.dispatchEvent(new Event(value ? "online" : "offline"))
  })
}

describe("<OfflineBanner>", () => {
  afterEach(() => vi.restoreAllMocks())

  it("says nothing while the device is online", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true)
    render(<OfflineBanner />)
    expect(screen.queryByTestId("offline-banner")).toBeNull()
    expect(document.querySelector('[data-cy="offline-banner"]')).toBeNull()
  })

  it("appears when the connection drops and goes away when it comes back", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true)
    render(<OfflineBanner />)
    setOnline(false)
    expect(document.querySelector('[data-cy="offline-banner"]')).not.toBeNull()
    setOnline(true)
    expect(document.querySelector('[data-cy="offline-banner"]')).toBeNull()
  })
})
