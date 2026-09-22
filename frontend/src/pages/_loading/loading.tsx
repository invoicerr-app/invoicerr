import { useTranslation } from "react-i18next"

export default function Loading() {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-center h-screen w-screen">
      <div
        role="status"
        aria-label={t("common.loading")}
        className="motion-reduce:animate-none animate-spin rounded-full h-16 w-16 border-b-2 border-primary"
      ></div>
    </div>
  )
}
