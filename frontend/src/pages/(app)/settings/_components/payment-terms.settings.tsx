"use client"

import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { usePaymentTerms, useSavePaymentTerms } from "@/hooks/queries/use-payment-terms"
import type { DueDateMode } from "@/lib/due-date"
import type { ResolvedPaymentTerms } from "@/types"

import { SettingsFormFooter, SettingsPage, SettingsSection, useSavedFlash } from "./settings-section"

type TermKey = "quote" | "invoice"

interface TermDraft {
  days: string
  mode: DueDateMode
}

type Drafts = Record<TermKey, TermDraft>

const TERM_KEYS: TermKey[] = ["quote", "invoice"]

function draftsFrom(terms: ResolvedPaymentTerms): Drafts {
  const draft = (term: ResolvedPaymentTerms[TermKey]): TermDraft => ({
    days: term ? String(term.days) : "",
    mode: term?.mode ?? "net",
  })
  return { quote: draft(terms.quote), invoice: draft(terms.invoice) }
}

function parseDays(value: string): number | null {
  if (value.trim() === "") return null
  const days = Number(value)
  return Number.isInteger(days) && days >= 0 && days <= 365 ? days : Number.NaN
}

function exceedsCap(draft: TermDraft, cap: ResolvedPaymentTerms["cap"]): boolean {
  const days = parseDays(draft.days)
  if (!cap || days === null || Number.isNaN(days)) return false
  return days > (draft.mode === "endOfMonth" ? cap.maxEndOfMonthDays : cap.maxNetDays)
}

function TermSection({
  termKey,
  draft,
  cap,
  onChange,
}: Readonly<{
  termKey: TermKey
  draft: TermDraft
  cap: ResolvedPaymentTerms["cap"]
  onChange: (next: TermDraft) => void
}>) {
  const { t } = useTranslation()
  const invalid = Number.isNaN(parseDays(draft.days))
  return (
    <SettingsSection
      title={t(`settings.paymentTerms.${termKey}.title`)}
      description={t(`settings.paymentTerms.${termKey}.description`)}
      dataCy={`payment-terms-${termKey}-card`}
      contentClassName="grid gap-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`payment-terms-${termKey}-days`}>{t("settings.paymentTerms.form.days")}</Label>
          <Input
            id={`payment-terms-${termKey}-days`}
            type="number"
            inputMode="numeric"
            min={0}
            max={365}
            step={1}
            placeholder={t("settings.paymentTerms.form.daysPlaceholder")}
            value={draft.days}
            aria-invalid={invalid}
            onChange={(event) => onChange({ ...draft, days: event.target.value })}
            data-cy={`payment-terms-${termKey}-days-input`}
          />
          <p className="text-xs text-muted-foreground">
            {invalid ? t("settings.paymentTerms.form.daysInvalid") : t("settings.paymentTerms.form.daysHint")}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`payment-terms-${termKey}-mode`}>{t("settings.paymentTerms.form.mode")}</Label>
          <Select
            value={draft.mode}
            onValueChange={(mode) => onChange({ ...draft, mode: mode as DueDateMode })}
          >
            <SelectTrigger
              id={`payment-terms-${termKey}-mode`}
              data-cy={`payment-terms-${termKey}-mode-select`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="net" data-cy={`payment-terms-${termKey}-mode-option-net`}>
                {t("settings.paymentTerms.form.modes.net")}
              </SelectItem>
              <SelectItem value="endOfMonth" data-cy={`payment-terms-${termKey}-mode-option-endOfMonth`}>
                {t("settings.paymentTerms.form.modes.endOfMonth")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {cap && exceedsCap(draft, cap) && (
        <Alert variant="warning" data-cy={`payment-terms-${termKey}-cap-warning`}>
          <AlertDescription>
            {t("settings.paymentTerms.capWarning", {
              maxNetDays: cap.maxNetDays,
              maxEndOfMonthDays: cap.maxEndOfMonthDays,
            })}
          </AlertDescription>
        </Alert>
      )}
    </SettingsSection>
  )
}

export default function PaymentTermsSettings() {
  const { t } = useTranslation()
  const { data: terms } = usePaymentTerms()
  const { mutateAsync: save, isPending } = useSavePaymentTerms()
  const [saved, flashSaved] = useSavedFlash()
  const [drafts, setDrafts] = useState<Drafts | null>(null)

  useEffect(() => {
    if (terms) setDrafts(draftsFrom(terms))
  }, [terms])

  const hasInvalid = drafts ? TERM_KEYS.some((key) => Number.isNaN(parseDays(drafts[key].days))) : false

  const handleSave = async () => {
    if (!drafts || hasInvalid) return
    const body = Object.fromEntries(
      TERM_KEYS.flatMap((key) => {
        const days = parseDays(drafts[key].days)
        return [
          [`${key}DueDays`, days],
          [`${key}DueMode`, days === null ? null : drafts[key].mode],
        ]
      }),
    )
    try {
      await save(body)
      toast.success(t("settings.paymentTerms.messages.saveSuccess"))
      flashSaved()
    } catch {
      toast.error(t("settings.paymentTerms.messages.saveError"))
    }
  }

  return (
    <SettingsPage
      title={t("settings.paymentTerms.title")}
      description={t("settings.paymentTerms.description")}
      dataCy="payment-terms-section"
    >
      {drafts &&
        TERM_KEYS.map((key) => (
          <TermSection
            key={key}
            termKey={key}
            draft={drafts[key]}
            cap={terms?.cap ?? null}
            onChange={(next) => setDrafts({ ...drafts, [key]: next })}
          />
        ))}
      <SettingsFormFooter saved={saved}>
        <Button
          type="button"
          onClick={() => void handleSave()}
          loading={isPending}
          disabled={!drafts || hasInvalid}
          data-cy="payment-terms-save-button"
        >
          {t("settings.paymentTerms.save")}
        </Button>
      </SettingsFormFooter>
    </SettingsPage>
  )
}
