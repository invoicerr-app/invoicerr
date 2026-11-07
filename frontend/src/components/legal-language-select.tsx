import { useTranslation } from "react-i18next"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

/**
 * Each language's own endonym — deliberately NOT run through `t()`: a language's name is the one
 * piece of UI text every reader recognizes regardless of which locale the app's own chrome happens to
 * be in, so localizing "French"/"Français" per UI locale would buy nothing a native name doesn't
 * already give for free — and it keeps this list in exact lockstep with backend `legal-languages.ts`'s
 * own `LEGAL_DOCUMENT_LANGUAGES` without a translation key to keep in sync for every addition.
 * English and French only since D-297 (the hosted-offer texts are English-only, plus three short
 * French summaries); a reader of any other language sees no selector at all and gets English.
 */
const LANGUAGE_LABELS: Record<string, string> = {
  en: "English",
  fr: "Français",
}

function languageLabel(code: string): string {
  return LANGUAGE_LABELS[code] ?? code.toUpperCase()
}

/**
 * A language switcher shown only when the document(s) being read actually have more than one
 * language — shared by `pages/legal/[slug].tsx` (one document) and `pages/legal/accept.tsx` (up to
 * two, at once, via the union of their own `availableLanguages`), so a visitor picking, say, French
 * always sees the same control in the same place regardless of which of those two screens they are on.
 * `value`/`onChange` are the resolved language and the explicit override respectively — the caller
 * owns the actual refetch (`useLegalDocuments(lang)`), this component only ever reports a choice.
 */
export function LegalLanguageSelect({
  value,
  languages,
  onChange,
}: {
  value: string
  languages: readonly string[]
  onChange: (lang: string) => void
}) {
  const { t } = useTranslation()

  if (languages.length <= 1) return null

  return (
    <div className="flex items-center gap-2" data-cy="legal-language-select">
      <span className="text-xs text-muted-foreground">{t("legal.document.language", "Language")}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger size="sm" className="w-40" dataCy="legal-language-select-trigger">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {languages.map((lang) => (
            <SelectItem key={lang} value={lang} dataCy={`legal-language-option-${lang}`}>
              {languageLabel(lang)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
