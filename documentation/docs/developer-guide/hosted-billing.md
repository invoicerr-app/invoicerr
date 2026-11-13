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
automatically (no action needed) the moment a seat frees up or is bought back. A member currently WAITING is refused every write via
`company-write.guard.ts`/`seat-gate.ts` (403, `SEAT_REQUIRED`) and sees a full-app "waiting for a seat"
takeover (`(app)/_layout.tsx`, driven by `GET /api/billing/seats`) naming the OWNER — the same
gate `write-gate.ts#assertCompanyWritable`'s `COMPANY_BLOCKED` already holds for a blocked company,
checked right alongside it.

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

- **Configuration**: `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are required once billing is
  enabled, and the backend refuses to boot without them. A live key is refused unless
  `STRIPE_MODE=live`, so a deployment cannot charge real cards by accident.
- **Webhook**: point a Stripe webhook endpoint at `<APP_URL>/api/auth/stripe/webhook`. Our own body
  parsers skip `/api/auth`, so the plugin reads the raw body it needs for the signature.
- **Who can act**: a subscription's `referenceId` is a company id. Owners and admins of that company
  can subscribe, cancel, restore and open the portal; any member can list the subscription; anyone
  else is refused.

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
