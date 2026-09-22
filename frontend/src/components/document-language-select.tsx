import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useTranslation } from "react-i18next"

/**
 * Document language per recipient ("langue du document par destinataire") — mirrors the backend's own
 * `documents/rendering/language/supported-languages.ts#SUPPORTED_RENDER_LANGUAGES` exactly: offering a
 * language here that render layer has no chrome/email translations for would let a user pick a choice
 * that silently falls back to English at render time, which is worse than not offering it at all.
 */
export const DOCUMENT_LANGUAGE_CODES = ["en", "fr", "it", "pl", "de", "pt"] as const

// Not a real language code — the in-form sentinel for "no explicit choice", mapped to `null` on the
// way out (see `onChange` below). Kept out of `DOCUMENT_LANGUAGE_CODES` so it is never mistaken for a
// value this component could round-trip straight to the backend.
const AUTOMATIC = "__automatic__"

interface DocumentLanguageSelectProps {
  /** `null`/`undefined` renders as "Automatic" — see this component's own header. */
  value: string | null | undefined
  /** `null` clears the explicit choice (falls back to the next layer in
   *  `resolveRecipientLanguage` — the company's own default, then English). */
  onChange: (value: string | null) => void
  "data-cy"?: string
}

export default function DocumentLanguageSelect({
  value,
  onChange,
  "data-cy": dataCy,
}: DocumentLanguageSelectProps) {
  const { t } = useTranslation()

  return (
    <Select value={value || AUTOMATIC} onValueChange={(next) => onChange(next === AUTOMATIC ? null : next)}>
      <SelectTrigger dataCy={dataCy}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={AUTOMATIC} dataCy={dataCy ? `${dataCy}-automatic` : undefined}>
          {t("component.document-language-select.automatic")}
        </SelectItem>
        {DOCUMENT_LANGUAGE_CODES.map((code) => (
          <SelectItem key={code} value={code} dataCy={dataCy ? `${dataCy}-${code}` : undefined}>
            {t(`component.document-language-select.languages.${code}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
