import * as Sentry from "@sentry/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { isErrorTrackingRunning, startErrorTracking, stopErrorTracking } from "./error-tracking"

const CONFIG = { dsn: "https://publickey@errors.example.test/2", environment: "test", release: "1.0.0" }

function stubFetch() {
  const bodies: string[] = []
  const fetchStub = vi.fn(async (_url: string, init?: RequestInit) => {
    bodies.push(String(init?.body))
    return new Response("{}", { status: 200 })
  })
  vi.stubGlobal("fetch", fetchStub)
  return { fetchStub, bodies }
}

/**
 * Runs the real SDK and reads back the envelope it hands to the network: the scrubbing has to hold on
 * the wire, not only in `scrubBrowserEvent`'s unit tests.
 */
describe("browser error tracking (real SDK)", () => {
  afterEach(async () => {
    await stopErrorTracking()
    window.history.replaceState({}, "", "/")
    vi.unstubAllGlobals()
  })

  it("does nothing until started: no client, nothing sent", async () => {
    const { fetchStub } = stubFetch()
    Sentry.captureException(new Error("boom"))
    expect(Sentry.getClient()).toBeUndefined()
    expect(isErrorTrackingRunning()).toBe(false)
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it("sends errors without any client IP, user, breadcrumb or token once started", async () => {
    const { fetchStub, bodies } = stubFetch()
    await startErrorTracking(CONFIG)
    window.history.replaceState({}, "", "/invoices/0123456789abcdef0123456789abcdef?code=0123456789abcdef")
    Sentry.setUser({ id: "user-1", ip_address: "{{auto}}", email: "someone@example.test" })
    Sentry.addBreadcrumb({ message: "clicked Delete client ACME" })
    Sentry.captureException(new Error("PUT /api/clients failed for someone@example.test"))
    await Sentry.flush(2_000)

    expect(fetchStub).toHaveBeenCalledTimes(1)
    expect(String(fetchStub.mock.calls[0][0])).toContain("errors.example.test")
    const body = bodies[0]
    expect(body).toContain('"type":"event"')
    for (const leaked of [
      "{{auto}}",
      "ip_address",
      "someone@example.test",
      "user-1",
      "0123456789abcdef",
      "ACME",
      "breadcrumbs",
    ]) {
      expect(body).not.toContain(leaked)
    }
  })

  it("never reports from a portal, signature, sign-in or legal page", async () => {
    const { fetchStub } = stubFetch()
    await startErrorTracking(CONFIG)
    window.history.replaceState({}, "", "/legal/terms")
    Sentry.captureException(new Error("boom"))
    await Sentry.flush(1_000)
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it("stops at once on withdrawal: nothing is sent afterwards", async () => {
    const { fetchStub } = stubFetch()
    await startErrorTracking(CONFIG)
    expect(isErrorTrackingRunning()).toBe(true)
    await stopErrorTracking()
    expect(isErrorTrackingRunning()).toBe(false)
    Sentry.captureException(new Error("after withdrawal"))
    await Sentry.flush(1_000)
    expect(fetchStub).not.toHaveBeenCalled()
  })
})
