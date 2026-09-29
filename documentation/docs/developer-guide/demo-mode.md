---
sidebar_position: 13
---

# Demo mode

`DEMO_MODE` turns an Invoicerr instance into a public demo: a fixed account, a realistic dataset
rebuilt on a schedule, and every outbound send refused outright. It exists for exactly one purpose —
letting a stranger try the product on the internet — and must never be set on a real, self-hosted
install.

:::danger[Never on a real instance]
Turning `DEMO_MODE` on makes the demo account's e-mail and password unchangeable, refuses new
sign-ups outright, and blocks every e-mail, e-invoicing transport, webhook, tax-authority declaration
and payment checkout session this instance could otherwise send. None of that is what a real
self-hosted operator wants. This flag is for the one instance at `demo.invoicerr.app` and nothing
else.
:::

## What it does

### Every outbound send is refused

Set `DEMO_MODE=true` and the following are refused at the lowest layer each one shares with every
other caller — a transport or provider added later is covered automatically, because the refusal
lives in the shared chokepoint, not in each caller:

| What | Refused in |
| --- | --- |
| Every e-mail (document sends, reminders, signature requests, OTP codes, client-portal invites, data exports…) | `MailService.sendMail`/`sendForCompany` (`backend/src/mail/mail.service.ts`) |
| Every e-invoicing transport (email, PDP, Iopole, KSeF, SdI, SdI-PEC, A-Cube, Chorus Pro, Invopop, Billit, and any third-party transport registered later) | `TransportRegistry.register` (`backend/src/modules/documents/transports/transport-registry.ts`) |
| Every outbound webhook | `WebhooksService.send` (`backend/src/modules/webhooks/webhooks.service.ts`) |
| Every tax-authority declaration (Portugal's AT, and any provider registered later) | `DeclarationProviderRegistry.register` (`backend/src/modules/documents/reporting/declaration-provider.ts`) |
| Every card/online payment checkout session (Stripe, Mollie, PayPal, and any provider registered later) | `PaymentProviderRegistry.register` (`backend/src/modules/documents/payments/payment-provider-registry.ts`) |
| Every Polar billing call | `getPolarClient` (`backend/src/modules/billing/polar-client.ts`) |

A refused action never looks like it worked: it returns a clear `403` naming what is disabled
(`DEMO_MODE_BLOCKED`), never a silent success.

Billing is forced off outright, independently of `WARNING__ENABLE_BILLING_FOR_USERS__WARNING`: no
paywall, no seat gate, no Polar call, whatever that flag happens to be set to in the same environment
— see `backend/src/modules/billing/billing-flag.ts#isBillingEnabled`.

Self-hosted, local OCR on an uploaded received invoice is **not** blocked by `DEMO_MODE` — nothing
leaves the instance as long as the OCR container itself runs inside the demo's own namespace, which is
an infrastructure decision outside the product's own scope.

### The demo account cannot be taken over

While `DEMO_MODE` is on:

- The account's e-mail and password can never be changed (`POST /api/auth/change-email`,
  `POST /api/auth/change-password`, and `POST /api/auth-extended/set-password` for an SSO-only account
  all refuse outright).
- The account cannot be deleted.
- The company cannot be deleted.
- Sign-up is closed outright — not merely hidden, refused server-side
  (`backend/src/lib/registration-policy.ts#decideRegistration`), even with a valid invitation code and
  even for the very first user.
- API keys cannot be created or revoked.
- SSO cannot be configured, and no domain can be claimed for it.

Every one of these is enforced server-side; the frontend only hides or disables the corresponding
button as a convenience.

### The banner

Every authenticated page shows a sticky top banner: *"Demo: data resets every 4 hours. Nothing you
enter is kept or sent."* The sign-in page additionally shows the demo credentials directly, so a
visitor never has to look for them elsewhere.

## The seed

`npm run demo:reset` (`backend/scripts/demo-reset.ts`) rebuilds the demo dataset from scratch:

- One company **per supported country** (`defaultCountryPolicyCatalog.countries()` — today DE, FR,
  IT, PL, PT — discovered at runtime, never hardcoded), each reachable from the single demo account
  through the company switcher.
- For each company, at least two documents of **every document type that country's own policy
  offers** (`defaultCountryPolicyCatalog.typesFor(countryCode)`, also discovered at runtime) — quotes
  (one with named options, one manually accepted/"signed"), invoices in several states (draft, sent,
  overdue, partly paid, paid), a credit note linked to a paid invoice where the country's own law
  allows a standalone one, expenses, received invoices, a purchase order and a goods receipt.
- Company, client and article names, amounts, quantities and dates vary between resets: the generator
  takes a seed (`backend/src/modules/demo/generators/rng.ts`, a seedable PRNG), a fresh one drawn on
  every real reset, a fixed one in every test that exercises it.
- Every generated document is valid for its country: numbering goes through the real numbering
  service, and every national identifier (SIRET for France, USt-IdNr for Germany, Partita IVA for
  Italy, NIP for Poland, NIF for Portugal) carries a real, checksum-valid value
  (`backend/src/modules/demo/generators/identifiers.ts`, tested against this codebase's own offline
  validators — `demo-mode-seed.spec.ts` runs the generator against several seeds and checks every
  country's identifiers validate).
- Every document is created through the real `DocumentsService.runAction` — never a raw database
  row — so country-policy compliance, field validation and numbering all come from the same code path
  a real user's own action would go through. Reaching "sent" status uses a numbering-only bypass
  (`backend/src/modules/demo/seed-runtime/move-to-sent.ts`) instead of the real `send` action, so a
  reset never depends on a working mail/transport configuration existing in whatever namespace it
  runs in.

### The reset is safe while visitors are connected

The reset never deletes before it rebuilds. It builds every new company for every country first, each
one fully; only once **every** new company exists does it delete the old ones, in one final pass. A
visitor connected mid-reset sees, at worst, a company switcher briefly listing more companies than
usual — never fewer, never a half-built company with some document types present and others missing,
and never a moment with no company at all. "Old" companies are never guessed or tagged: they are
whatever company the demo account belonged to before this run started, since sign-up being closed
makes the demo account the only account this instance ever has — every company it belongs to is demo
data, by construction.

### Scheduling it

The product does not schedule its own reset; that is an infrastructure decision. Run
`npm run demo:reset` (or, from the built image, `node dist/scripts/demo-reset.js` once a raw-TypeScript
runner such as `tsx`/`ts-node` copies alongside compiled `dist/src`, the same layout
`catalogs:release` already uses) from a Kubernetes **CronJob** on a 4-hour schedule
(`0 */4 * * *`), against the demo namespace's own `DEMO_MODE=true` environment. It is idempotent and
self-contained: it creates the demo account if missing, reuses it otherwise, and needs no other
process to be stopped first.

## Configuration

See `backend/.env.example` for `DEMO_MODE` itself. There is nothing else to configure — the demo
account's address and password are fixed (`demo@invoicerr.app` / `demo`,
`backend/src/modules/demo/demo-flag.ts`), and every blocked sender needs no per-transport
configuration to stay blocked.
