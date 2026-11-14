---
sidebar_position: 12
---

# Hosted billing

Invoicerr is self-hosted-first: everything below is invisible and inert on any instance that never
sets `WARNING__ENABLE_BILLING_FOR_USERS__WARNING` (`backend/src/modules/billing/billing-flag.ts`): no
`/api/billing/*` route, no Settings tab, no banner, no lifecycle sweep, no Stripe plugin registered.
This page documents the operator's own hosted offering, billed through Stripe.

Invoicerr bills per **company**, never per user: a company's subscription is a Stripe subscription
whose `referenceId` is the company id.

## Lifecycle

`CompanySubscription` holds the company's billing state, independent of the payment provider. The
lifecycle sweep (`billing-lifecycle-sweep-runner.ts`) walks it forward through two cycles, whose
decisions live in the pure `lifecycle.ts`:

1. **Never paid**: `TRIAL` (14 days, everything allowed except sending) then `BLOCKED` (14 days,
   read-only) then `ZIPPED` (a full export is emailed) then deleted 30 days later.
2. **Paid then stopped**: `ACTIVE` then `PAST_DUE` once the subscription stops renewing. The period
   already paid for still runs to its end (`paid-period-grace.ts`), then `BLOCKED`, `ZIPPED`, and
   deletion 180 days after the export.

`firstPaidAt` tells the two cycles apart: it is stamped the first time a company pays and never
cleared. `lastBillingFactAt` is the compare-and-set anchor that keeps a sweep from overwriting a
fresher provider fact. Moving a company to `ACTIVE` or `PAST_DUE` is a fact the payment provider
reports through the Stripe webhook; the sweep never does it on its own.

## Seats: Invoicerr only ever reads the quantity, never writes it

The bought quantity lives in the company's subscription and is changed by the OWNER through billing;
Invoicerr only reads it into `CompanySubscription.seats`. A company still in `TRIAL` has the schema
default of 1 seat, the one seat every plan includes.

**Capacity vs. headcount** are two different numbers: `CompanySubscription.seats` is what was bought,
`UserCompany` row count is who actually joined. `seat-sync.ts#withSeatReservation` wraps every NEW
membership (company creation, invitation acceptance, SSO auto-provisioning) in one transaction that
refuses with `NoFreeSeatError` (surfaced as `NO_FREE_SEAT`) once headcount would exceed the bought
quantity — invitations.service.ts's own `useInvitation` and lib/auth.ts's
`markInvitationAsUsed`/`attachSsoProvisionedMembership` translate it into a `403`/`APIError`
respectively. The SAME transaction assigns the new row the lowest free desk number
(`UserCompany.seatIndex`), a purely cosmetic position on the company's own generative "Settings > Seats"
floor plan — a top-view SVG room, desks in face-to-face pairs, one deterministically-furnished desk per
(`companyId`, `seatIndex`) pair (never `Math.random()` at render — `seats/desk-rng.ts`). A desk number
never grants or revokes access — `seat-holders.ts#seatHolders` decides who is actually SEATED purely
from role + arrival order (`UserCompany.createdAt`), completely ignoring `seatIndex`.

**Over capacity** (the OWNER lowers the bought quantity below the current headcount) is handled the same way: members are ranked (OWNERs first, then everyone else, each in
arrival order) and the bought quantity is a hard ceiling on how many of them hold a seat, so a role is a
priority over the seats bought, never an exemption from buying one (promoting the whole company to
OWNER seats nobody extra). The single exception is the longest-standing OWNER, who keeps a seat even at
zero capacity so somebody can always log in and buy seats back. Whoever waits gets their seat back
automatically (no action needed) the moment a seat frees up or is bought back. One user in one company is
one seat, and a member with no seat can do nothing on that company, not even read (product decision
2026-11-13): `company-write.guard.ts`/`seat-gate.ts` refuse every request on the active company, reads
included, with 403 `SEAT_REQUIRED`, whether it comes from a session or from an API key that member
created. `GET /api/billing/seats` answers that same refusal, and `(app)/_layout.tsx` turns it into a
full-app "Your company doesn't have enough seats" takeover (`not-enough-seats-screen.tsx`) whose only
action is signing out. Only routes marked `@SeatGateExempt()` skip the check: today the legal controller,
which is about the user, never the company. The `BLOCKED`/`ZIPPED` check (`COMPANY_BLOCKED`) stays
write-only and runs first on a write.

