import type { ErrorEvent } from "@sentry/react"
import { describe, expect, it } from "vitest"
import { scrubBrowserEvent, stripQuery } from "./error-tracking-scrub"

function event(overrides: Partial<ErrorEvent>): ErrorEvent {
  return { type: undefined, ...overrides } as ErrorEvent
}

describe("scrubBrowserEvent", () => {
  it("drops the user, including an IP address or the {{auto}} marker", () => {
    expect(scrubBrowserEvent(event({ user: { ip_address: "{{auto}}" } })).user).toBeUndefined()
    expect(scrubBrowserEvent(event({ user: { id: "u1", ip_address: "203.0.113.7" } })).user).toBeUndefined()
  })

  it("keeps only the page path, without headers, query or fragment", () => {
    const scrubbed = scrubBrowserEvent(
      event({
        request: {
          url: "https://app.example.test/auth/invite?code=0123456789abcdef#x",
          headers: { "User-Agent": "Firefox", Referer: "https://app.example.test/?token=abc" },
        },
      }),
    )
    expect(scrubbed.request).toEqual({ url: "https://app.example.test/auth/invite" })
  })

  it("drops breadcrumbs and strips query strings from stack frames", () => {
    const scrubbed = scrubBrowserEvent(
      event({
        breadcrumbs: [{ category: "ui.click", message: "button Delete client ACME" }],
        exception: {
          values: [
            {
              type: "TypeError",
              stacktrace: {
                frames: [{ filename: "https://app.example.test/assets/a.js?v=1", abs_path: "x#y" }],
              },
            },
          ],
        },
      }),
    )
    expect(scrubbed.breadcrumbs).toBeUndefined()
    expect(scrubbed.exception?.values?.[0].stacktrace?.frames?.[0]).toEqual({
      filename: "https://app.example.test/assets/a.js",
      abs_path: "x",
    })
  })
})

describe("stripQuery", () => {
  it("cuts at the first ? or #", () => {
    expect(stripQuery("/p?q=1")).toBe("/p")
    expect(stripQuery("/p")).toBe("/p")
    expect(stripQuery(undefined)).toBeUndefined()
  })
})
