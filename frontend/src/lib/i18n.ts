import {
  ar,
  arDZ,
  arEG,
  arMA,
  arSA,
  arTN,
  cs,
  da,
  de,
  deAT,
  enAU,
  enCA,
  enGB,
  enIE,
  enIN,
  enNZ,
  enUS,
  enZA,
  es,
  fr,
  frCA,
  frCH,
  he,
  it,
  itCH,
  ja,
  ko,
  nl,
  nlBE,
  pl,
  ptBR,
  ru,
  sv,
  uk,
} from "date-fns/locale"

import LanguageDetector from "i18next-browser-languagedetector"
import type { Locale } from "date-fns"
import i18n from "i18next"
import { initReactI18next } from "react-i18next"

const translations = import.meta.glob("../locales/**/*.json", {
  eager: true,
})

const resources: Record<string, { translation: any }> = {}

for (const path in translations) {
  const match = path.match(/\.\/locales\/([^/]+)\/translation\.json$/)
  if (!match) continue
  const lang = match[1]
  resources[lang] = {
    translation: (translations[path] as any).default,
  }
}

/**
 * Languages exposed to users (language picker + navigator detection).
 *
 * Locales whose catalog is still a ~50-key bootstrap stub (da, he, ja, ko,
 * pt-BR, ru, sv, uk, zh-Hans) are intentionally NOT listed: their files are
 * kept for future work, but users falling in those locales get English
 * instead of a 96%-English "translation". `beta` marks partially or
 * machine-translated catalogs.
 */
export interface SupportedLanguage {
  code: string
  /** Native display name. */
  label: string
  /** Incomplete or machine-translated catalog — shown with a "(beta)" hint. */
  beta?: boolean
}

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "it", label: "Italiano", beta: true },
  { code: "pl", label: "Polski", beta: true },
  { code: "ar", label: "العربية", beta: true },
  { code: "cs", label: "Čeština", beta: true },
  { code: "de", label: "Deutsch", beta: true },
  { code: "es", label: "Español", beta: true },
  { code: "nl", label: "Nederlands", beta: true },
]

export const LANGUAGE_STORAGE_KEY = "i18nextLng"

/**
 * Issue #559 - the right-to-left locales this app actually recognizes. Deliberately an explicit
 * list, never i18next's own `i18n.dir()`: that helper guesses from a broad, script-based table
 * (it also flags e.g. `ug`/Uyghur, `dv`/Divehi and a dozen Arabic macrolanguage variants this app
 * has no catalog for) rather than from a locale this app actually ships. No Arabic translation is
 * complete yet (`ar` is still `beta` in `SUPPORTED_LANGUAGES` above), but the mechanism is in place
 * for when Hebrew, Persian or Urdu catalogs arrive too - none of them need a code change here.
 */
export const RTL_LOCALES = ["ar", "he", "fa", "ur"]

// Dev-only hook so the e2e suite can exercise the RTL layout before a real RTL translation is
// complete (no Arabic catalog exists yet - see RTL_LOCALES's own comment). `import.meta.env.DEV` is
// statically `false` in a production build (`vite build`), so every branch below folds away and
// this locale code and the English catalog it re-registers under never reach a shipped bundle - it
// only exists under `vite`/`start:test`, which is what both local dev and the e2e stack run.
// Content is the SAME in-memory English resource bundle already loaded above, not a second file on
// disk, so it can never drift from the real `en` catalog.
//
// No hyphen in the code on purpose: `load: "languageOnly"` below makes i18next split on "-"/"_" and
// resolve against the part BEFORE it, the same normalization a real "ar-SA" gets reduced to "ar" -
// "rtl-test" was silently reduced to "rtl", which is not itself a key of `resources`/`supportedLngs`,
// and every lookup fell back to "en" (caught live: `document.documentElement.dir` stayed "ltr" after
// switching to it). A single token has nothing to split.
const DEV_RTL_TEST_LOCALE: string | null = import.meta.env.DEV ? "rtltest" : null

if (DEV_RTL_TEST_LOCALE !== null) {
  // Added to `resources` BEFORE `.init()` runs, never via a post-init `addResourceBundle` call -
  // caught live (Cypress, Firefox): with `addResourceBundle` called right after `.init()` (which is
  // never awaited), `i18n.language` became "rtltest" correctly but `i18n.resolvedLanguage` stayed
  // "en" even a second later - resolvedLanguage is decided once, against whichever bundles already
  // exist at the moment the detector's own languageChanged fires, and never revisited once a later
  // bundle for the same code shows up. Being in `resources` from the start avoids the race instead
  // of chasing it. Same English strings as the real `en` entry above, not a second file on disk, so
  // it can never drift from that catalog.
  resources[DEV_RTL_TEST_LOCALE] = { translation: resources.en.translation }
}

/** The codes this app ships a real catalog for. `pt-BR`/`ja`/`ko`/`ru` and the other stub
 *  folders are deliberately absent (see `SUPPORTED_LANGUAGES`'s own comment). */
const SUPPORTED_LANGUAGE_CODES = new Set(SUPPORTED_LANGUAGES.map((language) => language.code))

/**
 * Browsers report things that are not BCP 47 tags. A POSIX-locale OS makes headless Chromium send
 * `en-US@posix`, which every `Intl` constructor rejects with `RangeError: Invalid language tag`
 * (issue #718). Strip the POSIX modifier (`@posix`, `@euro`, ...), accept an underscore separator,
 * then let `Intl.getCanonicalLocales` decide whether what is left is a tag at all.
 */