**Unused seats.** When the company pays for more seats than it has members, OWNER and ADMIN see a red
banner at the top of Settings (`unused-seats-banner.tsx`) with the number of unused seats and a link to
Billing. A MEMBER never sees it. Invoicerr never changes the quantity itself: the fix is lowering it in
the billing portal, or inviting someone.

**The gate does not apply before a company exists** (issue #535). `GET /api/billing/seats` is guarded by
`@ActiveCompany()`, which answers 403 for a session with no active company, the state a freshly
signed-up user is in for as long as it takes the onboarding dialog to create their first company.
`(app)/_layout.tsx` used to enable that query unconditionally the moment a session existed, so this
403 landed in the same bucket as a genuine outage and showed a full-screen "Couldn't check your seat"
retry screen instead of ever reaching the onboarding dialog that would have fixed the underlying "no
company yet" state. The frontend now reads `activeCompanyId` off the SAME session payload
(`customSession`, `lib/auth.ts`) it already has in hand and only enables `useSeats`, and only applies
the gate, once that id is set.

## Who can act

Only company members with role `OWNER` or `ADMIN` can subscribe, cancel or open the customer portal.
A plain MEMBER sees the current plan and status read-only in Settings > Subscription.

## Multi-company users

A user who belongs to several companies sees only the **active** company's subscription, resolved
server-side via `@ActiveCompany()`, never from a client-supplied company id.

## Stripe through Better Auth

Stripe Billing is wired through the official `@better-auth/stripe` plugin, registered in
`backend/src/lib/auth.ts` only when `WARNING__ENABLE_BILLING_FOR_USERS__WARNING` is set. The plugin
owns checkout, the customer portal, webhook signature checks and the `subscription` table.

- **Configuration**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and the standard grid of the price
  catalog below are required once billing is enabled, and the backend refuses to boot without them. A live key is refused unless
  `STRIPE_MODE=live`, so a deployment cannot charge real cards by accident.
- **Webhook**: point a Stripe webhook endpoint at `<APP_URL>/api/auth/stripe/webhook`. Our own body
  parsers skip `/api/auth`, so the plugin reads the raw body it needs for the signature.
- **Who can act**: a subscription's `referenceId` is a company id. Owners and admins of that company
  can subscribe, cancel, restore and open the portal; any member can list the subscription; anyone
  else is refused.
- **Whose Stripe customer**: always the company's, never the one of the owner or admin who clicks.
  Every call sends `customerType: "organization"`, the plugin's organization customer type, and the
  backend refuses a call without it. The plugin's `organization` model is mapped onto the `Company`
  table (`schema: { organization: { modelName: "company" } }`), so the customer id lives in
  `Company.stripeCustomerId`. The first checkout creates that customer with the company's name and
  email; every later checkout and every portal session reuses it, whichever manager opens it. The
  Better Auth organization plugin is not used: the Stripe plugin logs "Organization plugin not found"
  once at boot and skips only the member and name sync hooks that plugin would carry.
- **Customer Portal**: card and SEPA Direct Debit, invoice history, seat quantity and cancellation
  are what the portal offers once they are enabled in the Stripe dashboard (Settings > Billing >
  Customer portal). Settings > Subscription opens it for owners and admins.

### Subscription state on the company

The plugin's subscription hooks (complete, created, updated, deleted) are mirrored onto the company's
own row by `backend/src/modules/billing/stripe-subscription-sync.ts`:

- Stripe `active` or `trialing` makes the company `ACTIVE`; any other status makes it `PAST_DUE`,
  and the lifecycle above takes over from there.
- `seats` is the subscription quantity and `interval` the plan price's interval.
- `currentPeriodEnd` is only taken from a fact that still reports the subscription as paid.
- The first paid fact stamps `firstPaidAt`, which is never cleared. A paid fact also clears the
  suspension and deletion clocks.
- Each fact carries the Stripe event's time. A fact older than the last one applied is dropped.
- A non-paid fact changes nothing for a company still inside its own trial, for one already
  suspended or archived, or while the company has another subscription that is paid.

Deleting a company, from the lifecycle sweep or by its owner, first cancels every Stripe
subscription it still has (`stripe-subscription-cancel.ts`). If Stripe refuses, nothing is deleted.

## Stripe price catalog

The hosted subscription is moving to Stripe Billing. Prices are configured, not coded: each one is a
Stripe price id read from the environment (see `backend/.env.example`), and the amounts live in the
Stripe dashboard.

There are two grids, `standard` and `founder`, each with a monthly and a yearly price, read from
`STRIPE_PRICE_<GRID>_<INTERVAL>`. The standard grid is required; the founder grid is optional but all
or nothing. Every price id must be distinct, so any price on a subscription maps back to exactly one
grid and interval.

Each price is billed per seat in graduated tiers: the first seat, seats 2 to 4, and seat 5 onwards,
each tier with its own unit amount. The subscription quantity is the seat count and Stripe computes
the total, so twelve seats are billed as 1 seat at the first tier, 3 at the second and 8 at the third.

To set up a test catalog, create four recurring prices in Stripe test mode, in EUR, with
"Graduated pricing" and the three tiers above (up to 1, up to 4, then infinity), with each yearly
amount at ten times the monthly one.

### Plans

Each configured grid becomes one plan of the plugin, named after the grid: `standard`, and `founder`
when the founder grid is set. A plan's price is the grid's monthly price and its annual price the
yearly one, so a checkout picks the interval with `annual: true`. The seat count is the subscription
quantity; no plan carries a separate seat price.

### Founder grid

The founder grid is applied per company and kept for as long as the company renews without
interruption (`modules/billing/founder-grid.ts`).

- **Granting**: the operator runs `npm run billing:grant-founder -- <companyId>` in the backend
  directory (the Docker image ships `backend/scripts` and runs them with `tsx`). It stamps
  `CompanySubscription.founderGrantedAt`. Claiming a founder pre-order grants it too (below).
- **Checkout**: only an OWNER or ADMIN of a company that holds the grid may check out on the `founder`
  plan; the backend refuses it to every other company. `GET /api/billing/status` returns `priceGrid`
  (`founder` or `standard`) and Settings > Subscription checks out on that plan.
- **Losing it**: the first time a founder-plan subscription of the company ends (Stripe `canceled`),
  `founderLostAt` is stamped and the company is back on the standard grid for good. A failed payment
  that Stripe still retries (`past_due`, `unpaid`), a cancellation scheduled for the period end and
  withdrawn before it, an abandoned checkout and a switch between the monthly and yearly founder
  prices do not end it. Granting it again after a loss is refused.

### Founder pre-orders

A founder pre-order is a subscription paid in advance, before the hosted service opens
(`modules/billing/founder-preorder.ts`). Its prepaid period starts on the opening date, then the
subscription renews on the founder grid.

- **Paying**: a one-off Stripe Checkout payment (mode `payment`) with a Stripe customer attached and
  the metadata `invoicerr_preorder=founder`, `seats` (a positive integer) and `interval` (`monthly` or
  `yearly`). How the session is created (a Payment Link, the public site) is outside the backend.
- **Recording**: the Stripe webhook stores one `FounderPreorder` row per paid session
  (`checkout.session.completed`, or `checkout.session.async_payment_succeeded` for a delayed payment
  method). Replays land on the same row. A paid session missing one of the fields above is logged as
  an error for the operator and not recorded.
- **Claiming**: once the buyer's company exists, the operator runs
  `npm run billing:claim-preorder -- <preorderId> <companyId>`. The company gets the founder grid and
  a Stripe subscription on the founder price for the interval bought, quantity = the seats paid for,
  in trial until `BILLING_OPENING_DATE` + one interval, so the prepaid period is not charged again.
  The webhook mirrors it like any other subscription and the company is ACTIVE, paid through the end
  of that period. A pre-order claimed after its prepaid period is billed from the claim on. The
  subscription goes on the company's own Stripe customer; a company without one takes the
  pre-order's.
- **Refused claims**: a pre-order already claimed, a company that already has a live subscription,
  a company that lost the founder grid, or a pre-order whose Stripe customer already bills another
  company. Nothing is charged or written in those cases. Refunds stay a manual operation in Stripe.

