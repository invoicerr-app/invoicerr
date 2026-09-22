import { TriangleAlert } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import { useCountryReadiness } from "@/hooks/use-country-readiness"
import { cn } from "@/lib/utils"

const GITHUB_ISSUES_URL = "https://github.com/invoicerr-app/invoicerr/issues/new"

// Keys into component.country-readiness-alert.mechanisms — one per CŒUR mechanism id the backend's
// `CountryReadinessService` can name (see that file's own header). A mechanism id this component
// doesn't recognize (should never happen — the 5 ids are a fixed, shared contract) falls back to
// showing the raw id rather than crashing the alert.
const MECHANISM_LABEL_KEYS: Record<string, string> = {
  "country-policy": "component.country-readiness-alert.mechanisms.countryPolicy",
  "vat-rates": "component.country-readiness-alert.mechanisms.vatRates",
  "tax-systems": "component.country-readiness-alert.mechanisms.taxSystems",
  "correction-routes": "component.country-readiness-alert.mechanisms.correctionRoutes",
  "country-identifiers": "component.country-readiness-alert.mechanisms.countryIdentifiers",
}

interface CountryReadinessAlertProps {
  /** The ISO 3166-1 alpha-2 code the caller's `CountrySelect#onCountryCodeChange` produced — the
   *  alert renders nothing until this is set, and nothing at all once the country turns out
   *  `complete`. */
  countryCode: string | undefined | null
  /** The localized display name (`CountrySelect`'s own `Intl.DisplayNames` label) — used only to
   *  make the alert text and the pre-filled GitHub issue read naturally; falls back to the bare code
   *  when unavailable. */
  countryName?: string | null
}

/**
 * A NEVER-BLOCKING warning shown under a country picker (onboarding wizard, company settings) when
 * the chosen country is missing one or more of the 5 CŒUR compliance mechanisms — see
 * `country-readiness.service.ts`'s own header for the exact definition of "complete". The user can
 * always continue; this only offers a pre-filled GitHub issue so the gap gets reported instead of
 * discovered later as a support ticket. The frontend never opens a network request to GitHub itself
 * — the link only pre-fills the title/body via query params, the user still has to click and submit.
 */
export default function CountryReadinessAlert({ countryCode, countryName }: CountryReadinessAlertProps) {
  const { t } = useTranslation()
  const { data: readiness } = useCountryReadiness(countryCode)

  if (!readiness || readiness.complete) return null

  const displayName = countryName || readiness.countryCode
  const labelFor = (mechanismId: string) => t(MECHANISM_LABEL_KEYS[mechanismId] ?? mechanismId, mechanismId)
  const missingLabels = readiness.missing.map(labelFor)
  const presentLabels = readiness.present.map(labelFor)
  const noneLabel = t("component.country-readiness-alert.issue.none", "none")

  const issueTitle = t(
    "component.country-readiness-alert.issue.title",
    "Support request for {{country}} ({{code}})",
    { country: displayName, code: readiness.countryCode },
  )
  const issueBody = [
    t("component.country-readiness-alert.issue.bodyCountry", "Country: {{country}} ({{code}})", {
      country: displayName,
      code: readiness.countryCode,
    }),
    t("component.country-readiness-alert.issue.bodyPresent", "Already supported: {{list}}", {
      list: presentLabels.length ? presentLabels.join(", ") : noneLabel,
    }),
    t("component.country-readiness-alert.issue.bodyMissing", "Missing: {{list}}", {
      list: missingLabels.join(", "),
    }),
  ].join("\n")
  const issueUrl = `${GITHUB_ISSUES_URL}?title=${encodeURIComponent(issueTitle)}&body=${encodeURIComponent(issueBody)}`

  return (
    <Alert data-cy="company-country-incomplete-alert">
      <TriangleAlert className="h-4 w-4" />
      <AlertTitle>
        {t("component.country-readiness-alert.title", "{{country}} is not fully supported yet", {
          country: displayName,
        })}
      </AlertTitle>
      <AlertDescription>
        <p>
          {t(
            "component.country-readiness-alert.description",
            "The following isn't available for this country yet: {{list}}. You can still continue — some compliance features may not work correctly until this is addressed.",
            { list: missingLabels.join(", ") },
          )}
        </p>
        <a
          href={issueUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-1")}
          data-cy="company-country-open-issue"
        >
          {t("component.country-readiness-alert.openIssue", "Open a GitHub issue")}
        </a>
      </AlertDescription>
    </Alert>
  )
}
