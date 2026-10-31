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

:::warning[32-bit ARM is no longer supported]
`linux/arm/v7` was dropped from the image's multi-arch manifest. Node.js stopped publishing
`linux-armv7l` binaries starting with Node 24, which both this image and its base image
(`server-image`) now run on. If you were running Invoicerr on a 32-bit ARM board (Raspberry Pi
2/3/Zero on the 32-bit OS), install a 64-bit OS on the same board and pull the image again: any
board capable of 64-bit Debian (Pi 3 and newer) runs the `linux/arm64/v8` image unchanged.
:::

## Image tags

Every image is tagged with a CalVer release: `AA.M.N`, where `AA` is the two-digit year, `M` the
month without a leading zero, and `N` a counter that restarts at zero every month. The first
stable release is `26.11.0`; a pre-release of it is `26.11.0-beta.1` or `26.11.0-rc.1`.

Three moving tags exist, one per channel:

| Tag | Follows | GitHub release |
| --- | --- | --- |
| `latest` | the newest stable release | yes |
| `beta` | the newest tagged beta/rc | yes, as a pre-release |
| `nightly` | every commit merged into `dev` | no |

A pre-release is never published as `latest`: to run one, write its exact tag in `image:`, such as
`ghcr.io/invoicerr-app/invoicerr:26.11.0-beta.1`. The
[releases page](https://github.com/invoicerr-app/invoicerr/releases) lists every tag, pre-releases
included. Only the newest release is supported, and migrations are cumulative, so an instance can
skip versions when upgrading: pull the new image and restart.

## Quick start

1. Create a `.env` file next to where `docker-compose.yml` will live, holding the two secrets the
   compose file below reads:

   ```bash title=".env"
   POSTGRES_PASSWORD=<output of: openssl rand -hex 24>
   BETTER_AUTH_SECRET=<output of: openssl rand -hex 32>
   ```

2. Create a `docker-compose.yml` file with the following content, then adjust the environment variables to your setup:

   ```yaml title="docker-compose.yml"
   services:
     invoicerr:
       image: ghcr.io/invoicerr-app/invoicerr:latest
       ports:
         - "80:80"
       volumes:
         - documents_data:/data
       environment:
         - DATABASE_URL=postgresql://invoicerr:${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in a .env file next to this one}@invoicerr_db:5432/invoicerr_db
         - APP_URL=https://invoicerr.example.com
         - CORS_ORIGINS=http://localhost:5173,https://invoicerr.example.com

         # Redis — required (BullMQ queues the document-send jobs). No password on a
         # single-host Docker network by default; set REDIS_PASSWORD on both services to add one.
         - REDIS_HOST=redis
         - REDIS_PORT=6379

         # Email delivery - see "Email delivery" below for the Resend alternative (Brevo's own SMTP
         # relay also works with the SMTP settings below)
         - SMTP_HOST=smtp-relay.example.com
         - SMTP_USER=username@example.com
         - SMTP_FROM=user-from@example.com
         - SMTP_PASSWORD=your_smtp_password
         - SMTP_PORT=587
         - SMTP_SECURE=false

         - BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET:?set BETTER_AUTH_SECRET in a .env file next to this one}

         # Generated PDFs, the legal archive, received invoices and logos: kept on the volume above.
         - DOCUMENTS_ARCHIVE_DIR=/data/documents-archive
         - DOCUMENTS_INBOUND_DIR=/data/documents-inbound
       depends_on:
         - invoicerr_db
         - redis

     invoicerr_db:
       image: postgres:15
       environment:
         POSTGRES_USER: invoicerr
         # Postgres applies this only on first init of an empty volume.
         POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in a .env file next to this one}
         POSTGRES_DB: invoicerr_db
       volumes:
         - db_data:/var/lib/postgresql/data

     redis:
       image: bitnami/redis:latest
       environment:
         ALLOW_EMPTY_PASSWORD: "yes"
       volumes:
         - redis_data:/bitnami

   volumes:
     db_data:
       driver: local
     redis_data:
       driver: local
     documents_data:
       driver: local
   ```

   The app will not boot at all without a reachable Redis — it is not optional, and there is no
   degraded fallback if it is missing.

   :::warning[No quotes in list-style values]
   In the `- KEY=value` form used above, Docker Compose keeps quotes as part of the value:
   `- SMTP_USER="me@example.com"` sets the user to `"me@example.com"`, quotes included, and the SMTP
   server refuses it. Write the value bare, even when it contains spaces. Quotes are only stripped in
   the `KEY: "value"` map form and in a `.env` file.
   :::

3. Run the app:

   ```bash
   docker compose up -d
   ```

4. Open your browser at the address set in `APP_URL`. To try it on your own machine first, set
   `APP_URL=http://localhost` and open `http://localhost`; see [HTTP on a LAN or HTTPS behind a
   reverse proxy](#http-on-a-lan-or-https-behind-a-reverse-proxy) for anything else.

:::tip
The repository's [`docker-compose.yml`](https://github.com/invoicerr-app/invoicerr/blob/main/docker-compose.yml) also includes an OIDC example (placeholder values, live rather than commented out — set `OIDC_CLIENT_ID` to actually register the provider, or remove the whole block if you don't want single sign-on).
:::

## Updating

`docker compose pull && docker compose up -d` picks up a new image and re-applies pending database
migrations automatically on the container's next boot — same as any other restart.

:::warning[Upgrading from a version with no POSTGRES_PASSWORD]
Versions before this change hardcoded the database password to `invoicerr`. Postgres only applies
`POSTGRES_PASSWORD` the first time it initialises its volume, so an existing deployment's database
still has the old password regardless of what you now set. Pick one:

- Set `POSTGRES_PASSWORD=invoicerr` in your `.env` to match what the database already has, and move
  on. You can change it later with the option below.
- Pick a new password, connect to the running database (`docker compose exec invoicerr_db psql -U
  invoicerr`) and run `ALTER USER invoicerr PASSWORD 'your-new-password';`, then set that same value
  as `POSTGRES_PASSWORD` in your `.env` before the next `docker compose up -d`.

Setting a `POSTGRES_PASSWORD` that does not match what is actually inside the database makes the app
fail to connect; it does not reset anything inside Postgres by itself.
:::

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
| `DATABASE_URL` | PostgreSQL connection string, built from `POSTGRES_PASSWORD` below, e.g. `postgresql://invoicerr:${POSTGRES_PASSWORD}@invoicerr_db:5432/invoicerr_db` |
| `POSTGRES_PASSWORD` | Required. The `invoicerr_db` service's own password, generated with e.g. `openssl rand -hex 24`. Postgres sets it only once, the first time the database volume is initialised; see the upgrade warning below before changing it on an existing deployment. |
| `APP_URL` | The address users open in their browser, scheme and port included (e.g. `https://invoicerr.example.com` or `http://nas.local:8181`). Used for email links, as better-auth's own base URL, and to decide whether session cookies are `Secure`. Sign-in is refused from any other address unless it is listed in `CORS_ORIGINS`. |
| `CORS_ORIGINS` | Optional. Comma-separated extra addresses users may open the app from besides `APP_URL` (e.g. `http://192.168.1.20:8181` when `APP_URL` uses a host name). |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | Required — the app refuses to boot without a reachable Redis (BullMQ queues every document-send job). Defaults to `localhost:6379`, no password, if unset; `REDIS_URL` (e.g. `redis://:pass@redis:6379`) is accepted instead and wins when both are set. |
| `BETTER_AUTH_SECRET` | Required. Signs every session; generate it with `openssl rand -hex 32`. The app refuses to boot when it is unset (and `JWT_SECRET` too) or still set to a placeholder such as `your_better_auth_secret`. |
| `JWT_SECRET` | A **legacy fallback only** — better-auth reads `BETTER_AUTH_SECRET \|\| JWT_SECRET`. Set `BETTER_AUTH_SECRET` instead for anything new; this one exists so an older deployment that only ever set `JWT_SECRET` keeps working unchanged. |
| `DOCUMENTS_ARCHIVE_DIR` | Where generated PDFs and the legal document archive are written. Point it inside a volume (`/data/documents-archive` in the example): left unset, files go to the container's own filesystem and are lost when the container is recreated, for example on every update. |
| `DOCUMENTS_INBOUND_DIR` | Where received invoices, expense attachments and company logos are stored. Same rule: inside the volume (`/data/documents-inbound`). |
| `DEFAULT_LOCALE` | Optional. Instance-wide fallback language (`en`, `fr`, `it`, `pl`, `de`, or `pt`) for any document or system email whose client/company/user never set one of their own — see [Document Language](./document-language.md) for the full cascade. Left unset, everything renders in English exactly as before. |
| `PDF_RENDER_CONCURRENCY` | Optional, `4` by default. How many PDFs one process renders at once; further requests wait their turn. Up to this many Chromium pages stay open between renders so the next one starts faster, which costs memory even when idle. |
| `SESSION_CACHE_TTL_MS` | Optional, `10000` (10 seconds) by default. How long the API keeps a signed-in session in memory instead of reading it from the database on every request. Sign-outs, company switches and membership or role changes are still seen by the very next request. `0` turns the cache off. |
| `ADDRESS_AUTOCOMPLETE_URL` | Optional, empty by default. Turns on address suggestions (street, house number, postcode, city, country) while typing a client's or your company's address - see [Address autocomplete](#address-autocomplete) below. |

Make sure port 80 is available on your host machine, or change the port mapping.

## HTTP on a LAN or HTTPS behind a reverse proxy

Session cookies follow the scheme of `APP_URL`: `Secure` for `https://`, plain for `http://`. A
browser drops a `Secure` cookie received over plain HTTP, so `APP_URL` must be the exact address
users type, scheme included.

**Over plain HTTP on a local network.** Map a port and give that address:

```yaml
ports:
  - "8181:80"
environment:
  - APP_URL=http://nas.local:8181
```

Sign-in works, and the backend logs one warning at boot: passwords and session cookies travel
unencrypted, so anyone on the same network can read them. Keep this for a network you trust, never
for an instance reachable from the internet.

**Over HTTPS behind a reverse proxy** (Caddy, Traefik, nginx, a Cloudflare tunnel). The proxy
terminates TLS and forwards to the container's port 80:

```yaml
environment:
  - APP_URL=https://invoicerr.example.com
  - TRUST_PROXY_HOPS=2
```

`APP_URL` is the public `https://` address, never the internal `http://` one the proxy forwards to.
`TRUST_PROXY_HOPS` counts the HTTP proxies in front of the app, the container's own nginx included,
so that rate limits apply per client rather than to the proxy's address.

:::info[When sign-in fails]
The sign-in page names the cause:

- **This address cannot sign in**: the page was opened from an address that is neither `APP_URL`
  nor listed in `CORS_ORIGINS` (for example by IP while `APP_URL` uses a host name). Open the
  `APP_URL` address, or add the other one to `CORS_ORIGINS`.
- **Signed in, but no session was kept**: the browser dropped the session cookie, usually because
  `APP_URL` says `https://` while the page was opened over `http://`. Open the `https://` address,
  or set `APP_URL` to the `http://` one.
:::

## Address autocomplete

Off by default: leave `ADDRESS_AUTOCOMPLETE_URL` unset and the address fields work exactly as
before, plain text, with zero outbound requests. Setting it points this instance at a
[Photon](https://github.com/komoot/photon) geocoder (the same OpenStreetMap data as Nominatim, but
built for type-ahead - Nominatim's own usage policy explicitly forbids autocomplete). Your browser
never talks to Photon directly: the frontend calls this backend, which proxies the request to
whichever server you configured, so the choice below stays server-side and the request is
authenticated and rate-limited like any other endpoint.

Two options:

- **`https://photon.komoot.io`** - komoot's own free server. The quickest way to turn this on, but it
  is shared and fair-use only ("extensive usage will be throttled or completely banned", per its own
  terms) - fine for a small/personal instance, not appropriate for a large one.
- **Your own Photon container**, e.g. `http://photon:2322` on the same Docker network. The only
  appropriate choice once you have real traffic: Photon's own search index ranges from a few GB for
  one country to 100GB+ for the whole planet, which is why it is never bundled into the Invoicerr
  image itself. See the [Photon repository](https://github.com/komoot/photon) for the container image
  and how to build or download an index.

```yaml
- ADDRESS_AUTOCOMPLETE_URL=https://photon.komoot.io
```

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
- SMTP_USER=username@example.com
- SMTP_FROM=user-from@example.com # optional, defaults to SMTP_USER
- SMTP_PASSWORD=your_smtp_password
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
- RESEND_API_KEY=your_resend_api_key
- MAIL_FROM=user-from@example.com # optional, falls back to SMTP_FROM/SMTP_USER
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
