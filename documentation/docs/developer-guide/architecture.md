---
sidebar_position: 1
---

# Backend Architecture

The backend (`backend/`) is a NestJS application organized into feature modules under `backend/src/modules/`. Each module typically owns its own controller, service, and DTOs, and most services inject the webhook dispatcher to emit events on state changes (see [Webhook system](./webhooks.md)).

## Modules

| Module | Purpose |
| --- | --- |
| `api-keys` | CRUD and verification of API keys; stores a hash, tracks last-used time, and scopes what each key can do. |
| `articles` | Catalogue of sellable items/services with stock counts, reused as invoice/quote line templates. |
| `auth-extended` | Extends the better-auth library: local password management for OIDC-only accounts, user preferences, signup locale. |
| `backup` | Encrypted, scheduled backups of the legal archive and uploaded files to a separate bucket. |
| `billing` | Hosted billing only (Polar) — checkout, customer portal, seats, webhooks; inert unless the instance opts in, see [Hosted billing](./hosted-billing.md). |
| `client-portal` | The client-facing portal: a client's own documents, balance, PDFs, payment and quote decisions. |
| `clients` | Customer records, account statements, aged balance. |
| `companies` | Company creation and membership (invitations, roles) — as opposed to `company`'s own settings. |
| `company` | A company's own settings: PDF branding, transmission channels, ATCUD series, currency rates, SSO. |
| `company-lookup` | Country-aware company registry lookup (national registers, VIES, GLEIF, the Peppol Directory). |
| `country-readiness` | Computes and surfaces how complete a country's data coverage is across the documents catalogues. |
| `danger` | Sensitive operations requiring OTP verification (e.g. account deletion). |
| `documents` | The document engine — every document type (quote, invoice, credit note, expense, received invoice, purchase order, goods receipt) is one `DocumentTypeDescriptor` sharing one lifecycle, plus the per-country compliance catalogues and transmission channels. The core of this repository; see the root `CLAUDE.md`'s own "documents module" section for the full breakdown. |
| `health` | `/api/health` liveness endpoint. |
| `instance` | Instance-wide settings, first-boot preflight checks, the SaaS instance-reset flow. |
| `invitations` | Creates and validates invitation codes for multi-user signup. |
| `logger` | Server-sent event stream of real-time logs, filterable by category/level/user. |
| `mcp` | The Model Context Protocol server — see [MCP server](./mcp-server.md). |
| `sirene` | Legacy `/api/sirene/siret/:siret` facade over `company-lookup`'s own French provider, kept for backward compatibility. |
| `time-tracking` | Projects and the time entries logged against them, turned into invoice lines. |
| `webhooks` | User-defined webhook subscriptions and event dispatch to external endpoints. |

There is no `invoices`/`quotes`/`receipts`/`recurring-invoices`/`payment-methods`/`dashboard`/`stats`/
`signatures`/`cron` module any more — each was folded into `documents` (every document type, and its
own dashboard/statistics aggregation, is now data a `DocumentTypeDescriptor` opts into, not a bespoke
module) when the compliance-engine rewrite replaced the old per-type services. See `CLAUDE.md`'s own
note on commit `fffbae77` for the removal, and "The documents module" section for what replaced it.

## Data layer

The backend uses [Prisma](https://www.prisma.io/) as its ORM, with the schema defined in `backend/prisma/schema.prisma`. PostgreSQL is the only supported database — the schema's `datasource` provider is hardcoded to `postgres` — configured via `DATABASE_URL`; `docker-compose.dev.yml` starts one for local development outside Docker.

## Document rendering and archiving

`documents.service.ts#renderInstancePdf` (the PDF download, the public share link, the client
portal, and the accounting ZIP export all call this one function) serves the document's archived
PDF, never a fresh render, when **both** hold (`rendering/archived-pdf-policy.ts`):

1. **The document is issued**: a status the type's own `save-draft` action locks
   (`DocumentActionDescriptor.lockedStatuses`), derived per type as `issuedStatusesOf`, never a
   second, hand-copied list.
2. **The archive was rendered from the document's current data**: every DELIVERY archive records
   `documentDataHash`, the hash of the `data` its PDF was rendered from (the same hash an
   e-signature binds to). An archive written before this column existed (`NULL`) proves nothing
   about its data, so it is never trusted either; the document is rendered fresh instead, at the
   cost of a render, never a stale PDF served as if it were the legal copy.

Everything else renders fresh from the document's current `data`, including a draft, and an
archive whose data no longer matches (for example a signed quote later edited back to draft).

**`renderDocumentInstance` takes a required `purpose`** (`rendering/status-line-policy.ts`), so
every caller says which copy it is building:

- `'delivery'`: the copy handed to the client at send time (email attachment, embedded Factur-X).
  Never prints a workflow status line: the bytes are rendered while the record is still `sending`,
  before delivery has actually reached anyone, and a status word is not an invoice content item any
  of the five supported countries' laws require.
- `'on-demand'`: the download/share-link/portal/ZIP path above. Prints a status line only when the
  document is **not** issued (a `Status: draft` warning stays on a working copy); an issued
  document's on-demand render (reached only when there is no archive to serve yet) reads exactly
  like the delivered copy, since it stands in for it.

A PDF already archived with a status line printed on it is never touched retroactively: its bytes,
`contentHash` and any e-signature bound to it depend on staying exactly as delivered.

## API documentation

The backend exposes a live Swagger/OpenAPI UI at `/api/docs` (JSON spec at `/api/docs-json`), generated from `@nestjs/swagger` decorators on each controller. See the [API Reference](api-reference.md) page.
