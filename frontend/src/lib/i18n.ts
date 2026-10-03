import {
  af,
  ar,
  arDZ,
  arEG,
  arMA,
  arSA,
  arTN,
  az,
  be,
  beTarask,
  bg,
  bn,
  bs,
  ca,
  ckb,
  cs,
  cy,
  da,
  de,
  deAT,
  el,
  enAU,
  enCA,
  enGB,
  enIE,
  enIN,
  enNZ,
  enUS,
  enZA,
  eo,
  es,
  et,
  eu,
  faIR,
  fi,
  fr,
  frCA,
  frCH,
  fy,
  gd,
  gl,
  gu,
  he,
  hi,
  hr,
  ht,
  hu,
  hy,
  id,
  is,
  it,
  itCH,
  ja,
  jaHira,
  ka,
  kk,
  km,
  kn,
  ko,
  lb,
  lt,
  lv,
  mk,
  mn,
  ms,
  mt,
  nb,
  nl,
  nlBE,
  nn,
  oc,
  pl,
  pt,
  ptBR,
  ro,
  ru,
  se,
  sk,
  sl,
  sq,
  sr,
  srLatn,
  sv,
  ta,
  te,
  th,
  tr,
  ug,
  uk,
  uz,
  uzCyrl,
  vi,
  zhCN,
  zhHK,
  zhTW,
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

export function languageToLocale(lang: string): Locale {
  switch (lang) {
    case "af":
      return af
    case "ar":
      return ar
    case "ar-DZ":
      return arDZ
    case "ar-EG":
      return arEG
    case "ar-MA":
      return arMA
    case "ar-SA":
      return arSA
    case "ar-TN":
      return arTN
    case "az":
      return az
    case "be":
      return be
    case "be-tarask":
      return beTarask
    case "bg":
      return bg
    case "bn":
      return bn
    case "bs":
      return bs
    case "ca":
      return ca
    case "ckb":
      return ckb
    case "cs":
      return cs
    case "cy":
      return cy
    case "da":
      return da
    case "de":
      return de
    case "de-AT":
      return deAT
    case "el":
      return el
    case "en-AU":
      return enAU
    case "en-CA":
      return enCA
    case "en-GB":
      return enGB
    case "en-IE":
      return enIE
    case "en-IN":
      return enIN
    case "en-NZ":
      return enNZ
    case "en-US":
      return enUS
    case "en-ZA":
      return enZA
    case "eo":
      return eo
    case "es":
      return es
    case "et":
      return et
    case "eu":
      return eu
    case "fa-IR":
      return faIR
    case "fi":
      return fi
    case "fr":
      return fr
    case "fr-CA":
      return frCA
    case "fr-CH":
      return frCH
    case "fy":
      return fy
    case "gd":
      return gd
    case "gl":
      return gl
    case "gu":
      return gu
    case "he":
      return he
    case "hi":
      return hi
    case "hr":
      return hr
    case "ht":
      return ht
    case "hu":
      return hu
    case "hy":
      return hy
    case "id":
      return id
    case "is":
      return is
    case "it":
      return it
    case "it-CH":
      return itCH
    case "ja":
      return ja
    case "ja-Hira":
      return jaHira
    case "ka":
      return ka
    case "kk":
      return kk
    case "km":
      return km
    case "kn":
      return kn
    case "ko":
      return ko
    case "lb":
      return lb
    case "lt":
      return lt
    case "lv":
      return lv
    case "mk":
      return mk
    case "mn":
      return mn
    case "ms":
      return ms
    case "mt":
      return mt
    case "nb":
      return nb
    case "nl":
      return nl
    case "nl-BE":
      return nlBE
    case "nn":
      return nn
    case "oc":
      return oc
    case "pl":
      return pl
    case "pt":
      return pt
    case "pt-BR":
      return ptBR
    case "ro":
      return ro
    case "ru":
      return ru
    case "se":
      return se
    case "sk":
      return sk
    case "sl":
      return sl
    case "sq":
      return sq
    case "sr":
      return sr
    case "sr-Latn":
      return srLatn
    case "sv":
      return sv
    case "ta":
      return ta
    case "te":
      return te
    case "th":
      return th
    case "tr":
      return tr
    case "ug":
      return ug
    case "uk":
      return uk
    case "uz":
      return uz
    case "uz-Cyrl":
      return uzCyrl
    case "vi":
      return vi
    case "zh-CN":
      return zhCN
    case "zh-HK":
      return zhHK
    case "zh-TW":
      return zhTW

    default:
      return enUS
  }
}
