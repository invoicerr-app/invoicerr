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

## API documentation

The backend exposes a live Swagger/OpenAPI UI at `/api/docs` (JSON spec at `/api/docs-json`), generated from `@nestjs/swagger` decorators on each controller. See the [API Reference](api-reference.md) page.
