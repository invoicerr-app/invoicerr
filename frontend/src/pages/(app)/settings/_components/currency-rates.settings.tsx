"use client"

import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import CurrencySelect from "@/components/currency-select"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useGet, usePost } from "@/hooks/use-fetch"
import { useMutationWithToast } from "@/hooks/use-mutation-with-toast"
import type { CurrencyRate } from "@/types"

/**
 * Minimal CRUD screen for manually-entered exchange rates (item 9, root TODO — "le multi-devises") —
 * GET/POST /api/company/currency-rates. No delete, no edit: correcting a mis-entered rate means
 * entering a NEW one with a later `asOf` — it simply outranks the old one at resolution time (see
 * the backend's CurrencyRatesController header) — the same "never mutate history, add a new fact"
 * posture DocumentPayment already holds.
 *
 * A self-contained data resource, deliberately NOT wired into the surrounding company settings
 * `<form>` (company.settings.tsx, which renders this Card) — a rate has its own endpoint and its own
 * save moment (added immediately on "Add rate", not batched with the rest of the company profile),
 * the same separation webhooks.settings.tsx already draws between the company `<form>` and its own
 * webhook list.
 *
 * No auto-derived inverse rate anywhere in this screen either: adding EUR→USD does not fill in
 * USD→EUR for you — see convert.ts's `resolveLatestRate` for why (a derived 1/x would be a silent
 * rounding error nobody asked for). A company wanting both directions adds both rows.
 */
export default function CurrencyRatesSettings() {
  const { t } = useTranslation()
  const { data: rates, mutate } = useGet<CurrencyRate[]>("/api/company/currency-rates")
  const { trigger: createRate, loading: creating } = useMutationWithToast(
    usePost<CurrencyRate>("/api/company/currency-rates"),
    t("settings.company.currencyRates.messages.createError", "Failed to add currency rate"),
  )

  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [rate, setRate] = useState("")

  const handleAdd = async () => {
    if (!from || !to) {
      toast.error(t("settings.company.currencyRates.messages.currenciesRequired", "Pick both currencies"))
      return
    }
    if (from === to) {
      toast.error(
        t(
          "settings.company.currencyRates.messages.sameCurrency",
          'The "from" and "to" currencies must differ',
        ),
      )
      return
    }
    const parsedRate = Number(rate)
    if (!(parsedRate > 0)) {
      toast.error(t("settings.company.currencyRates.messages.invalidRate", "Rate must be a positive number"))
      return
    }

    const result = await createRate({ from, to, rate: parsedRate })
    if (!result) return // error already toasted by the wrapper

    toast.success(t("settings.company.currencyRates.messages.createSuccess", "Currency rate added"))
    setFrom("")
    setTo("")
    setRate("")
    mutate()
  }

  return (
    <Card data-cy="currency-rates-card">
      <CardHeader>
        <CardTitle>{t("settings.company.currencyRates.title", "Exchange rates")}</CardTitle>
        <CardDescription>
          {t(
            "settings.company.currencyRates.description",
            "Manually-entered rates used to consolidate dashboard totals into your reference currency below. No rate is ever derived automatically — enter both directions if you need them.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {rates && rates.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-cy="currency-rates-table">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-4 font-medium">
                    {t("settings.company.currencyRates.table.pair", "Pair")}
                  </th>
                  <th className="py-1 pr-4 font-medium">
                    {t("settings.company.currencyRates.table.rate", "Rate")}
                  </th>
                  <th className="py-1 pr-4 font-medium">
                    {t("settings.company.currencyRates.table.asOf", "As of")}
                  </th>
                  <th className="py-1 pr-4 font-medium">
                    {t("settings.company.currencyRates.table.source", "Source")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rates.map((r) => (
                  <tr key={r.id} data-cy={`currency-rate-row-${r.id}`}>
                    <td className="py-1 pr-4" data-cy={`currency-rate-row-${r.id}-pair`}>
                      {r.from}→{r.to}
                    </td>
                    <td className="py-1 pr-4" data-cy={`currency-rate-row-${r.id}-rate`}>
                      {r.rate}
                    </td>
                    <td className="py-1 pr-4">{new Date(r.asOf).toLocaleDateString()}</td>
                    <td className="py-1 pr-4">{r.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground" data-cy="currency-rates-empty">
            {t("settings.company.currencyRates.empty", "No exchange rate entered yet.")}
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end border-t pt-4">
          <div className="space-y-1">
            <span className="text-sm font-medium">
              {t("settings.company.currencyRates.form.from", "From")}
            </span>
            <CurrencySelect
              value={from}
              onChange={(v) => setFrom(v as string)}
              data-cy="currency-rate-from-select"
            />
          </div>
          <div className="space-y-1">
            <span className="text-sm font-medium">{t("settings.company.currencyRates.form.to", "To")}</span>
            <CurrencySelect
              value={to}
              onChange={(v) => setTo(v as string)}
              data-cy="currency-rate-to-select"
            />
          </div>
          <div className="space-y-1">
            <span className="text-sm font-medium">
              {t("settings.company.currencyRates.form.rate", "Rate")}
            </span>
            <Input
              type="number"
              step="any"
              min="0"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="1.0842"
              data-cy="currency-rate-rate-input"
            />
          </div>
          <Button type="button" onClick={handleAdd} loading={creating} data-cy="currency-rate-add-btn">
            {t("settings.company.currencyRates.form.add", "Add rate")}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
