import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useTranslation } from "react-i18next"

import { DOCUMENT_LANGUAGE_CODES } from "@/lib/reference/countries"

/**
 * Document language per recipient ("langue du document par destinataire") — the selectable codes and
 * their backend mirror live in `lib/reference/countries.ts`, so a pure reference module never has to
 * import this component.
 */

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
  id?: string
  "aria-describedby"?: string
  "aria-invalid"?: boolean
}

export default function DocumentLanguageSelect({
  value,
  onChange,
  "data-cy": dataCy,
  ...aria
}: DocumentLanguageSelectProps) {
  const { t } = useTranslation()

  return (
    <Select value={value || AUTOMATIC} onValueChange={(next) => onChange(next === AUTOMATIC ? null : next)}>
      <SelectTrigger dataCy={dataCy} {...aria}>
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
