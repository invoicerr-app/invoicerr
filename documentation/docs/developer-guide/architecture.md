---
sidebar_position: 1
---

# Backend Architecture

The backend (`backend/`) is a NestJS application organized into feature modules under `backend/src/modules/`. Each module typically owns its own controller, service, and DTOs, and most services inject the webhook dispatcher to emit events on state changes (see [Webhook system](./webhooks.md)).

## Modules

| Module | Purpose |
| --- | --- |
| `api-keys` | CRUD and verification of API keys; stores a hash and tracks last-used time. |
| `auth-extended` | Extends the auth library with password management, e.g. letting OIDC-only users set a local password. |
| `clients` | Manages customer records. |
| `company` | Manages the organization profile, PDF branding (colors, fonts), and email templates. |
| `cron` | Scheduled background tasks. |
| `danger` | Sensitive operations requiring OTP verification (e.g. account deletion). |
| `dashboard` | Aggregates KPIs: invoice totals, revenue trends, quote statuses, client counts. |
| `directory` | Restricted filesystem browser used for plugin/config file selection. |
| `invitations` | Creates and validates invitation codes for multi-user signup. |
| `invoices` | Core invoice CRUD, PDF/XML generation, payment tracking, line items. |
| `logger` | Server-sent event stream of real-time logs, filterable by category/level/user. |
| `payment-methods` | Stores and toggles payment methods, attached to invoices/quotes. |
| `plugins` | Registry and loader for built-in and external plugins. See [Plugin system](./plugin-system.md). |
| `quotes` | Quote CRUD, PDF generation, signing workflow, expiry tracking. |
| `receipts` | Receipt generation from invoices, PDFs, email dispatch. |
| `recurring-invoices` | Scheduled invoice generation on a recurring basis. |
| `signatures` | Bridges the quote-signing workflow for anonymous signers. |
| `stats` | Monthly/yearly financial statistics. |
| `webhooks` | User-defined webhook subscriptions and event dispatch to external endpoints. |

## Data layer

The backend uses [Prisma](https://www.prisma.io/) as its ORM, with the schema defined in `backend/prisma/schema.prisma`. SQLite is the default database for local/Docker setups; PostgreSQL is supported via `DATABASE_URL`.

## API documentation

The backend exposes a live Swagger/OpenAPI UI at `/api/docs` (JSON spec at `/api/docs-json`), generated from `@nestjs/swagger` decorators on each controller. See the [API Reference](api-reference.md) page.
