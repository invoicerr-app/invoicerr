import { ExternalLink, Loader2 } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  type CompanySubscriptionStatus,
  useBillingEmail,
  useBillingStatus,
  useCompanies,
  useOpenCustomerPortal,
  useOpenLegacyCustomerPortal,
  useSetBillingEmail,
  useStartCheckout,
} from "@/hooks/queries"
import { ApiError } from "@/hooks/use-api-query"
import { SettingsFormFooter, SettingsPage, SettingsSection } from "./settings-section"

/** Chip tone per subscription status — a lifecycle, not a binary "good/bad", so this needs more than
 *  the default/destructive split the old raw `Badge` here used: `success` while paying, `info` for a
 *  trial (informational, not yet an ask), `warning` once payment itself needs attention, `destructive`
 *  once the company stopped functioning, `secondary` (muted) once it's gone and there's nothing left
 *  to act on. */
const STATUS_VARIANT: Record<
  CompanySubscriptionStatus,
  "success" | "info" | "warning" | "destructive" | "secondary"
> = {
  ACTIVE: "success",
  TRIAL: "info",
  PAST_DUE: "warning",
  BLOCKED: "destructive",
  ZIPPED: "destructive",
  DELETED: "secondary",
}

/** Server-side code `billing.controller.ts`'s `POST /billing/checkout` names a 409 with — mirrors that
 *  constant by hand, the same "no shared package between the four projects" convention
 *  `use-mutation-with-toast.ts`'s own `COMPANY_BLOCKED_CODE` already documents. */
const BILLING_EMAIL_TAKEN_CODE = "BILLING_EMAIL_TAKEN"

/** Server-side code both `POST /billing/portal` and `POST /billing/portal/legacy` name a 409 with
 *  (`portal-session.ts`'s own `BILLING_NO_COMPANY_CUSTOMER_CODE`) — this screen normally avoids ever
 *  triggering it at all (`hasCompanyCustomer`/`legacyPortalAvailable` gate which buttons even render),
 *  this is only the click-time safety net for the narrow race where that fact changed a moment ago. */
const BILLING_NO_COMPANY_CUSTOMER_CODE = "BILLING_NO_COMPANY_CUSTOMER"

function apiErrorCode(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined
  return (error.body as { code?: string } | undefined)?.code
}

/**
 * Settings > Subscription — only ever reached when `-[tab].tsx` decided to show the "billing" tab at
 * all, which it does ONLY once `useBillingStatus()` itself has already resolved 200 (see that hook's
 * own header: there is no Vite env mirror of the backend flag, `GET /api/billing/status` answering at
 * all IS the only signal). Still guards its own render on `isSuccess` below regardless — a direct
 * navigation to `/settings/billing` (a stale bookmark, a self-hosted instance where the tab was
 * visible a moment ago but the flag just got unset) must render nothing, not a half-populated screen.
 *
 * OWNER/ADMIN only past this point for anything that touches Polar (`@Roles` on the backend's own
 * `POST /billing/checkout`/`/billing/portal`, product decision 2026-09-16's multi-user follow-up) — a
 * plain MEMBER sees the current plan/status read-only, with an explanatory line instead of the
 * subscribe/manage buttons, rather than a button that would 403 if clicked.
 */
