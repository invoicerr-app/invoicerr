---
sidebar_position: 2
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

         # Email delivery - see "Email delivery" below for the Brevo alternative
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

## Environment variables

These are set under the `invoicerr` service's `environment` key.

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string, e.g. `postgresql://invoicerr:invoicerr@invoicerr_db:5432/invoicerr_db` |
| `APP_URL` | Full public URL of the frontend (e.g. `https://invoicerr.example.com`). Required for email templates and links. |
| `JWT_SECRET` | Optional but recommended for JWT authentication. Any random string. If unset, a default secret is used, which can cause issues with Docker deployments. |

Make sure port 80 is available on your host machine, or change the port mapping.

## Email delivery

Invoicerr needs to send emails (quote/invoice notifications, signature links). Choose **one** provider with `MAIL_PROVIDER`:

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

</TabItem>
<TabItem value="brevo" label="Brevo">

```yaml
- MAIL_PROVIDER=brevo
- BREVO_API_KEY="your_brevo_api_key"
- MAIL_FROM="user-from@example.com" # optional, falls back to SMTP_FROM/SMTP_USER
```

| Variable | Description |
| --- | --- |
| `BREVO_API_KEY` | API key for sending emails via the [Brevo](https://www.brevo.com/) transactional email API instead of SMTP |
| `MAIL_FROM` | Optional — sender address. Falls back to `SMTP_FROM`, then `SMTP_USER`, if unset |

:::info
Use Brevo when you don't want to run or pay for an SMTP relay — it sends email through Brevo's HTTP API instead.
:::

</TabItem>
</Tabs>
