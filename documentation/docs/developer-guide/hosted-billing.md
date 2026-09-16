---
sidebar_position: 12
---

# Hosted billing (Polar)

Invoicerr is self-hosted-first: everything below is invisible and inert on any instance that never
sets `WARNING__ENABLE_BILLING_FOR_USERS__WARNING` (`backend/src/modules/billing/billing-flag.ts`) — no
`/api/billing/*` route, no Settings tab, no banner, no lifecycle sweep, no Polar client constructed.
This page documents the operator's own hosted offering.

## One Polar customer per COMPANY (option A, 2026-09-16)

Invoicerr bills per **company**, never per user. Each company that ever starts a checkout gets its own
Polar customer, `external_id = company.id`, created lazily on the first checkout attempt
(`backend/src/modules/billing/billing-customer.ts`) — never at user sign-up. Checkout and the customer
portal are plain Nest routes calling the raw `@polar-sh/sdk` client directly
(`checkout-session.ts`/`portal-session.ts`), not `@polar-sh/better-auth`'s plugin: that plugin
hard-codes the checkout/portal customer to the session's OWN user, which cannot express "bill this
company" at all.

Seats (`Company`'s own `UserCompany` rows) and Polar's own seat-based price are kept in sync by
`seat-sync.ts` on every membership change, and opportunistically reconciled once per lifecycle-sweep
tick by `seat-reconcile.ts` for every `ACTIVE`, subscribed company — the retry for the rare case a
membership change's own synchronous push failed and nothing else touched membership afterward.

### Billing email

A company's Polar customer email defaults to its own contact `email`. Polar requires a customer's
email to be unique **within the organization** — two Invoicerr companies sharing one contact address
(one owner running several companies, e.g.) collide on the second company's first checkout. The
optional `Company.billingEmail` field (Settings > Billing) is the escape hatch: when set, it takes
priority over `email` for the Polar customer. A collision surfaces as a named `409` with
`code: "BILLING_EMAIL_TAKEN"` from `POST /api/billing/checkout`, and the Settings screen shows
"Choose a distinct billing email for this company".

## Who can touch Polar

Only company members with role `OWNER` or `ADMIN` can start a checkout or open the customer portal —
`@Roles(CompanyRole.OWNER, CompanyRole.ADMIN)` on `BillingController`'s own `POST /billing/checkout`
and `POST /billing/portal`. A plain `MEMBER` never calls Polar at all; they only count toward the
billed seat quantity (`seat-sync.ts`).

### The portal opens for the CLICKING user's own Polar member

Once a company's Polar customer is promoted to `type: "team"` (Polar's own automatic promotion on the
first seat-based checkout), a customer-portal session requires a `memberId`. Invoicerr resolves — and,
if needed, creates — the Polar member that corresponds to the **clicking** OWNER/ADMIN, never
unconditionally the auto-created owner member (`member-resolution.ts`). Resolution order:

1. A member this app itself created before, addressable by its own `externalId = user.id`.
2. Polar's own auto-created owner member (minted from "the customer's email and name" on the first
   seat-based checkout, with no `externalId` Invoicerr ever set) — matched by **email**. Polar's own
   `MemberUpdate` schema has no `externalId` field, so this match can never be backfilled with our own
   external id; it is simply used by its own Polar-internal id from then on.
3. Neither matches — a fresh member is created, keyed by `externalId = user.id`.

A company whose Polar customer has never been promoted past `type: "individual"` (never checked out)
opens the portal without any `memberId` at all.

### Member sync follows company roles

`member-sync.ts#syncCompanyMemberOnMembershipChange` keeps Polar team-customer members in sync with
who holds `OWNER`/`ADMIN` in an **already-subscribed** company (a no-op before the company's first
checkout, or before Polar promotes the customer to `team`): a user promoted to `OWNER`/`ADMIN` gets a
Polar member; demoted to `MEMBER`, or removed from the company, loses it. Called from every place a
`UserCompany` row is created, changed, or removed — company creation, invitation acceptance, SSO
auto-provisioning, a role change, member removal, and account deletion. Member creation and deletion
both go through the SDK's `PolarMembers` operations (`create`/`createExternal`,
`delete`/`deleteExternal`) — never blocking the membership write itself: a Polar failure here is logged
and left for the next membership change to retry.

## Webhooks

`POST /api/billing/webhooks/polar` (own controller, not better-auth's) resolves which company a
subscription event belongs to primarily from the checkout's own customer `external_id` (present on the
webhook's wire payload, under `data.customer.external_id`), falling back to `metadata.companyId` —
never from the user. `status-reconcile.ts`'s own repair path (for a status the webhook never updated)
filters Polar's subscription list by `externalCustomerId = company.id`, never by a raw customer id, so
it can never read another company's subscription even if two companies happened to share a Polar
customer.

## No automatic migration for pre-2026-09-16 subscriptions

Before this change, a company's subscription was attached to its OWNER's own **user**-level Polar
customer. Polar exposes no API to transfer a subscription (or a customer) onto a different
`external_id` — checked directly against the SDK's available operations. A company whose stored
`polarCustomerId` still points at that old customer is detected (`legacy-customer.ts`, by comparing the
company's own external-id-keyed customer against the one actually stored — no live check needed for a
company that never subscribed) and surfaced as `legacySubscription: true` on `GET /api/billing/status`.
The Settings screen shows a plain notice: subscribe again to move the company onto its own,
company-scoped customer. There is no automatic migration.

## Multi-company users

A user who belongs to several companies has a separate Polar member (and, once each company checks
out, a separate portal) per company — the Billing settings screen only ever shows the **active**
company's status, checkout, and portal, resolved server-side via `@ActiveCompany()`, never from a
client-supplied company id.
