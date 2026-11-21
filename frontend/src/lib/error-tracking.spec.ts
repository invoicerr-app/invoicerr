import * as Sentry from "@sentry/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { initErrorTracking } from "./error-tracking"

type ConfigWindow = Window & { __APP_CONFIG__?: Record<string, string | undefined> }

/**
 * Runs the real SDK and reads back the envelope it hands to the network: the scrubbing has to hold on
 * the wire, not only in `scrubBrowserEvent`'s unit tests.
 */
describe("initErrorTracking (real SDK)", () => {
  afterEach(async () => {
    await Sentry.close(1_000)
    delete (window as ConfigWindow).__APP_CONFIG__
    vi.unstubAllGlobals()
  })

  it("stays off without a DSN", async () => {
    ;(window as ConfigWindow).__APP_CONFIG__ = {}
    await initErrorTracking()
    expect(Sentry.getClient()).toBeUndefined()
  })

  it("sends errors without any client IP, user or query string", async () => {
    const bodies: string[] = []
    const fetchStub = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body))
      return new Response("{}", { status: 200 })
    })
    vi.stubGlobal("fetch", fetchStub)
    ;(window as ConfigWindow).__APP_CONFIG__ = { VITE_SENTRY_DSN: "https://publickey@errors.example.test/2" }

    await initErrorTracking()
    window.history.replaceState({}, "", "/auth/invite?code=0123456789abcdef")
    Sentry.setUser({ id: "user-1", ip_address: "{{auto}}", email: "someone@example.test" })
    Sentry.addBreadcrumb({ message: "clicked Delete client ACME" })
    Sentry.captureException(new Error("boom"))
    await Sentry.flush(2_000)

    expect(fetchStub).toHaveBeenCalledTimes(1)
    expect(String(fetchStub.mock.calls[0][0])).toContain("errors.example.test")
    const body = bodies[0]
    expect(body).toContain('"type":"event"')
    expect(body).toContain("/auth/invite")
    for (const leaked of [
      "{{auto}}",
      "ip_address",
      "someone@example.test",
      "user-1",
      "0123456789abcdef",
      "ACME",
    ]) {
      expect(body).not.toContain(leaked)
    }
  })
})
