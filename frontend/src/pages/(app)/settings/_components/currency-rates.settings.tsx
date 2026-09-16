"use client"

import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Coins } from "lucide-react"

import CurrencySelect from "@/components/currency-select"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { useGet, usePost } from "@/hooks/use-fetch"
import { useMutationWithToast } from "@/hooks/use-mutation-with-toast"
import type { CurrencyRate, CurrencyRatePairGap } from "@/types"

import { SettingsList, SettingsListRow, SettingsSection } from "./settings-section"

/** Must match the backend's `EXCHANGERATE_API_SOURCE` (currency-rate-sweep.ts) exactly — the two
 *  are never shared across a language boundary in this repo (backend/frontend are independent npm
 *  projects, no shared package), the same "duplicated literal, not imported" reality this screen
 *  already accepts for the existing 'manual'/'ecb' source strings it just renders as a chip below. */
const EXCHANGERATE_API_SOURCE = "exchangerate-api"

/**
 * Minimal CRUD screen for manually-entered exchange rates ("multi-currency") —
 * GET/POST /api/company/currency-rates. No delete, no edit: correcting a mis-entered rate means
 * entering a NEW one with a later `asOf` — it simply outranks the old one at resolution time (see
 * the backend's CurrencyRatesController header) — the same "never mutate history, add a new fact"
 * posture DocumentPayment already holds.
 *
 * A self-contained data resource, deliberately NOT wired into the surrounding company settings
 * `<form>` (company.settings.tsx, which renders this section) — a rate has its own endpoint and its
 * own save moment (added immediately on "Add rate", not batched with the rest of the company
 * profile), the same separation webhooks.settings.tsx already draws between the company `<form>`
 * and its own webhook list.
 *
 * No auto-derived inverse rate anywhere in this screen either: adding EUR→USD does not fill in
 * USD→EUR for you — see convert.ts's `resolveLatestRate` for why (a derived 1/x would be a silent
 * rounding error nobody asked for). A company wanting both directions adds both rows.
 *
 * Two more pieces live here, both read-only:
 *  - The exchangerate-api.com ATTRIBUTION notice — required by that provider's free-tier licence
 *    (open-er-api-rates-client.ts's own header quotes it verbatim) for any rate the daily sweep could
 *    only resolve through it as a FALLBACK for a currency the ECB doesn't quote. Deliberately placed
 *    HERE, never on an invoice PDF — the product owner's own decision, since an invoice is a legal
 *    document to a third party, not a screen this provider's terms are aimed at — and shown only when
 *    at least one listed rate actually carries that source, never unconditionally.
 *  - The GAPS list (`GET .../gaps`) — pairs this company entered that NEITHER automatic source has
 *    ever been able to refresh. Before this, such a pair silently vanished into the sweep's own
 *    `skipped` counter, visible only in a server log; this is where "stop the silence" surfaces it to
 *    the person who can actually do something about it (enter/refresh the rate by hand) rather than
 *    an operator who cannot.
 */
export default function CurrencyRatesSettings() {
  const { t } = useTranslation()
  const { data: rates, mutate } = useGet<CurrencyRate[]>("/api/company/currency-rates")
  const { data: gaps } = useGet<CurrencyRatePairGap[]>("/api/company/currency-rates/gaps")
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
    <SettingsSection
      title={t("settings.company.currencyRates.title", "Exchange rates")}
      description={t(
        "settings.company.currencyRates.description",
        "Manually-entered rates used to consolidate dashboard totals into your reference currency below. No rate is ever derived automatically — enter both directions if you need them.",
      )}
      dataCy="currency-rates-card"
      contentClassName="grid gap-4"
    >
      {rates?.some((r) => r.source === EXCHANGERATE_API_SOURCE) && (
        <p className="text-xs text-muted-foreground" data-cy="currency-rates-attribution">
          {t(
            "settings.company.currencyRates.attribution.text",
            "Rates for currencies the European Central Bank does not quote are supplied by",
          )}{" "}
          <a
            href="https://www.exchangerate-api.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4"
          >
            {t("settings.company.currencyRates.attribution.linkLabel", "exchangerate-api.com")}
          </a>
          .
        </p>
      )}

      {rates && rates.length > 0 ? (
        <SettingsList dataCy="currency-rates-table">
          {rates.map((r) => (
            <SettingsListRow
              key={r.id}
              dataCy={`currency-rate-row-${r.id}`}
              title={
                <span className="font-mono tabular-nums" data-cy={`currency-rate-row-${r.id}-pair`}>
                  {r.from}→{r.to}
                </span>
              }
              meta={
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span
                    className="font-mono tabular-nums text-foreground"
                    data-cy={`currency-rate-row-${r.id}-rate`}
                  >
                    {r.rate}
                  </span>
                  <span className="font-mono tabular-nums">{new Date(r.asOf).toLocaleDateString()}</span>
                  <Badge variant="outline">{r.source}</Badge>
                </span>
              }
            />
          ))}
        </SettingsList>
      ) : (
        <EmptyState
          size="sm"
          icon={Coins}
          title={t("settings.company.currencyRates.empty", "No exchange rate entered yet.")}
          data-cy="currency-rates-empty"
        />
      )}

      {gaps && gaps.length > 0 && (
        <div className="space-y-2 border-t pt-4" data-cy="currency-rates-gaps">
          <p className="text-sm font-medium">
            {t("settings.company.currencyRates.gaps.title", "No automatic rate available")}
          </p>
          <p className="text-xs text-muted-foreground text-pretty">
            {t(
              "settings.company.currencyRates.gaps.description",
              "Neither the European Central Bank feed nor the exchangerate-api.com fallback has ever refreshed these pairs automatically. Any rate shown above for them is whatever was last entered by hand.",
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {gaps.map((g) => (
              <Badge
                key={`${g.from}-${g.to}`}
                variant="warning"
                className="font-mono tabular-nums"
                data-cy={`currency-rate-gap-${g.from}-${g.to}`}
              >
                {g.from}→{g.to}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-3 border-t pt-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
              className="font-mono tabular-nums"
              data-cy="currency-rate-rate-input"
            />
          </div>
        </div>
        {/* `outline` — this tab's ONE `default` primary is company.settings.tsx's own "Save"; a rate
         *  is added immediately, on its own endpoint, never batched with that submit. */}
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={handleAdd}
            loading={creating}
            data-cy="currency-rate-add-btn"
          >
            {t("settings.company.currencyRates.form.add", "Add rate")}
          </Button>
        </div>
      </div>
    </SettingsSection>
  )
}
