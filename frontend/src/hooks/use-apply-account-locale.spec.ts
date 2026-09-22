import { renderHook, waitFor } from "@testing-library/react"
import i18n from "i18next"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { LANGUAGE_STORAGE_KEY } from "@/lib/i18n"
import { useApplyAccountLocale } from "./use-apply-account-locale"

describe("useApplyAccountLocale", () => {
  beforeEach(async () => {
    localStorage.clear()
    await i18n.changeLanguage("en")
  })

  afterEach(async () => {
    localStorage.clear()
    await i18n.changeLanguage("en")
  })

  it("applies the account's locale when it differs from the current one", async () => {
    const { rerender } = renderHook(({ locale }) => useApplyAccountLocale(locale), {
      initialProps: { locale: undefined as string | undefined },
    })

    rerender({ locale: "fr" })
    // `i18n.changeLanguage` resolves asynchronously even for an already-loaded bundle.
    await waitFor(() => expect(i18n.resolvedLanguage).toBe("fr"))
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("fr")
  })

  it("does nothing when there is no account locale yet", () => {
    renderHook(({ locale }) => useApplyAccountLocale(locale), {
      initialProps: { locale: null as string | null },
    })

    expect(i18n.resolvedLanguage).toBe("en")
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull()
  })

  it("ignores a language this UI doesn't actually offer, rather than handing it to changeLanguage", async () => {
    renderHook(({ locale }) => useApplyAccountLocale(locale), {
      initialProps: { locale: "xx-not-a-real-language" },
    })

    // Give any (unwanted) async change a chance to land before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(i18n.resolvedLanguage).toBe("en")
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull()
  })

  it("is a no-op once it already matches the live language — never loops or re-writes storage", async () => {
    await i18n.changeLanguage("fr")
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "fr")

    renderHook(({ locale }) => useApplyAccountLocale(locale), {
      initialProps: { locale: "fr" },
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(i18n.resolvedLanguage).toBe("fr")
  })

  it("does not re-apply the same account locale on every re-render (idempotent)", async () => {
    const { rerender } = renderHook(({ locale }) => useApplyAccountLocale(locale), {
      initialProps: { locale: "fr" },
    })
    await waitFor(() => expect(i18n.resolvedLanguage).toBe("fr"))

    // The user (or another effect) switches back to English locally — a re-render with the SAME
    // account locale must not fight that back.
    await i18n.changeLanguage("en")
    rerender({ locale: "fr" })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(i18n.resolvedLanguage).toBe("en")
  })
})
