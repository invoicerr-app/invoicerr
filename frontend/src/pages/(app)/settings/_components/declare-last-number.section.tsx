"use client"

import { useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { usePost } from "@/hooks/use-fetch"
import { useMutationWithToast } from "@/hooks/use-mutation-with-toast"

import { SettingsFormFooter, SettingsSection, useSavedFlash } from "./settings-section"

interface DeclareLastNumberInferResponse {
  pattern: string | null
}

interface DeclareLastNumberResponse {
  typeId: string
  pattern: string
  source: "running-series" | "country-policy"
  nextNumber: number
  violations: { constraintId: string; message: string }[] | null
  atcudSeriesToRegister: string | null
}

const TYPE_IDS = ["invoice", "credit-note"] as const
type TypeId = (typeof TYPE_IDS)[number]

/**
 * "Declare your last number issued" (issue #340) - usable with or without also importing a document
 * (the owner's own decision): a company migrating its numbering by hand still needs the counter to
 * resume where the previous tool left off. Backend: `company.service.ts#declareLastNumberIssued` -
 * see its own header for the full design (running series vs. country format, Portugal's own new-
 * series rule). Refused (409) once numbering has already started for the chosen type - surfaced here
 * as a plain error toast naming that, never hidden as if the form were still usable.
 */
export function DeclareLastNumberSection() {
  const { t } = useTranslation()
  const [saved, flash] = useSavedFlash()

  const [typeId, setTypeId] = useState<TypeId>("invoice")
  const [lastNumber, setLastNumber] = useState("")
  const [lastIssueDate, setLastIssueDate] = useState("")
  const [pattern, setPattern] = useState("")
  const [result, setResult] = useState<DeclareLastNumberResponse | null>(null)

  const inferMutation = useMutationWithToast(
    usePost<DeclareLastNumberInferResponse>("/api/company/number-formats/infer-pattern"),
    t("settings.declareLastNumber.errors.infer"),
  )
  const declareMutation = useMutationWithToast(
    usePost<DeclareLastNumberResponse>("/api/company/number-formats/declare-last-number"),
    t("settings.declareLastNumber.errors.declare"),
  )

  const canInfer = lastNumber.trim().length > 0 && lastIssueDate.trim().length > 0

  const handleInfer = async () => {
    const response = await inferMutation.trigger({ typeId, lastNumber, lastIssueDate })
    if (!response) return
    setPattern(response.pattern ?? "")
  }

  const handleDeclare = async () => {
    setResult(null)
    const response = await declareMutation.trigger({ typeId, lastNumber, lastIssueDate, pattern })
    if (!response) return
    setResult(response)
    flash()
  }

  return (
    <SettingsSection
      title={t("settings.declareLastNumber.title")}
      description={t("settings.declareLastNumber.description")}
      dataCy="declare-last-number-section"
      contentClassName="grid gap-4"
      footer={
        <SettingsFormFooter saved={saved} dataCy="declare-last-number-footer">
          <Button
            type="button"
            onClick={handleDeclare}
            loading={declareMutation.loading}
            disabled={!pattern.trim() || !lastNumber.trim() || !lastIssueDate.trim()}
            dataCy="declare-last-number-submit"
          >
            {t("settings.declareLastNumber.submit")}
          </Button>
        </SettingsFormFooter>
      }
    >
      <div className="grid gap-2">
        <Label>{t("settings.declareLastNumber.type")}</Label>
        <Select value={typeId} onValueChange={(value) => setTypeId(value as TypeId)}>
          <SelectTrigger data-cy="declare-last-number-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="invoice">{t("settings.declareLastNumber.typeInvoice")}</SelectItem>
            <SelectItem value="credit-note">{t("settings.declareLastNumber.typeCreditNote")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="declare-last-number-value">{t("settings.declareLastNumber.lastNumber")}</Label>
          <Input
            id="declare-last-number-value"
            value={lastNumber}
            onChange={(event) => setLastNumber(event.target.value)}
            placeholder="FA-2026-0142"
            data-cy="declare-last-number-value"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="declare-last-number-date">{t("settings.declareLastNumber.lastIssueDate")}</Label>
          <Input
            id="declare-last-number-date"
            type="date"
            value={lastIssueDate}
            onChange={(event) => setLastIssueDate(event.target.value)}
            data-cy="declare-last-number-date"
          />
        </div>
      </div>

      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="declare-last-number-pattern">{t("settings.declareLastNumber.pattern")}</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleInfer}
            disabled={!canInfer}
            loading={inferMutation.loading}
            dataCy="declare-last-number-infer"
          >
            {t("settings.declareLastNumber.infer")}
          </Button>
        </div>
        <Input
          id="declare-last-number-pattern"
          value={pattern}
          onChange={(event) => setPattern(event.target.value)}
          placeholder="FA-{year}-{number:4}"
          data-cy="declare-last-number-pattern"
        />
        <p className="text-xs text-muted-foreground text-pretty">
          {t("settings.declareLastNumber.patternHint")}
        </p>
      </div>

      {result && (
        <div
          className="rounded-lg border bg-muted/40 p-3 text-sm text-pretty"
          data-cy="declare-last-number-result"
        >
          <p>
            {t("settings.declareLastNumber.result.pattern")}{" "}
            <code className="font-mono">{result.pattern}</code>{" "}
            {result.source === "running-series"
              ? t("settings.declareLastNumber.result.sourceRunning")
              : t("settings.declareLastNumber.result.sourceCountry")}
          </p>
          <p>
            {t("settings.declareLastNumber.result.next")}{" "}
            <span className="font-mono">{result.nextNumber}</span>
          </p>
          {result.violations && result.violations.length > 0 && (
            <p className="text-warning-foreground" data-cy="declare-last-number-violations">
              {t("settings.declareLastNumber.result.violations", {
                reasons: result.violations.map((v) => v.message).join("; "),
              })}
            </p>
          )}
          {result.atcudSeriesToRegister && (
            <p className="text-warning-foreground" data-cy="declare-last-number-atcud-series">
              {t("settings.declareLastNumber.result.atcudSeries", { series: result.atcudSeriesToRegister })}
            </p>
          )}
        </div>
      )}
    </SettingsSection>
  )
}
