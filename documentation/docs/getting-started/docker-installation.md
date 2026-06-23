---
sidebar_position: 2
---

# Docker Installation (Recommended)

The fastest way to run Invoicerr is using Docker Compose. A prebuilt image is available at [ghcr.io/invoicerr-app/invoicerr](https://ghcr.io/invoicerr-app/invoicerr).

## Supported architectures

- `linux/amd64` (x86_64)
- `linux/arm64/v8` (ARMv8)

`linux/arm/v7` is not supported, since Prisma does not provide prebuilt binaries for that architecture — the application will not run on 32-bit ARM devices.

## Quick start

1. Clone the repository:

   ```bash
   git clone https://github.com/invoicerr-app/invoicerr.git
   cd invoicerr
   ```

2. Edit `docker-compose.yml` to set your environment variables.

3. Run the app:

   ```bash
   docker compose up -d
   ```

4. Open your browser at `http://localhost`.

## Environment variables

These are defined in `docker-compose.yml` under the `invoicerr` service:

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string, e.g. `postgresql://invoicerr:invoicerr@invoicerr_db:5432/invoicerr_db` |
| `APP_URL` | Full public URL of the frontend (e.g. `https://invoicerr.example.com`). Required for email templates and links. |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` | Credentials and server used for sending emails (quotes, invoices, etc.) |
| `SMTP_FROM` | Optional — sender address for emails. Defaults to `SMTP_USER` if omitted. |
| `JWT_SECRET` | Optional but recommended for JWT authentication. Any random string. If unset, a default secret is used, which can cause issues with Docker deployments. |

Make sure port 80 is available on your host machine, or change the port mapping.
