import type { ErrorEvent } from "@sentry/react"
import { describe, expect, it } from "vitest"
import { isUntrackedBrowserPath, scrubBrowserEvent } from "./error-tracking-scrub"

function event(overrides: Partial<ErrorEvent>): ErrorEvent {
  return { type: undefined, ...overrides } as ErrorEvent
}

const TOKEN = "0123456789abcdef0123456789abcdef"

describe("scrubBrowserEvent", () => {
  it("drops the user, including an IP address or the {{auto}} marker", () => {
    expect(scrubBrowserEvent(event({ user: { ip_address: "{{auto}}" } })).user).toBeUndefined()
    expect(scrubBrowserEvent(event({ user: { id: "u1", ip_address: "203.0.113.7" } })).user).toBeUndefined()
  })

  it("keeps only the page path, without headers, query, fragment or access token", () => {
    const scrubbed = scrubBrowserEvent(
      event({
        request: {
          url: `https://app.example.test/portal/${TOKEN}/invoices?code=abc#x`,
          headers: { "User-Agent": "Firefox", Referer: "https://app.example.test/?token=abc" },
        },
      }),
    )
    expect(scrubbed.request).toEqual({ url: "https://app.example.test/portal/[redacted-secret]/invoices" })
  })

  it("drops breadcrumbs and tags, and cleans stack frame URLs", () => {
    const scrubbed = scrubBrowserEvent(
      event({
        breadcrumbs: [{ category: "ui.click", message: "button Delete client ACME" }],
        tags: { client: "ACME" },
        exception: {
          values: [
            {
              type: "Error",
              value: "x",
              stacktrace: {
                frames: [
                  { filename: `https://app.example.test/signature/${TOKEN}?v=1`, vars: { iban: "x" } },
                ],
              },
            },
          ],
        },
      }),
    )
    expect(scrubbed.breadcrumbs).toBeUndefined()
    expect(scrubbed.tags).toBeUndefined()
    const frame = scrubbed.exception?.values?.[0].stacktrace?.frames?.[0]
    expect(frame?.filename).toBe("https://app.example.test/signature/[redacted-secret]")
    expect(frame?.vars).toBeUndefined()
  })

  it("cleans the error text built from a server reply, the message and extra with the shared rules", () => {
    const scrubbed = scrubBrowserEvent(
      event({
        message: "PUT /api/clients/c1 failed for someone@example.test",
        exception: {
          values: [
            { type: "Error", value: "IBAN FR76 3000 6000 0112 3456 7890 189 is already used by 732829320" },
          ],
        },
        extra: { email: "a@b.test", note: "call +33 6 12 34 56 78 from 203.0.113.7" },
      }),
    )
    expect(scrubbed.message).toBe("PUT /api/clients/c1 failed for [redacted-email]")
    expect(scrubbed.exception?.values?.[0].value).toBe(
      "IBAN [redacted-iban] is already used by [redacted-company-id]",
    )
    expect(scrubbed.extra).toEqual({ email: "[redacted]", note: "call [redacted-phone] from [redacted-ip]" })
  })

  it("keeps only the listed contexts", () => {
    const scrubbed = scrubBrowserEvent(
      event({
        contexts: { browser: { name: "Firefox" }, client: { name: "ACME" }, culture: { locale: "fr" } },
      }),
    )
    expect(scrubbed.contexts).toEqual({ browser: { name: "Firefox" } })
  })
})

describe("isUntrackedBrowserPath", () => {
  it("covers the portal, signature, sign-in and legal pages only", () => {
    for (const path of [
      `/portal/${TOKEN}`,
      `/signature/${TOKEN}`,
      "/auth/sign-in",
      "/legal/terms",
      "/legal",
    ]) {
      expect(isUntrackedBrowserPath(path)).toBe(true)
    }
    for (const path of ["/", "/invoices", "/clients/1", "/account/preferences", "/portals"]) {
      expect(isUntrackedBrowserPath(path)).toBe(false)
    }
  })
})
