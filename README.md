# Invoicerr


![Invoicerr Banner](https://github.com/invoicerr-app/invoicerr/blob/ac4ea3fb8293b63e0b58bd33ea38b6b7018f673a/Invoicerr_banner.webp)

Invoicerr is a simple, open-source invoicing application designed to help freelancers manage their quotes and invoices efficiently. It provides a clean interface for creating, sending, and tracking quotes and invoices — so you get paid faster, with less hassle.

---

## 📢 Maintainer availability

I no longer have enough personal time to work on Invoicerr full-time (studies + job).

The project is still open, and I can continue to review and manage community pull requests, but development speed from my side will be slower.

---

![Dashboard Page](https://github.com/user-attachments/assets/18e8af88-cf02-4e35-975a-d57f58d062c6)

<section>
<img src="https://wakatime.com/badge/user/4cf4132a-4ced-411d-b714-67bdbdc84527/project/2f27011d-6794-4fbe-97c9-9fdef2550fc7.svg?style=flat">
<img src="https://m3-markdown-badges.vercel.app/stars/12/1/invoicerr-app/invoicerr">
<img src="https://m3-markdown-badges.vercel.app/issues/12/1/invoicerr-app/invoicerr">
</section>

## ✨ Features

- Create and manage invoices  
- Create and manage quotes (convertible to invoices)  
- Manage clients and their contact details  
- Track status of quotes and invoices (signed, paid, unread, etc.)  
- Built-in quote signing system with secure tokens  
- Generate and send quote/invoice emails directly from the app
- Generate clean PDF documents (quotes, invoices, payments, and more)  
- Your company identity on every document: name, VAT number, legal ID, address  
- Authentication via email/password, OIDC/SSO, or API keys
- International-friendly: Default English UI, customizable currencies  
- Docker & docker-compose ready for self-hosting  
- Built with modern stack: React, NestJS, Prisma, PostgreSQL  
- REST API backend, ready for future integrations (mobile & desktop apps)
- Plugin system for community-made features

---

## 🌍 Translation

Invoicerr uses weblate to easily manage the translations

[![Translation status](https://hosted.weblate.org/widget/invoicerr/horizontal-auto.svg)](https://hosted.weblate.org/engage/invoicerr/)

[![Translation status](https://hosted.weblate.org/widget/invoicerr/open-graph.png)](https://hosted.weblate.org/engage/invoicerr/)

---

## 🗺️ Country / compliance support

Which invoicing rules apply — document actions, B2G channels, correction routes, VAT rates,
required identifiers, mandatory mentions — is entirely **data-driven**: no business code hardcodes
a country. The full picture for every covered country is generated straight from the engine's own
data files, so it can never say something the code doesn't actually do:

- 📊 [Country compliance matrix](https://docs.invoicerr.app/docs/developer-guide/country-support) — regenerated on every docs build
- ➕ [Adding a country](https://docs.invoicerr.app/docs/developer-guide/adding-a-country) — the developer guide for extending coverage

---

## 🐳 Docker Installation (Recommended)

#### Supported Architectures

The images are built for the following architectures:

- `linux/amd64` (x86_64)
- `linux/arm64/v8` (ARMv8)

#### Why not `linux/arm/v7`?

The `linux/arm/v7` architecture is not supported due to the use of prisma, which does not provide prebuilt binaries for this architecture. This means that the application will not run on 32-bit ARM devices.

The fastest way to run Invoicerr is using Docker Compose. A prebuilt image is available at [ghcr.io/invoicerr-app/invoicerr](https://ghcr.io/invoicerr-app/invoicerr).

### 🚀 Quick Start

1. Create a `docker-compose.yml` file with the following content, then adjust the environment variables to your setup:

   ```yaml
   services:
     invoicerr:
       image: ghcr.io/invoicerr-app/invoicerr:latest
       ports:
         - "80:80"
       environment:
         - DATABASE_URL=postgresql://invoicerr:invoicerr@invoicerr_db:5432/invoicerr_db
         - APP_URL=https://invoicerr.example.com # Required for email templates, as it redirects to the app
         - CORS_ORIGINS=http://localhost:5173,https://invoicerr.example.com # Comma-separated list of allowed origins for CORS

         # Required for email features - choose ONE provider below
         # Option 1: SMTP (default, MAIL_PROVIDER can be omitted)
         - MAIL_PROVIDER=smtp
         - SMTP_HOST=smtp-relay.example.com
         - SMTP_USER="username@example.com"
         - SMTP_FROM="user-from@example.com" # Not required if SMTP_USER is the same as SMTP_FROM
         - SMTP_PASSWORD="your_smtp_password"
         - SMTP_PORT=587
         - SMTP_SECURE=false

         # Option 2: Brevo (set MAIL_PROVIDER=brevo and comment out the SMTP_* variables above)
         # - MAIL_PROVIDER=brevo
         # - BREVO_API_KEY="your_brevo_api_key"

         # REQUIRED in production. Generate a real value with: openssl rand -hex 32
         # The backend REFUSES TO BOOT if this is left empty or set to an obvious placeholder — see
         # "Environment Variables" below.
         - BETTER_AUTH_SECRET=CHANGE_ME_generate_with_openssl_rand_hex_32

         # Redis is REQUIRED for the backend to boot at all (the document-action queue), never an
         # optional extra. WORKER_INLINE=true (the default) makes this single container also consume
         # its own queue jobs — see docker-compose.scale.yml for a scaled deployment with a dedicated
         # worker service instead.
         - REDIS_HOST=redis
         - REDIS_PORT=6379
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
       environment:
         ALLOW_EMPTY_PASSWORD: "yes" # self-host default: no password, single-host docker network
       restart: unless-stopped
       volumes:
         - redis-data:/bitnami

   volumes:
     db_data:
       driver: local
     redis-data:
       driver: local
   ```

   > The full reference file — OIDC, OCR, mail providers, the scaled/multi-worker overlay — is
   > available at [`docker-compose.yml`](./docker-compose.yml) (and
   > [`docker-compose.scale.yml`](./docker-compose.scale.yml) for the dedicated-worker overlay).

2. Run the app:  
   ```bash
   docker compose up -d
   ```

3. Open your browser at:  
   ```
   http://localhost
   ```

---

### 🔧 Environment Variables

`backend/.env.example` is the complete, per-variable reference (every option, its default, and why
it exists, as inline comments) — this section only covers what a self-hoster needs to *decide*
before deploying. It does not repeat every variable in that file; when the two disagree, trust
`backend/.env.example` and the source it cites.

**Required — the app will not work at all without these:**

- `DATABASE_URL` — PostgreSQL connection string. There is no alternative database: `backend/prisma/schema.prisma` hardcodes the `postgres` provider.
- Redis (`REDIS_URL`, or `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`) — the document-action queue (BullMQ). The backend refuses to boot at all without a reachable Redis, in every environment, not just production.
- `APP_URL` — full public URL of the instance. Used for email links/templates and as the CORS/auth base URL; also the default `redirect_uri` base for OIDC.
- One mail provider, fully configured — SMTP (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, …) by default, or Brevo (`MAIL_PROVIDER=brevo`, `BREVO_API_KEY`). Without one, sending quote/invoice emails and invitations fails.

**Required in production only (`NODE_ENV=production`) — the backend refuses to boot:**

- `BETTER_AUTH_SECRET` (or its alias `JWT_SECRET`, checked as a fallback) — signs every session cookie/JWT. **Not** optional and **no default is substituted**: on an empty value or a known placeholder (`your_jwt_secret`, `changeme`, anything starting with `your_`/`change_me`/…) the backend logs the exact reason and exits rather than starting with a secret an attacker could guess from this very README or from `docker-compose.yml`'s own example value. Generate a real one with `openssl rand -hex 32`. This guard only runs when `NODE_ENV=production`; a plain local/dev boot is unaffected.
- `OIDC_ONLY` — if set with no OIDC provider configured at all (neither the environment one nor any company-registered one), the backend refuses to boot rather than start an instance nobody, including you, could sign in to.

**Optional, with a working default:**

- `CREDENTIALS_ENCRYPTION_KEY` — encrypts per-company channel credentials (national transmission channels, per-company SSO secrets) at rest. Leaving it unset does **not** crash anything: the relevant endpoints answer `503` and the feature (connecting a channel or a per-company SSO provider) disables itself silently rather than ever storing a secret unencrypted.
- `DISABLE_AUTH` — closes open self-registration (new accounts then need an invitation code); despite the name it does **not** disable login.
- `MAIL_FROM` / `SMTP_FROM` — sender address; falls back to `SMTP_USER` if unset.
- `CORS_ORIGINS` — extra allowed origins beyond `APP_URL` and `localhost:5173`, comma-separated.
- OIDC (`OIDC_CLIENT_ID` + friends) — registers an instance-wide SSO provider; unset means no environment-wide provider (customers can still register their own per-company one in company settings). See `backend/.env.example`.
- PDF rendering, document storage paths, OCR, and the document-lifecycle sweep intervals all have self-host-appropriate defaults — see `backend/.env.example`'s own comments (each cites the source file and line the default lives in).

**Per-deployment-role:**

- `ROLE` — `api` (default: nginx + the main backend), `worker` (dedicated queue-worker process, no nginx, no migrations), or `ocr` (a separate, single-purpose OCR service — the only role that ever sees a real OCR API key). `entrypoint.sh` switches on it.
- `WORKER_INLINE` — default `true`: the API container also consumes its own queue jobs (single-container self-host). Set to `false` only when running dedicated `ROLE=worker` container(s) elsewhere — see [`docker-compose.scale.yml`](./docker-compose.scale.yml).

**Opt-in live-test credentials** (KSeF, PDP, SdI, Chorus Pro, Peppol, Mistral OCR, …): these are development-only flags for this repository's own opt-in integration tests against real external APIs — never something an end user or a self-hosted deployment sets. See [`LIVE_TESTING.md`](./LIVE_TESTING.md) for the full list and how to run one.

Make sure port 80 is available on your host machine, or change the mapping.

---

## 💻 Manual Installation (Local Development)

### Prerequisites

- Node.js v20+  
- PostgreSQL (a local instance, or point `DATABASE_URL` at one you already run) — `backend/prisma/schema.prisma` hardcodes the `postgres` provider, so no other database engine works  
- Redis — required for the backend to boot at all (the document-action queue), never optional  
- PNPM or NPM

### Steps

1. Clone the project:  
   ```bash
   git clone https://github.com/invoicerr-app/invoicerr.git
   cd invoicerr
   ```

2. Backend setup — needs a reachable PostgreSQL (`DATABASE_URL`) and Redis (the document-action
   queue; the backend refuses to boot without one) before `npm run start`; copy `backend/.env.example`
   to `backend/.env` and adjust both. (The `./scripts/dev.sh` stack below starts Postgres, Redis and
   Mailpit in Docker for you, if you'd rather skip doing this by hand.)
   ```bash
   cd backend
   npm install
   npx prisma generate
   npm run start
   ```
   PDF generation (invoices, quotes, receipts, credit notes) needs a Chromium/Chrome binary; outside
   the Docker image nothing provides one automatically, so run `npx playwright-core install chromium`
   once to fetch a matching build (see `backend/.env.example`'s `CHROMIUM_EXECUTABLE_PATH` for other ways to
   point at one).

3. Frontend setup (in a new terminal):  
   ```bash
   cd frontend
   npm install
   npm run start
   ```

4. Open in your browser:  
   - Frontend: `http://localhost:5173`  
   - API: `http://localhost:3000`

### One-command hot-reloading stack

`scripts/dev.sh` runs the whole local stack and keeps it reloading on every file change —
Postgres, Redis and Mailpit in Docker (`docker-compose.dev.yml`), backend and frontend on
the host:

```bash
./scripts/dev.sh start     # docker services + prisma migrate + backend (watch) + vite
./scripts/dev.sh status    # what is up, on which port
./scripts/dev.sh logs      # tail both application logs
./scripts/dev.sh restart   # after changing .env
./scripts/dev.sh stop      # apps only     ·    down = apps + docker services
```

- Frontend `http://localhost:5173` · API `http://localhost:3000/api` · Mailpit `http://localhost:8025`
- Logs and PID files live in `.dev/` (git-ignored).

---

## 🧪 Running the end-to-end tests (Cypress)

To run the e2e tests locally or in CI:

1. Start the backend and the frontend with the test environment:
   ```bash
   cd backend && npm run start:test &
   cd frontend && npm run start:test &
   ```
   (Make sure a .env.test file exists in each folder)

2. In another terminal, run Cypress:
   ```bash
   cd e2e
   npm install
   npm run e2e:open # or npm run e2e:run
   ```

In CI, the GitHub Actions workflow does all of this automatically.

---

## 📸 Screenshots

<details>
<summary>Dashboard</summary>
  
![Dashboard Page](https://github.com/user-attachments/assets/18e8af88-cf02-4e35-975a-d57f58d062c6)
  
</details>

<details>
<summary>Quotes</summary>

![Quotes Page](https://github.com/user-attachments/assets/588d5cd2-6af3-4cb9-81d3-8faa9f3d30f4)

</details>

<details>
<summary>Invoices</summary>
  
![Invoices Page](https://github.com/user-attachments/assets/8e5134b7-c401-4ff6-bdb9-cfe54b532b29)

</details>

<details>
<summary>Clients</summary>

![Clients Page](https://github.com/user-attachments/assets/1e9e42be-8c21-4c84-96dd-ce8dca17c32e)

</details>

<details>
<summary>Settings</summary>
  
![Settings Page](https://github.com/user-attachments/assets/b8913f41-109a-4e31-a1b8-3c46a1039414)

</details>

## 🧰 Technologies

- <img src="https://ziadoua.github.io/m3-Markdown-Badges/badges/React/react1.svg"/>
- <img src="https://ziadoua.github.io/m3-Markdown-Badges/badges/NestJS/nestjs1.svg"/>
- <img src="https://ziadoua.github.io/m3-Markdown-Badges/badges/TypeScript/typescript1.svg"/>
- <img src="https://ziadoua.github.io/m3-Markdown-Badges/badges/Prisma/prisma1.svg"/>
- <img src="https://ziadoua.github.io/m3-Markdown-Badges/badges/PostgreSQL/postgresql1.svg"/>
- <img src="https://ziadoua.github.io/m3-Markdown-Badges/badges/TailwindCSS/tailwindcss1.svg"/>
- <img src="https://ziadoua.github.io/m3-Markdown-Badges/badges/Docker/docker1.svg"/>

## ⚖️ License

This project is dual-licensed:
- Open Source: [AGPL-3.0](./LICENSE)
- Commercial: [COMMERCIAL-LICENSE](./COMMERCIAL-LICENSE)

Contact me for commercial use.
