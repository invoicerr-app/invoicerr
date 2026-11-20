import type { CompanySubscriptionStatus } from "./use-billing"

/** Chip tone per subscription status - a lifecycle, not a binary "good/bad": `success` while paying,
 *  `info` for a trial (informational, not yet an ask), `warning` once payment itself needs attention,
 *  `destructive` once the company stopped functioning, `secondary` (muted) once it's gone and there's
 *  nothing left to act on. */
export const STATUS_BADGE_VARIANT: Record<
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

export interface BillingBannerAppearance {
  destructive: boolean
  titleKey: string
  descriptionKey: string
}

const PAST_DUE_BANNER: BillingBannerAppearance = {
  destructive: false,
  titleKey: "billing.banner.pastDue.title",
  descriptionKey: "billing.banner.pastDue.description",
}

/** What the app-wide billing banner shows per status. ACTIVE shows no banner at all (`billing-banner.tsx`);
 *  every status without its own wording, DELETED included, falls back to the past-due one. Keys stay
 *  literal and complete so a key search finds them. */
export const BILLING_BANNER_APPEARANCE: Record<
  Exclude<CompanySubscriptionStatus, "ACTIVE">,
  BillingBannerAppearance
> = {
  TRIAL: {
    destructive: false,
    titleKey: "billing.banner.trial.title",
    descriptionKey: "billing.banner.trial.description",
  },
  BLOCKED: {
    destructive: true,
    titleKey: "billing.banner.blocked.title",
    descriptionKey: "billing.banner.blocked.description",
  },
  ZIPPED: {
    destructive: true,
    titleKey: "billing.banner.zipped.title",
    descriptionKey: "billing.banner.zipped.description",
  },
  PAST_DUE: PAST_DUE_BANNER,
  DELETED: PAST_DUE_BANNER,
}
