-- Polar's own `Subscription.currentPeriodEnd`, mirrored onto `company_subscription` so the Terms of
-- Service Section 20.2 exception (a Company with a subscription period already in progress keeps full
-- write access under the version it paid for until the later of a calendar floor or this date,
-- `paid-period-grace.ts`) has something to read. Nullable and additive: every existing row reads back
-- NULL, which `paid-period-grace.ts#paidPeriodBindingDate` already treats as "no protectable period on
-- file" — never as a false grant of the exception — until the next subscription webhook/reconcile read
-- fills it in.
ALTER TABLE "company_subscription" ADD COLUMN "currentPeriodEnd" TIMESTAMP(3);
