import { useEffect, useRef } from "react"
import i18n from "i18next"

import { LANGUAGE_STORAGE_KEY, SUPPORTED_LANGUAGES } from "@/lib/i18n"

/**
 * Language just became an ACCOUNT preference (`User.locale`), not only a browser one — the whole
 * point being that a returning user sees their own language on a device that never stored anything
 * for them (a fresh browser, cleared site data), instead of falling back to `navigator`'s guess. This
 * is the one place that promotion actually happens: given the account's own locale (`session.user.locale`,
 * read by each caller), apply it to the live i18next instance whenever it disagrees with what's
 * currently showing.
 *
 * Deliberately idempotent and safe to call from more than one mounted component at once (the
 * authenticated app shell AND the Preferences screen both do) — it tracks the last value it applied
 * so a re-render with the same `accountLocale` is a no-op, and it never fights a change the user just
 * made locally: if `i18n.resolvedLanguage` already matches, there is nothing to do.
 */
export function useApplyAccountLocale(accountLocale: string | null | undefined): void {
  const lastApplied = useRef<string | null>(null)

  useEffect(() => {
    if (!accountLocale) return
    if (accountLocale === lastApplied.current) return
    // Not one of the languages this UI actually offers (a stale/garbage stored value, or a language
    // dropped from the picker since) — never pass it to `changeLanguage`, which would otherwise fall
    // back to English anyway but leave `localStorage` holding a value the picker can't represent.
    if (!SUPPORTED_LANGUAGES.some((language) => language.code === accountLocale)) return

    lastApplied.current = accountLocale
    if (accountLocale === i18n.resolvedLanguage) return

    localStorage.setItem(LANGUAGE_STORAGE_KEY, accountLocale)
    i18n.changeLanguage(accountLocale)
  }, [accountLocale])
}
