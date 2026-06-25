import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

import { AlertTriangle } from "lucide-react"
import { useTranslation } from "react-i18next"

/** Banner shown on auth pages when the backend/database can't be reached. */
export function ServerUnavailableBanner() {
  const { t } = useTranslation()

  return (
    <Alert variant="destructive" className="mb-4">
      <AlertTriangle />
      <AlertTitle>{t("auth.serverUnavailable.title")}</AlertTitle>
      <AlertDescription>{t("auth.serverUnavailable.description")}</AlertDescription>
    </Alert>
  )
}