export default function BillingSettings() {
  const { t } = useTranslation()
  const { activeCompanyId, activeRole } = useCompanies()
  const canManageBilling = activeRole === "OWNER" || activeRole === "ADMIN"
  const { data: status, isSuccess } = useBillingStatus()
  const { data: billingEmail } = useBillingEmail()
  const startCheckout = useStartCheckout()
  const openPortal = useOpenCustomerPortal()
  const openLegacyPortal = useOpenLegacyCustomerPortal()
  const setBillingEmail = useSetBillingEmail()

  const [billingEmailDraft, setBillingEmailDraft] = useState("")
  useEffect(() => {
    if (billingEmail) setBillingEmailDraft(billingEmail.billingEmail ?? "")
  }, [billingEmail])

  // `mutate*.isPending` falls back to false as soon as the mutation's own promise resolves — i.e. as
  // soon as `onSuccess` runs — but `window.location.*` navigation still takes a beat (up to a few
  // seconds) before the browser actually leaves this page. Without this, the button re-enables and
  // the spinner stops while the user is still staring at this screen waiting for Polar to load. These
  // stay `true` all the way through navigation and are only cleared on `onError` (the promise
  // rejected, so we never leave) or by the `pageshow` guard below (bfcache back-navigation).
  const [navigatingPortal, setNavigatingPortal] = useState(false)
  const [navigatingLegacyPortal, setNavigatingLegacyPortal] = useState(false)
  const [navigatingCheckoutSlug, setNavigatingCheckoutSlug] = useState<"monthly" | "yearly" | null>(null)

  // Coming back to this page via the browser's back button can restore it from the bfcache instead of
  // re-rendering it fresh — `event.persisted === true` — which would otherwise leave a spinner stuck
  // forever on a button whose navigation never actually completed from this page's point of view.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return
      setNavigatingPortal(false)
      setNavigatingLegacyPortal(false)
      setNavigatingCheckoutSlug(null)
    }
    window.addEventListener("pageshow", onPageShow)
    return () => window.removeEventListener("pageshow", onPageShow)
  }, [])

  if (!isSuccess || !status) return null

  const returnUrl = `${window.location.origin}/settings/billing`

  const subscribe = (interval: "monthly" | "yearly") => {
    if (!activeCompanyId) return
    startCheckout.mutate(
      {
        slug: interval,
        successUrl: `${returnUrl}?checkout=success`,
        returnUrl,
      },
      {
        // Polar Checkout stays a same-tab redirect (unlike the portal below) — the user comes back
        // via `successUrl` on THIS route, so there is no separate tab to manage and no focus/
        // visibilitychange dance needed here.
        onSuccess: (data) => {
          if (data.taxIdRejected) {
            // Non-blocking — the checkout above still succeeded (backend retried it without the tax
            // id). See checkout-session.ts's own header for the VIES-absent franchise-en-base case
            // this actually names.
            toast.info(
              t(
                "settings.billing.messages.taxIdNotAccepted",
                "Your VAT number was not accepted by Polar (VIES); the checkout continues without it — Polar will ask for it if needed.",
              ),
            )
          }
          setNavigatingCheckoutSlug(interval)
          window.location.href = data.url
        },
        onError: (error) => {
          setNavigatingCheckoutSlug(null)
          if (apiErrorCode(error) === BILLING_EMAIL_TAKEN_CODE) {
            toast.error(
              t(
                "settings.billing.messages.billingEmailTaken",
                "Choose a distinct billing email for this company",
              ),
            )
            return
          }
          toast.error(
            error instanceof ApiError
              ? error.message
              : t("settings.billing.messages.checkoutError", "Failed to start checkout"),
          )
        },
      },
    )
  }

  const manageSubscription = () => {
    // Same-tab navigation to the Polar customer portal — no popup, no iframe (Polar's portal refuses
    // to be framed anyway). The button stays disabled + spinning from `openPortal.isPending` (the
    // request itself) through `navigatingPortal` (the redirect that follows) so there's no window for
    // a double click to fire a second portal-session request, and no gap where the button looks idle
    // while Polar is still loading.
    openPortal.mutate(undefined, {
      onSuccess: (data) => {
        setNavigatingPortal(true)
        window.location.assign(data.url)
      },
      onError: (error) => {
        setNavigatingPortal(false)
        if (apiErrorCode(error) === BILLING_NO_COMPANY_CUSTOMER_CODE) {
          // Should not normally be reachable — this button only renders while `hasCompanyCustomer` is
          // true — but the fact could have changed a moment ago; a translated notice beats the raw
          // backend message a real 2026-09-16 incident proved was reaching the user verbatim.
          toast.error(
            t(
              "settings.billing.messages.noCompanyCustomer",
              "This company has no billing customer yet — subscribe first.",
            ),
          )
          return
        }
        toast.error(
          error instanceof ApiError
            ? error.message
            : t("settings.billing.messages.portalError", "Failed to open the subscription portal"),
        )
      },
    })
  }

  const manageLegacySubscription = () => {
    // Same navigation discipline as `manageSubscription` above, targeting the OLD, pre-migration
    // per-user Polar customer instead (`POST /api/billing/portal/legacy`) — lets the OWNER/ADMIN cancel
    // it by hand once the company has its own, new subscription.
    openLegacyPortal.mutate(undefined, {
      onSuccess: (data) => {
        setNavigatingLegacyPortal(true)
        window.location.assign(data.url)
      },
      onError: (error) => {
        setNavigatingLegacyPortal(false)
        if (apiErrorCode(error) === BILLING_NO_COMPANY_CUSTOMER_CODE) {
          toast.error(
            t("settings.billing.messages.noLegacyCustomer", "No previous subscription was found to manage."),
          )
          return
        }
        toast.error(
          error instanceof ApiError
            ? error.message
            : t("settings.billing.messages.portalError", "Failed to open the subscription portal"),
        )
      },
    })
  }

  const saveBillingEmail = () => {
    setBillingEmail.mutate(
      { billingEmail: billingEmailDraft.trim() || null },
      {
        onSuccess: () =>
          toast.success(t("settings.billing.messages.billingEmailSaved", "Billing email saved")),
        onError: (error) =>
          toast.error(
            error instanceof ApiError
              ? error.message
              : t("settings.billing.messages.billingEmailSaveError", "Failed to save the billing email"),
          ),
      },
    )
  }

  // `PAST_DUE` with no `interval` means there is no REAL Polar subscription behind it at all — either
  // this company never had one (a legacy per-user subscription recovered by the backend,
  // `status-reconcile.ts`/`webhook-handlers.ts`'s own header) — as opposed to `PAST_DUE` WITH an
  // `interval` still set, a genuinely existing subscription Polar itself reports as failing to bill,
  // where the enum label ("Payment failed") stays the more useful, specific one. A concrete 2026-09-15
  // dev-instance incident showed the alternative: this block kept reading "Active · Yearly" for a
  // company with nothing left behind it at all — a ghost plan, not a real one.
  const hasNoRealSubscription = status.status === "PAST_DUE" && status.interval === null
  const statusLabel = hasNoRealSubscription
    ? t("settings.billing.noSubscription", "No subscription")
    : t(`settings.billing.status.${status.status}`, status.status)

  return (
    <SettingsPage
      title={t("settings.billing.title", "Subscription")}
      description={t("settings.billing.description")}
    >
      {/* Polar prices this product's two plans in USD regardless of the company's own `currency`
          (`documentation/docs/developer-guide/hosted-billing.md`'s own scope never covers pricing
          currency) — a plain, always-visible note rather than a conversion this app has no rate for
          (a card issuer applies its OWN exchange rate at charge time, not a rate this screen could
          ever reproduce exactly). */}
      <p className="text-sm text-muted-foreground" data-cy="billing-currency-notice">
        {t(
          "settings.billing.currencyNotice",
          "Prices are shown in USD. If your card is billed in another currency, your bank converts the charge at its own exchange rate.",
        )}
      </p>
      {/* Provider is in the French VAT franchise en base (art. 293 B CGI) — Polar, as merchant of
          record, is the one that determines and adds whatever VAT applies to the buyer at checkout. */}
      <p className="text-sm text-muted-foreground" data-cy="billing-vat-notice">
        {t(
          "settings.billing.vatNotice",
          "Prices exclude VAT; Polar, the merchant of record, adds the VAT applicable to your company at checkout.",
        )}
      </p>

      {status.legacySubscription && (
        <Alert variant="warning" data-cy="billing-legacy-notice">
          <AlertTitle>
            {t("settings.billing.legacyNotice.title", "Re-subscribe under this company")}
          </AlertTitle>
          <AlertDescription>
            <p>
              {t(
                "settings.billing.legacyNotice.description",
                "This subscription was created before this company had its own billing customer. Polar has no way to transfer it automatically — subscribe again below to move it onto this company.",
              )}
            </p>
            <p>
              {status.legacyPortalAvailable
                ? t(
                    "settings.billing.legacyNotice.cancelWithButton",
                    'Once you\'ve subscribed, cancel the previous subscription using "Manage the previous subscription" below.',
                  )
                : t(
                    "settings.billing.legacyNotice.cancelNoButton",
                    "Once you've subscribed, cancel the previous subscription from its own customer portal.",
                  )}
            </p>
          </AlertDescription>
        </Alert>
      )}

      <SettingsSection
        dataCy="billing-settings"
        title={
          <>
            {t("settings.billing.currentPlan", "Current plan")}
            <Badge variant={STATUS_VARIANT[status.status]} data-cy="billing-status-badge">
              {statusLabel}
            </Badge>
          </>
        }
        description={
          <>
            {t("settings.billing.seats", "{{count}} seat(s)", { count: status.seats })}
            {status.interval
              ? ` · ${t(`settings.billing.interval.${status.interval}`, status.interval)}`
              : ""}
            {status.legacySubscription
              ? ` · ${t("settings.billing.legacyNotice.previousCustomerSuffix", "previous customer")}`
              : ""}
          </>
        }
        footer={
          canManageBilling ? (
            <SettingsFormFooter>
              {/* Subscribe stays offered — as the SOLE primary action when this company has no billing
                  customer of its own yet, `status` alone (which can read ACTIVE off an unrelated legacy
                  customer, see `legacySubscription`) is never enough on its own to hide it. */}
              {(status.status !== "ACTIVE" || !status.hasCompanyCustomer) && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => subscribe("yearly")}
                    disabled={startCheckout.isPending || navigatingCheckoutSlug !== null}
                    data-cy="billing-subscribe-yearly"
                  >
                    {(startCheckout.isPending && startCheckout.variables?.slug === "yearly") ||
                    navigatingCheckoutSlug === "yearly" ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <ExternalLink />
                    )}
                    {t("settings.billing.subscribeYearly", "Subscribe yearly")}
                  </Button>
                  <Button
                    onClick={() => subscribe("monthly")}
                    disabled={startCheckout.isPending || navigatingCheckoutSlug !== null}
                    data-cy="billing-subscribe-monthly"
                  >
                    {(startCheckout.isPending && startCheckout.variables?.slug === "monthly") ||
                    navigatingCheckoutSlug === "monthly" ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <ExternalLink />
                    )}
                    {t("settings.billing.subscribeMonthly", "Subscribe monthly")}
                  </Button>
                </>
              )}
              {/* "Manage subscription" never renders without a company-scoped Polar customer to open a
                  portal session for — that used to surface `portal-session.ts`'s own raw
                  `PolarCustomerNotFoundError` message verbatim (2026-09-16 dev-instance incident). In
                  the legacy case, it is replaced by a button targeting the OLD, per-user customer
                  instead, so cancelling it never depends on finding that portal by hand.

                  ALSO requires `status === "ACTIVE"` (2026-09-15 incident, backend's own
                  `status-reconcile.ts`/`webhook-handlers.ts`): `hasCompanyCustomer` alone only means a
                  Polar customer object exists, not that it has anything to manage — a company whose
                  company-scoped customer has no active/trialing subscription must land on "Subscribe",
                  never a portal session that opens to Polar's own empty "No Active Subscriptions". */}
              {status.hasCompanyCustomer && status.status === "ACTIVE" && (
                <Button
                  variant={status.status === "ACTIVE" ? "default" : "secondary"}
                  onClick={manageSubscription}
                  disabled={openPortal.isPending || navigatingPortal}
                  data-cy="billing-manage-portal"
                >
                  {openPortal.isPending || navigatingPortal ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <ExternalLink />
                  )}
                  {t("settings.billing.managePortal", "Manage subscription")}
                </Button>
              )}
              {status.legacySubscription && status.legacyPortalAvailable && (
                <Button
                  variant="secondary"
                  onClick={manageLegacySubscription}
                  disabled={openLegacyPortal.isPending || navigatingLegacyPortal}
                  data-cy="billing-manage-legacy-portal"
                >
                  {openLegacyPortal.isPending || navigatingLegacyPortal ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <ExternalLink />
                  )}
                  {t(
                    "settings.billing.manageLegacyPortal",
                    "Manage the previous subscription (cancel it here)",
                  )}
                </Button>
              )}
            </SettingsFormFooter>
          ) : undefined
        }
      >
        {status.daysRemaining !== null && (
          <p className="text-sm text-muted-foreground" data-cy="billing-days-remaining">
            {t("settings.billing.daysRemaining", "{{count}} day(s) remaining", {
              count: status.daysRemaining,
            })}
          </p>
        )}
        {status.seatPaymentFailureExplainsStatus && (
          <p className="text-sm text-destructive" data-cy="billing-seat-payment-failed-notice">
            {t(
              "settings.billing.seatPaymentFailedNotice",
              "We couldn't charge your card for the seat you just added — update your payment method below.",
            )}
          </p>
        )}
        {!canManageBilling && (
          <p className="text-sm text-muted-foreground" data-cy="billing-member-notice">
            {t(
              "settings.billing.memberNotice",
              "Only the company's owner or an admin can manage the subscription.",
            )}
          </p>
        )}
      </SettingsSection>

      {canManageBilling && (
        <SettingsSection
          dataCy="billing-email-settings"
          title={t("settings.billing.billingEmail.title", "Billing email")}
          description={t(
            "settings.billing.billingEmail.description",
            "Used for this company's own Polar customer. Defaults to the company's contact email — set a distinct one if another company already uses it.",
          )}
          footer={
            <SettingsFormFooter>
              <Button
                onClick={saveBillingEmail}
                disabled={setBillingEmail.isPending}
                data-cy="billing-email-save"
              >
                {setBillingEmail.isPending ? <Loader2 className="animate-spin" /> : null}
                {t("settings.billing.billingEmail.save", "Save")}
              </Button>
            </SettingsFormFooter>
          }
        >
          <div className="space-y-2">
            <Label htmlFor="billing-email-input">
              {t("settings.billing.billingEmail.label", "Billing email")}
            </Label>
            <Input
              id="billing-email-input"
              type="email"
              data-cy="billing-email-input"
              placeholder={billingEmail?.companyEmail}
              value={billingEmailDraft}
              onChange={(event) => setBillingEmailDraft(event.target.value)}
            />
          </div>
        </SettingsSection>
      )}
    </SettingsPage>
  )
}
