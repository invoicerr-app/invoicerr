---
sidebar_position: 0.5
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Docker Installation (Recommended)

The fastest way to run Invoicerr is using Docker Compose. A prebuilt image is available at [ghcr.io/invoicerr-app/invoicerr](https://ghcr.io/invoicerr-app/invoicerr).

## Supported architectures

- `linux/amd64` (x86_64)
- `linux/arm64/v8` (ARMv8)

:::warning 
`linux/arm/v7` is not supported
Prisma does not provide prebuilt binaries for that architecture — the application will not run on 32-bit ARM devices.
:::

## Quick start

1. Create a `docker-compose.yml` file with the following content, then adjust the environment variables to your setup:

   ```yaml title="docker-compose.yml"
   services:
     invoicerr:
       image: ghcr.io/invoicerr-app/invoicerr:latest
       ports:
         - "80:80"
       environment:
         - DATABASE_URL=postgresql://invoicerr:invoicerr@invoicerr_db:5432/invoicerr_db
         - APP_URL=https://invoicerr.example.com
         - CORS_ORIGINS=http://localhost:5173,https://invoicerr.example.com

         # Email delivery - see "Email delivery" below for the Resend alternative (Brevo's own SMTP
         # relay also works with the SMTP settings below)
         - SMTP_HOST=smtp-relay.example.com
         - SMTP_USER="username@example.com"
         - SMTP_FROM="user-from@example.com"
         - SMTP_PASSWORD="your_smtp_password"
         - SMTP_PORT=587
         - SMTP_SECURE=false

         - JWT_SECRET="your_jwt_secret"
       depends_on:
         - invoicerr_db

     invoicerr_db:
       image: postgres:15
       environment:
         POSTGRES_USER: invoicerr
         POSTGRES_PASSWORD: invoicerr
         POSTGRES_DB: invoicerr_db
       volumes:
         - db_data:/var/lib/postgresql/data

   volumes:
     db_data:
       driver: local
   ```

2. Run the app:

   ```bash
   docker compose up -d
   ```

3. Open your browser at `http://localhost`.

:::tip
The repository's [`docker-compose.yml`](https://github.com/invoicerr-app/invoicerr/blob/main/docker-compose.yml) also includes a commented-out OIDC example, useful if you want single sign-on.
:::

## Updating

`docker compose pull && docker compose up -d` picks up a new image and re-applies pending database
migrations automatically on the container's next boot — same as any other restart.

One thing that is **not** automatic: if a release actually **drops a country** from one of the
document-action policy / identifier-requirements / B2G-routing catalogs, removing that country's
database rows is a deliberate, separate step — every automatic boot path only ever adds/updates
rows, on purpose (so a rolling multi-container setup, or simply restarting on a half-pulled image,
can never delete a country a newer container already seeded). Run this once, after the new
container is up, whenever a release note says a country was removed:

```bash
docker compose exec invoicerr sh -c "cd /usr/share/nginx/backend && npm run catalogs:release"
```

(swap `invoicerr` for your own service name if you renamed it in `docker-compose.yml`). It is
idempotent — safe to run on every update regardless of whether that particular release actually
removed a country.

## Environment variables

These are set under the `invoicerr` service's `environment` key.

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string, e.g. `postgresql://invoicerr:invoicerr@invoicerr_db:5432/invoicerr_db` |
| `APP_URL` | Full public URL of the frontend (e.g. `https://invoicerr.example.com`). Required for email templates and links. |
| `JWT_SECRET` | Optional but recommended for JWT authentication. Any random string. If unset, a default secret is used, which can cause issues with Docker deployments. |
| `DEFAULT_LOCALE` | Optional. Instance-wide fallback language (`en`, `fr`, `it`, `pl`, `de`, or `pt`) for any document or system email whose client/company/user never set one of their own — see [Document Language](./document-language.md) for the full cascade. Left unset, everything renders in English exactly as before. |

Make sure port 80 is available on your host machine, or change the port mapping.

## Email delivery

Invoicerr needs to send emails (quote/invoice notifications, signature links). This is configured on
**two levels**:

- **Instance level** — the `MAIL_PROVIDER`/`SMTP_*`/`RESEND_API_KEY` variables below,
  set once for the whole deployment. Choose **one** provider with `MAIL_PROVIDER`, or leave it unset
  to auto-detect: `RESEND_API_KEY` present selects Resend (it wins even if `SMTP_HOST` is also set),
  otherwise SMTP is used.
- **Company level** — each company can set its own mail server in **Settings → Mail** (SMTP or
  Resend). A company's own server, when set, is used for everything that company sends, instead of
  the instance-level one below; a company that never configures one keeps using the instance level.
  A send is refused (never silently dropped) only if **neither** level is configured.

<Tabs>
<TabItem value="smtp" label="SMTP (default)">

```yaml
- MAIL_PROVIDER=smtp # can be omitted, this is the default
- SMTP_HOST=smtp-relay.example.com
- SMTP_USER="username@example.com"
- SMTP_FROM="user-from@example.com" # optional, defaults to SMTP_USER
- SMTP_PASSWORD="your_smtp_password"
- SMTP_PORT=587 # default SMTP port for TLS
- SMTP_SECURE=false # set to true if your SMTP server requires a secure connection
```

| Variable | Description |
| --- | --- |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` | Credentials and server used for sending emails |
| `SMTP_FROM` | Optional — sender address. Defaults to `SMTP_USER` if omitted |
| `SMTP_PORT` | SMTP port (default `587`) |
| `SMTP_SECURE` | Set to `true` if your SMTP server requires a secure connection |

:::info
Brevo (formerly Sendinblue) has no dedicated provider any more — use its own SMTP relay
(`smtp-relay.brevo.com`) with this SMTP option instead.
:::

</TabItem>
<TabItem value="resend" label="Resend">

```yaml
- MAIL_PROVIDER=resend
- RESEND_API_KEY="your_resend_api_key"
- MAIL_FROM="user-from@example.com" # optional, falls back to SMTP_FROM/SMTP_USER
```

| Variable | Description |
| --- | --- |
| `RESEND_API_KEY` | API key for sending emails via the [Resend](https://resend.com/) HTTP API instead of SMTP |
| `MAIL_FROM` | Optional — sender address. Falls back to `SMTP_FROM`, then `SMTP_USER`, if unset |

:::info
Setting `RESEND_API_KEY` alone, with `MAIL_PROVIDER` left unset, also selects Resend — it takes
priority over SMTP whenever both are present in the environment.
:::

</TabItem>
</Tabs>

## Instance operators

Most actions in Invoicerr are scoped to one company. A small number of actions are **instance-wide**
instead — they act across every company on this deployment at once. Today there is exactly one:
resetting the whole instance (Settings → Danger Zone → "Reset instance"), which permanently deletes
every company, user and document, then signs everyone out.

Nobody can do this by default. Set `INSTANCE_OPERATOR_EMAILS` to a comma-separated (case-insensitive)
list of e-mail addresses to name who can:

```yaml
- INSTANCE_OPERATOR_EMAILS=you@example.com,co-admin@example.com
```

Leaving it unset means no instance operator exists at all — the reset screen never appears, and the
underlying API routes refuse every caller.

The instance-reset feature itself is unavailable entirely on a hosted (SaaS) deployment, regardless
of this variable — the screen and its routes are hidden as if they did not exist, not merely
forbidden.

The SAME `INSTANCE_OPERATOR_EMAILS` list is also used by one other, unrelated route:
`GET /api/backup/status` (instance file-backup status), which used to trust any company's OWNER and
now requires a real instance operator instead — on self-hosted **and** on a hosted deployment alike
(unlike the reset feature, backup status is not hidden on SaaS).

:::danger
An instance reset is irreversible and cannot be scoped to "just one company" — it takes down every
company on the deployment. It still requires a fresh e-mailed confirmation code and typing
"RESET INSTANCE" exactly, but there is no undo once it runs.
:::
