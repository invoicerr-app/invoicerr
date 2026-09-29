---
sidebar_position: 12
---

# Hosted billing (Polar)

Invoicerr is self-hosted-first: everything below is invisible and inert on any instance that never
sets `WARNING__ENABLE_BILLING_FOR_USERS__WARNING` (`backend/src/modules/billing/billing-flag.ts`) — no
`/api/billing/*` route, no Settings tab, no banner, no lifecycle sweep, no Polar client constructed.
This page documents the operator's own hosted offering.

## API version: `2026-10`, and how to upgrade it

Every Polar API call goes through the one shared client in `polar-client.ts` (`getPolarClient()`),
built with `@polar-sh/sdk` **1.x**'s versioned client factory: `createPolar()` imported from the
dated subpath `@polar-sh/sdk/2026-10` (never the bare `@polar-sh/sdk`, which 1.x no longer even
exports a client class from). The import path itself pins the contract: the SDK stamps
`Polar-Version: 2026-10` on every request from that subpath automatically; there is no runtime
`version` option, no manual header hook the way the pre-1.0 SDK needed one (PR #536's fix, retired by
#537).

`POLAR_API_VERSION` (same file) is kept as the one greppable constant documenting which version that
is, asserted against in `polar-client.spec.ts`, but it is documentation, not configuration:
changing it alone does nothing. Upgrading to the next quarterly version (`2027-01`, Current some
time after 2027-01-01 per Polar's own versioning cadence: first week of January, April, July and
October, each version roughly nine months total as Next, then Current, then Deprecated) means, together,
in one PR:

1. Read Polar's own API changelog (`https://polar.sh/docs/changelog/api.md`) for every entry under
   the new version, and its versioning guide
   (`https://polar.sh/docs/api-reference/<version>/versioning.md`) for anything procedural that
   changed.
2. Change the import in `polar-client.ts` from `@polar-sh/sdk/2026-10` to the new dated subpath, and
   `POLAR_API_VERSION` to match.
3. Update every request/response field this module touches for anything the changelog actually
   changed (checkouts, subscriptions/seats, customers/customer sessions/portal, products, webhooks):
   `@polar-sh/sdk`'s own shipped `.d.cts` files under the new dated subpath are the source of truth
   for exact field names; grep this directory for the old version's snake_case field names to find
   every call site.
4. Upgrade the webhook endpoint's own `api_version` on Polar's side (see "Webhooks" below): a
   separate setting from the API version this backend's own outgoing calls use, upgraded independently.
5. Re-run `polar-client.spec.ts` (its own header-assertion tests) and, with a sandbox
   `POLAR_ACCESS_TOKEN` available, every `*.live.spec.ts` in this module. A mocked-only green run
   proves the TypeScript compiles against the new types, not that a real request still round-trips.

### #537 migration notes (2026-09-29, `2026-04` to `2026-10`)

`@polar-sh/sdk` moved from `0.49` (pre-1.0, camelCase-mapped request/response fields, a `Polar` class
you `new` up) to a stable `1.0.0`: the wire's own snake_case throughout (`external_customer_id`,
`customer_billing_address`, `current_period_end`, and so on), and `customers.getExternal(id)`/
`subscriptions.get(id)`-style positional ids instead of `{ externalId }` wrapper objects everywhere.
`@polar-sh/better-auth` was removed as a dependency in the same change: nothing in `backend/src`
imported it (confirmed by PR #540 first, re-confirmed here), and it peer-depends on
`@polar-sh/sdk ^0.47.0`, which is incompatible with the 1.x this backend now ships.

Polar's own API changelog for `2026-10` (`https://polar.sh/docs/changelog/api.md`, read directly)
lists exactly two entries: the `secret` parameter removed from webhook-endpoint create/update (Polar
now generates it), and `member_id`/`member` added to license-key responses. Neither touches
checkouts, subscriptions/seats, customers, customer sessions/portal, or a `subscription.*` webhook's
own payload shape. This backend's actual request/response field changes below come entirely from the
SDK's 0.49-to-1.0 architecture change, not from anything Polar's `2026-10` contract itself redefines.

A real behavior change found only by testing against the live sandbox, not by reading types:
`@polar-sh/sdk@1.0.0`'s HTTP client defaults every request to a 5-second timeout when none is given
(0.49 had none unless explicitly set). A checkout that sends a `customer_tax_id` Polar has to
validate against VIES (the EU's live VAT-registration lookup, see `checkout-tax-id.ts`'s own header)
routinely takes longer than 5 seconds. The same sandbox call that worked under 0.49 failed with
`PolarNetworkError: The operation was aborted due to timeout` under the bare 1.0.0 default.
`getPolarClient()` now passes `timeout: 30` (seconds) explicitly to cover this without going back to
0.49's effectively unbounded wait.

## One Polar customer per COMPANY (option A, 2026-09-16)

Invoicerr bills per **company**, never per user. Each company that ever starts a checkout gets its own
Polar customer, `external_id = company.id`, created lazily on the first checkout attempt
(`backend/src/modules/billing/billing-customer.ts`) — never at user sign-up. Checkout and the customer
portal are plain Nest routes calling the raw `@polar-sh/sdk` client directly
(`checkout-session.ts`/`portal-session.ts`), not `@polar-sh/better-auth`'s plugin: that plugin
hard-codes the checkout/portal customer to the session's OWN user, which cannot express "bill this
company" at all.

### Billing email

A company's Polar customer email defaults to its own contact `email`. Polar requires a customer's
email to be unique **within the organization** — two Invoicerr companies sharing one contact address
(one owner running several companies, e.g.) collide on the second company's first checkout. The
optional `Company.billingEmail` field (Settings > Billing) is the escape hatch: when set, it takes
priority over `email` for the Polar customer. A collision surfaces as a named `409` with
`code: "BILLING_EMAIL_TAKEN"` from `POST /api/billing/checkout`, and the Settings screen shows
"Choose a distinct billing email for this company".

A company with **neither** a `billingEmail` override **nor** a contact `email` on file is refused
before this module ever calls Polar: `POST /billing/checkout` and `POST /billing/portal` answer `422`
with `code: "BILLING_EMAIL_MISSING"` (`MissingBillingEmailError`, `billing-customer.ts`), and the
Settings screen shows that error's own message verbatim. Before this guard existed, the empty string
reached Polar directly, which refused it with its own 422 ("An email address must have an @-sign")
that nothing on the checkout path caught — surfacing to the user as an opaque `500`. The Settings
screen's billing-email field now prefills from the same priority order the backend resolves by: the
saved override, then the company's own contact email, then the signed-in user's own account email —
always a visible, editable value in the form, never a silent server-side substitution.

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

## Seats — Invoicerr only ever READS the quantity, never writes it

Invoicerr never tells Polar how many seats to bill. The bought quantity lives in Polar's own
subscription and is entirely the OWNER's own affair, changed in the Polar portal — this app only reads
it, via two paths: a `subscription.*` webhook's own `seats` field (`webhook-handlers.ts`), and
`seat-reconcile.ts`'s opportunistic SDK read once per lifecycle-sweep tick for every `ACTIVE`,
subscribed company (the retry for the rare case a webhook was missed). Neither ever calls
`subscriptions.update` with a seat count — `seat-sync.ts`/`seat-reconcile.ts`'s own file headers, and
`no-seat-quantity-write.spec.ts`, a standing file-content guard scanning the whole billing module for a
`subscriptions.update(...)` call that sets a `seats` field. A company still in `TRIAL` (no Polar
subscription to read from at all) has the schema default of 1 seat — the one seat every plan includes.

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

**Over capacity** — the OWNER lowers the bought quantity in the Polar portal below the current
headcount — is handled the same way: members are ranked (OWNERs first, then everyone else, each in
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

**Boot-time provisioning failures now log their real cause** (issue #535). `LoggerService.warn`/`.error`
(`backend/src/logger/logger.service.ts`) only ever print `[category] message` to the process's own
stdout; the structured `details` object lands in the `Log` table only, one click away in Settings > Logs
but invisible to `kubectl logs`. `customer-provisioning.ts`'s own boot/sweep-tick pass
(`BillingCustomerProvisioningBootService`) used a static message for every Polar failure, so a pod's own
console showed "Polar customer provisioning failed for one company, retried next pass" with no cause at
all. The three call sites there that reach out to Polar now embed the HTTP status and Polar's own
message (never a header or token, see `polar-client.ts`'s own `sanitizePolarError`) directly in the
logged message.

## Webhooks

`POST /api/billing/webhooks/polar` (own controller, not better-auth's) resolves which company a
subscription event belongs to primarily from the checkout's own customer `external_id` (present on the
webhook's wire payload, under `data.customer.external_id`), falling back to `metadata.companyId` —
never from the user. `status-reconcile.ts`'s own repair path (for a status the webhook never updated)
filters Polar's subscription list by `external_customer_id = company.id`, never by a raw customer id, so
it can never read another company's subscription even if two companies happened to share a Polar
customer.

This controller parses the raw webhook body itself (`polar-webhook-verify.ts`, own signature
verification that predates and is independent of the SDK version) rather than going through
`@polar-sh/sdk`'s own `webhooks.validateEvent`, so a `subscription.*` event's payload fields never
depend on which SDK version this backend ships. Polar's `2026-10` API changelog changes nothing about
that payload shape (see "API version" above); #537 needed no field changes here, only the client-side
`POLAR_API_VERSION` bump.

### The webhook endpoint's own `api_version`

A Polar webhook endpoint carries its own `api_version`, chosen when the endpoint is created and
determining the shape of every event payload it is sent from then on, independent of the
`Polar-Version` header this backend's own outgoing API calls use. Existing endpoints stay pinned to
whatever version they were created under; Polar does not migrate them automatically. This backend's
own code never changes an endpoint's `api_version`: that is the operator's action, on Polar's side
(the automated code in this repository has no API token scoped to manage webhook endpoints, and
should not: this is a one-time, infrequent, deliberate operator action, not something a deploy should
silently do).

To move the beta's own endpoint from `2026-04` to `2026-10`, the operator does one of:

- **Dashboard** (simplest): Polar dashboard, Settings, Webhooks, the endpoint receiving
  `<APP_URL>/api/billing/webhooks/polar`, then change the "API Version" field to `2026-10` and save.
- **API**: `PATCH /v1/webhooks/endpoints/{id}` with body `{"api_version": "2026-10"}`, using an
  organization-scoped access token (`webhooks.updateWebhookEndpoint(id, { api_version: "2026-10" })`
  in `@polar-sh/sdk@1.0.0` terms, confirmed by reading the SDK's own shipped source, not merely its
  types).

Either way, Polar's own docs are explicit that the change applies only to events created afterward: a
delivery already queued, or an event already fired, keeps the shape it was created with. There is no
cutover moment to coordinate around; this backend's wire parsing needs no change for `2026-10`
regardless (see above), so the endpoint's own `api_version` can be moved at any time without a
matching code deploy.

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
