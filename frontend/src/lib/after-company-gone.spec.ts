import { afterEach, describe, expect, it } from "vitest"

import { afterCompanyGone } from "./after-company-gone"

describe("afterCompanyGone", () => {
  const originalLocation = window.location

  afterEach(() => {
    Object.defineProperty(window, "location", { value: originalLocation, writable: true })
  })

  it("hard-navigates to /dashboard rather than relying on the SPA router", () => {
    // A real assignment (not a spy on `navigate`/`assign`) is the exact regression this proves: a
    // plain client-side route change would leave every company-scoped query cache pointed at the
    // company that just vanished (see this module's own header).
    const location = { href: "" } as unknown as Location
    Object.defineProperty(window, "location", { value: location, writable: true })

    afterCompanyGone()

    expect(location.href).toBe("/dashboard")
  })
})
