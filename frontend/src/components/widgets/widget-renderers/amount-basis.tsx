import { useTranslation } from "react-i18next"

import type { AmountBasis } from "@/components/widgets/types"
import { cn } from "@/lib/utils"

/** "incl. VAT" / "excl. VAT" under a widget title or column header, in the reader's language. */
export function AmountBasisCaption({
  basis,
  dataCy,
  className,
}: {
  basis?: AmountBasis
  dataCy: string
  className?: string
}) {
  const { t } = useTranslation()
  if (!basis) return null
  return (
    <span
      className={cn(
        "block font-sans text-xs font-normal normal-case tracking-normal text-muted-foreground",
        className,
      )}
      data-cy={dataCy}
    >
      {basis === "inclVat" ? t("widgets.basis.inclVat") : t("widgets.basis.exclVat")}
    </span>
  )
}