export function normalizeLanguageTag(lang: string | null | undefined): string | null {
  if (!lang) return null
  const withoutPosix = lang.trim().replace(/_/g, "-").split("@")[0]
  if (!withoutPosix) return null
  try {
    return Intl.getCanonicalLocales(withoutPosix)[0] ?? null
  } catch {
    return null
  }
}

/**
 * The language the interface actually renders in, from whatever the detector read. Only a supported
 * base language survives: `fr-FR`, `fr-CA` and `fr` all resolve to `fr`, and a language this app has
 * no (non-stub) catalog for (`ja`, `ko`, `pt-BR`, `xx`) resolves to `en`, i18next's own fallback.
 * That is what keeps `i18n.language` and the dates in the same language (issue #733): the interface
 * falls back to English for a `ja` browser, so the dates must too.
 */
export function resolveAppLanguage(lang: string | null | undefined): string {
  if (DEV_RTL_TEST_LOCALE !== null && lang === DEV_RTL_TEST_LOCALE) return DEV_RTL_TEST_LOCALE
  const normalized = normalizeLanguageTag(lang)
  if (!normalized) return "en"
  const base = normalized.split("-")[0].toLowerCase()
  return SUPPORTED_LANGUAGE_CODES.has(base) ? base : "en"
}

/** True when `lang` (a resolved i18next language, or the dev-only RTL test locale) reads right-to-left. */
export function isRtlLocale(lang: string | undefined | null): boolean {
  if (!lang) return false
  if (DEV_RTL_TEST_LOCALE !== null && lang === DEV_RTL_TEST_LOCALE) return true
  const base = lang.split("-")[0].toLowerCase()
  return RTL_LOCALES.includes(base)
}

i18n
  .use(
    new LanguageDetector(null, {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: [],
      // A detected value must already be a language this app renders in, never the raw browser tag:
      // `en-US@posix` is not BCP 47 (issue #718), and a regional/unsupported code whose interface
      // falls back to English must not leave its dates in another language (issue #733).
      convertDetectedLanguage: (lng) => resolveAppLanguage(lng),
    }),
  )
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en",
    supportedLngs: DEV_RTL_TEST_LOCALE
      ? [...SUPPORTED_LANGUAGES.map((l) => l.code), DEV_RTL_TEST_LOCALE]
      : SUPPORTED_LANGUAGES.map((l) => l.code),
    nonExplicitSupportedLngs: true,
    interpolation: {
      escapeValue: false,
    },
    load: "languageOnly",
  })

// `index.html` ships a static `lang="en" dir="ltr"` (there is no server render to fill it in), and
// nothing ever touched it after that — confirmed live: a French-browser visitor got the fully
// translated app while `document.documentElement.lang` stayed "en". Besides misleading assistive
// tech, that mismatch is exactly what makes a browser's own translate offer fire on the wrong
// signal (or not fire at all): Chromium decides whether to prompt from `lang`, not from the text it
// renders. Kept in sync on every change, not just at boot, since `changeLanguage` (the preferences
// picker) never remounts the document.
//
// `dir` comes from `isRtlLocale` (issue #559), never `i18n.dir()` - see RTL_LOCALES's own comment
// for why: this app's explicit list, not i18next's broad script-based guess.
function syncDocumentLanguage() {
  const lang = i18n.resolvedLanguage || i18n.language || "en"
  document.documentElement.lang = lang
  document.documentElement.dir = isRtlLocale(lang) ? "rtl" : "ltr"
}
i18n.on("languageChanged", syncDocumentLanguage)
// `languageChanged` can fire synchronously inside `.init()` above, before this listener existed —
// apply once more here to cover that race instead of depending on event-registration order.
syncDocumentLanguage()

// Supported languages and their regional variants, plus every shipped catalog: i18next adopts a
// detected code verbatim when a catalog exists for it, even outside `supportedLngs`.
const DATE_FNS_LOCALES = new Map<string, Locale>([
  ["ar", ar],
  ["ar-DZ", arDZ],
  ["ar-EG", arEG],
  ["ar-MA", arMA],
  ["ar-SA", arSA],
  ["ar-TN", arTN],
  ["cs", cs],
  ["de", de],
  ["de-AT", deAT],
  ["en-AU", enAU],
  ["en-CA", enCA],
  ["en-GB", enGB],
  ["en-IE", enIE],
  ["en-IN", enIN],
  ["en-NZ", enNZ],
  ["en-US", enUS],
  ["en-ZA", enZA],
  ["es", es],
  ["fr", fr],
  ["fr-CA", frCA],
  ["fr-CH", frCH],
  ["it", it],
  ["it-CH", itCH],
  ["nl", nl],
  ["nl-BE", nlBE],
  ["pl", pl],
  ["da", da],
  ["he", he],
  ["ja", ja],
  ["ko", ko],
  ["pt-BR", ptBR],
  ["ru", ru],
  ["sv", sv],
  ["uk", uk],
])

export function languageToLocale(lang: string): Locale {
  const normalized = normalizeLanguageTag(lang)
  if (!normalized) return enUS
  return DATE_FNS_LOCALES.get(normalized) ?? DATE_FNS_LOCALES.get(normalized.split("-")[0]) ?? enUS
}
