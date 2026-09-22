import { describe, expect, it } from "vitest"

import { isDismissalActive, isIosUserAgent, isStandaloneDisplay } from "./pwa-install-prompt"

const IOS_SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
const ANDROID_CHROME_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
const DESKTOP_CHROME_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

describe("isIosUserAgent", () => {
  it.each(["iPhone", "iPad", "iPod"])("matches a %s user agent", (device) => {
    expect(isIosUserAgent(`Mozilla/5.0 (${device}; CPU OS 17_5 like Mac OS X)`)).toBe(true)
  })

  it("matches real iOS Safari UA", () => {
    expect(isIosUserAgent(IOS_SAFARI_UA)).toBe(true)
  })

  it("does not match Android Chrome", () => {
    expect(isIosUserAgent(ANDROID_CHROME_UA)).toBe(false)
  })

  it("does not match desktop Chrome", () => {
    expect(isIosUserAgent(DESKTOP_CHROME_UA)).toBe(false)
  })
})

describe("isStandaloneDisplay", () => {
  it("is standalone when the display-mode media query matches", () => {
    expect(isStandaloneDisplay(true, undefined)).toBe(true)
  })

  it("is standalone when navigator.standalone is true (iOS, already added to Home Screen)", () => {
    expect(isStandaloneDisplay(false, true)).toBe(true)
  })

  it("is not standalone when neither signal is set", () => {
    expect(isStandaloneDisplay(false, undefined)).toBe(false)
  })

  it("is not standalone when navigator.standalone is explicitly false", () => {
    expect(isStandaloneDisplay(false, false)).toBe(false)
  })
})

describe("isDismissalActive", () => {
  const now = Date.parse("2026-09-15T00:00:00.000Z")
  const oneDayMs = 24 * 60 * 60 * 1000

  it("is false when nothing was ever dismissed", () => {
    expect(isDismissalActive(null, now)).toBe(false)
  })

  it("is false for a garbage stored value", () => {
    expect(isDismissalActive("not-a-timestamp", now)).toBe(false)
  })

  it("is true right after dismissing", () => {
    expect(isDismissalActive(String(now), now)).toBe(true)
  })

  it("is true just under the snooze window (29 days)", () => {
    expect(isDismissalActive(String(now - 29 * oneDayMs), now)).toBe(true)
  })

  it("is false once the snooze window (30 days) has elapsed", () => {
    expect(isDismissalActive(String(now - 30 * oneDayMs), now)).toBe(false)
  })

  it("honors a custom snooze window", () => {
    expect(isDismissalActive(String(now - 2 * oneDayMs), now, 1)).toBe(false)
  })
})
