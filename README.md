![Invoicerr](https://raw.githubusercontent.com/invoicerr-app/brand/main/social/banner.webp)

Open-source invoicing you host yourself: quotes, invoices, payments and the paperwork that follows —
including the e-invoicing rules of the country you bill from.

[![Tests](https://github.com/invoicerr-app/invoicerr/actions/workflows/cypress.yml/badge.svg)](https://github.com/invoicerr-app/invoicerr/actions/workflows/cypress.yml)
[![Latest release](https://img.shields.io/github/v/release/invoicerr-app/invoicerr?label=release)](https://github.com/invoicerr-app/invoicerr/releases)
[![Container image](https://img.shields.io/badge/ghcr.io-invoicerr--app%2Finvoicerr-2496ED?logo=docker&logoColor=white)](https://ghcr.io/invoicerr-app/invoicerr)
[![License](https://img.shields.io/github/license/invoicerr-app/invoicerr)](./LICENSE)

![Dashboard](./documentation/static/img/readme/dashboard.webp)

## What you get

- Quotes, invoices, credit notes, purchase orders, goods receipts, expenses and received invoices —
  one document engine, one lifecycle, one list and detail screen for every type.
- Payments, partial payments, deposits, instalments and settlement badges computed from the record,
  never stored on the document.
- Clients with their own portal, account statements and aged balance.
- An article catalogue with stock counts, project time tracking that turns into invoice lines, and
  recurring documents.
- Bank statement import (CSV/OFX) with reference and amount matching, plus online payment methods.
- PDF generation, e-invoice XML (Factur-X, UBL, CII, XRechnung, Peppol BIS, FatturaPA, FA(3)) and
  national transmission channels.
- A legal archive per issued document, with the retention duration and its starting point taken from
  the country's own rule.
- Encrypted, scheduled backups of every archived document and uploaded file to a separate bucket,
  with a key the storage provider never holds.
- Sign-in by e-mail/password, OIDC/SSO (instance-wide or per company) or API key; multi-company,
  role-based access; webhooks, a REST API, an MCP server and a plugin system.
- 18 interface languages, per-recipient document language, multi-currency with rate history.
- Installable as a PWA, light and dark themes.

## Screenshots

<details>
<summary>Invoicing</summary>

Invoice list, filtered by status, with the settlement state of each one.

![Invoice list](./documentation/static/img/readme/invoices.webp)

Creation wizard — lines filled from the article catalogue, VAT rates from the seller country's own
rate list.

![Invoice creation wizard](./documentation/static/img/readme/invoice-wizard.webp)

Invoice detail: totals, settlement and the legal archive with its retention rule.

![Invoice detail](./documentation/static/img/readme/invoice-detail.webp)

Quotes, convertible to invoices, with deposit and instalment requests.

![Quotes](./documentation/static/img/readme/quotes.webp)

Credit notes correct an invoice line by line, never freehand.

![Credit note](./documentation/static/img/readme/credit-note.webp)

</details>

<details>
<summary>Purchasing</summary>

Purchase orders sent to suppliers.

![Purchase orders](./documentation/static/img/readme/purchase-orders.webp)

Received invoices — uploaded, OCR-read into an editable proposal, then approved or rejected.

![Received invoices](./documentation/static/img/readme/received-invoices.webp)

</details>

<details>
<summary>Clients</summary>

Client list with activity and supplier filters.

![Clients](./documentation/static/img/readme/clients.webp)

Account statement: every document, the balance and the aged balance.

![Client statement](./documentation/static/img/readme/client-statement.webp)

The client portal — the client's own documents, balance, PDFs, payment and quote decisions.

![Client portal](./documentation/static/img/readme/client-portal.webp)

Quote signing: a one-time code sent to the signer, then a signed quote.

![Quote signature](./documentation/static/img/readme/quote-signature.webp)

</details>

<details>
<summary>Catalogue and time</summary>

Articles priced per hour, day, unit or service, with stock counts and low-stock alerts.

![Articles](./documentation/static/img/readme/articles.webp)

Time tracking per project, billable or not, turned into invoice lines in one step.

![Time tracking](./documentation/static/img/readme/time-tracking.webp)

</details>

<details>
<summary>Getting paid</summary>

Bank reconciliation: import a statement, confirm the suggested match, get a real payment record.

![Bank reconciliation](./documentation/static/img/readme/bank-reconciliation.webp)

Payment methods offered to clients, with the details each one shows on the document.

![Payment methods](./documentation/static/img/readme/payment-methods.webp)

</details>

<details>
<summary>Settings</summary>

Company settings — the country decides which identifiers are asked for, and how they are labelled.

![Company settings](./documentation/static/img/readme/company-settings.webp)

E-invoicing channels: connect the national platform the country expects, then use it as the invoice
transport.

![E-invoicing channels](./documentation/static/img/readme/e-invoicing-channels.webp)

Signing certificates for PAdES-signed PDFs.

![Signing certificates](./documentation/static/img/readme/signing-certificates.webp)

E-mail templates, one per document type plus the system e-mails.

![E-mail templates](./documentation/static/img/readme/email-templates.webp)

</details>

<details>
<summary>Dark theme</summary>

![Dashboard in dark theme](./documentation/static/img/readme/dashboard-dark.webp)

</details>

## Country coverage

A country is data, not code: which actions a document allows, which identifiers a party must supply,
which correction route applies, which VAT rates exist, which channel and format a buyer requires, how
long an archive must be kept — each is its own catalogue of sourced facts, and every fact carries the
legal text it comes from.

Germany, France, Italy, Poland and Portugal ship with their catalogues filled in.

| Channel | Country | Used for |
| --- | --- | --- |
| PDP | France | B2B e-invoicing through an accredited platform |
| Chorus Pro | France | B2G invoices to public buyers |
| KSeF | Poland | National clearance |
| SdI | Italy | National clearance (web service) |
| SdI over PEC | Italy | National clearance (certified e-mail) |
| E-mail | Any | PDF and attached e-invoice XML |

The full per-country picture is generated from those data files on every documentation build:
[country support matrix](https://docs.invoicerr.app/docs/developer-guide/country-support) ·
[adding a country](https://docs.invoicerr.app/docs/developer-guide/adding-a-country).

## Quick start

A prebuilt image is published at [ghcr.io/invoicerr-app/invoicerr](https://ghcr.io/invoicerr-app/invoicerr),
built for `linux/amd64`, `linux/arm64` and `linux/arm/v7`.

1. Create a `docker-compose.yml`:

   ```yaml
   services:
     invoicerr:
       image: ghcr.io/invoicerr-app/invoicerr:latest
       ports:
         - "80:80"
       volumes:
         # Legal archives and received invoices. Without it they live in the container's writable
         # layer and are destroyed by the next image pull.
         - documents_data:/data
       environment:
         - DATABASE_URL=postgresql://invoicerr:invoicerr@invoicerr_db:5432/invoicerr_db
         - APP_URL=https://invoicerr.example.com
         - DOCUMENTS_ARCHIVE_DIR=/data/documents-archive
         - DOCUMENTS_INBOUND_DIR=/data/documents-inbound
         # Signs every session cookie. Generate with: openssl rand -hex 32
         - BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET:?set it in a .env file next to this one}
         # Redis is required for the backend to boot at all (the document-action queue).
         - REDIS_HOST=redis
         - REDIS_PORT=6379
         # One mail provider, or nothing can be sent. Resend is the alternative:
         # MAIL_PROVIDER=resend + RESEND_API_KEY.
         - SMTP_HOST=smtp.example.com
         - SMTP_USER=invoices@example.com
         - SMTP_PASSWORD=${SMTP_PASSWORD:?set it in a .env file next to this one}
         - SMTP_PORT=587
         - SMTP_SECURE=false
       depends_on:
         - invoicerr_db
         - redis

     invoicerr_db:
       image: postgres:15
       environment:
         POSTGRES_USER: invoicerr
         POSTGRES_PASSWORD: invoicerr
         POSTGRES_DB: invoicerr_db
       volumes:
         - db_data:/var/lib/postgresql/data

     redis:
       image: bitnami/redis:latest
       restart: unless-stopped
       environment:
         ALLOW_EMPTY_PASSWORD: "yes"
       volumes:
         - redis_data:/bitnami

   volumes:
     documents_data:
     db_data:
     redis_data:
   ```

2. Put the two secrets in a `.env` file next to it, then start:

   ```bash
   docker compose up -d
   ```

3. Open `http://localhost` and create the first account.

The reference compose file with every option — OIDC, OCR, mail providers — is
[`docker-compose.yml`](./docker-compose.yml); [`docker-compose.scale.yml`](./docker-compose.scale.yml)
adds dedicated queue workers. Every variable is documented, with its default and the source file that
default lives in, in [`backend/.env.example`](./backend/.env.example).

For more than one host, use the Helm chart in [`deploy/helm/invoicerr/`](./deploy/helm/invoicerr). The
API and worker scale safely as independent Deployments — three API replicas behind a load balancer and
fifteen workers — once the legal archive and uploaded files move to S3-compatible object storage
instead of local disk, which is what makes running on more than one machine possible at all. The
[Kubernetes guide](https://docs.invoicerr.app/docs/user-guide/kubernetes)'s own reference deployment
runs entirely on one French provider, in Paris: cluster, object storage and managed database.

### Updating

```bash
docker compose pull && docker compose up -d
```

Database migrations run at boot, in the API role only. When a release changes which countries the
shipped catalogues cover, one manual step follows it, because no boot path is allowed to delete a
country's rows:

```bash
npm run catalogs:release    # from the backend workspace — /usr/share/nginx/backend in the image
```

## Documentation

[docs.invoicerr.app](https://docs.invoicerr.app)

| Page | What it covers |
| --- | --- |
| [Introduction](https://docs.invoicerr.app/docs/user-guide/introduction) | What Invoicerr is, and the first steps in it |
| [Docker installation](https://docs.invoicerr.app/docs/user-guide/docker-installation) | The full compose reference and every environment variable |
| [Kubernetes deployment](https://docs.invoicerr.app/docs/user-guide/kubernetes) | The Helm chart, its two roles, storage and ingress |
| [Instance backups](https://docs.invoicerr.app/docs/user-guide/backups) | Encrypted backups to a separate bucket, and how to restore one |
| [User guide](https://docs.invoicerr.app/docs/user-guide/overview) | Every screen: documents, clients, portal, settings |
| [Developer guide](https://docs.invoicerr.app/docs/developer-guide/architecture) | Architecture, document types, catalogues, local setup |
| [API reference](https://docs.invoicerr.app/docs/developer-guide/api-reference) | The REST API and its authentication |
| [Plugins](https://docs.invoicerr.app/docs/developer-guide/plugin-system) · [Webhooks](https://docs.invoicerr.app/docs/developer-guide/webhooks) · [MCP server](https://docs.invoicerr.app/docs/developer-guide/mcp-server) | Extending Invoicerr from outside |
| [Live testing](https://docs.invoicerr.app/docs/developer-guide/live-testing) | Running the real round-trips against national platforms |
| [Changelog](https://docs.invoicerr.app/changelog) | Every release |

## Technologies

| Area | Stack |
| --- | --- |
| Backend | NestJS 12, TypeScript 5.7, Swagger/OpenAPI |
| Database | PostgreSQL (Prisma 7 — no other engine: the schema hardcodes the `postgres` provider) |
| Queue | BullMQ 5 on Redis (required to boot; inline worker or dedicated processes) |
| Auth | better-auth 1.7 — e-mail/password, OIDC/SSO, API keys |
| Frontend | React 19, Vite 7, TanStack Query 5, Tailwind CSS 4, Radix UI (shadcn-style), react-i18next |
| PDF | playwright-core 1.63 (headless Chromium), pdf-lib, `@signpdf` for PAdES |
| E-invoice XML | `@e-invoice-eu/core`, `@digitalia/fatturapa`, node-schematron, xmllint-wasm |
| OCR | [ghcr.io/invoicerr-app/ocr-image](https://github.com/invoicerr-app/ocr-image) — ocrmypdf + Tesseract, self-hosted, opt-in |
| Tests | Vitest (backend and frontend), Cypress 15 (end-to-end and per-country scenarios) |
| Tooling | Biome 2.5 (lint and format), Docker, Helm 3, GitHub Actions |
| Documentation | Docusaurus 3.10 |
| Hosted billing | Polar (hidden unless the instance explicitly enables it; self-hosting stays free) |

## Contributing

Issues and pull requests are welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md) for how to report a
bug, propose a feature, and get a pull request merged. Setting the four workspaces up, running the test
stack and running the end-to-end suites are covered in
[local development](https://docs.invoicerr.app/docs/developer-guide/local-development); how the
pieces fit together is in [architecture](https://docs.invoicerr.app/docs/developer-guide/architecture).

Translations are managed on Weblate; the English catalogue in `frontend/src/locales/en` is the source
every other language is translated from.

[![Translation status](https://hosted.weblate.org/widget/invoicerr/horizontal-auto.svg)](https://hosted.weblate.org/engage/invoicerr/)

## Contributors

Maintainer: [Roméo Chevrier](https://github.com/Impre-visible) (@Impre-visible).

With contributions from
[Quentin Marques](https://github.com/Kent1mrqs),
[Guillaume Ouint](https://github.com/GuillaumeOuint),
[Luís Rodrigues](https://github.com/luismsrodrigues),
[Ruben Dorozala](https://github.com/winterrific),
[Guillaume Aubert](https://github.com/Guillaume1868),
[Jonas Ghyllebert](https://github.com/jghyllebert),
[Dmitry Warkentin](https://github.com/kerogenesis),
[Fabio Orlandi](https://github.com/Fob-io),
[Mike Meijndert](https://github.com/Mindert123),
[Victor Fernandez](https://github.com/zdebugon),
[Tom Ruff](https://github.com/WuffusXR),
[T13o](https://github.com/TheInfamousToTo),
[javlk](https://github.com/javlk83),
[MakoPhil](https://github.com/MakoPhil),
[anasdwc](https://github.com/anasdwc),
[nlimeres](https://github.com/nlimeres)
and [richipargo](https://github.com/richipargo),
plus everyone who has translated the interface on Weblate.

## Security

Private vulnerability reporting is enabled: open a
[security advisory](https://github.com/invoicerr-app/invoicerr/security/advisories/new) rather than a
public issue. Please do not report a vulnerability in an issue, a pull request or a discussion.

## Community

[Issues](https://github.com/invoicerr-app/invoicerr/issues) for bugs and feature requests,
[Discussions](https://github.com/invoicerr-app/invoicerr/discussions) for questions and ideas.

## License

[AGPL-3.0](./LICENSE) — free for any use, commercial included. If you run a modified version as a
network service, you offer its source to the people using it (section 13). That is the whole deal;
there is no second licence and no paid tier of the software itself.
