# Invoicerr


![Invoicerr Banner](https://github.com/Impre-visible/invoicerr/blob/ac4ea3fb8293b63e0b58bd33ea38b6b7018f673a/Invoicerr_banner.webp)

Invoicerr is a simple, open-source invoicing application designed to help freelancers manage their quotes and invoices efficiently. It provides a clean interface for creating, sending, and tracking quotes and invoices — so you get paid faster, with less hassle.

---

![Dashboard Page](https://github.com/user-attachments/assets/18e8af88-cf02-4e35-975a-d57f58d062c6)

<section>
<img src="https://wakatime.com/badge/user/4cf4132a-4ced-411d-b714-67bdbdc84527/project/2f27011d-6794-4fbe-97c9-9fdef2550fc7.svg?style=flat">
<img src="https://m3-markdown-badges.vercel.app/stars/12/1/Impre-visible/invoicerr">
<img src="https://m3-markdown-badges.vercel.app/issues/12/1/Impre-visible/invoicerr">
</section>

## ✨ Features

- Create and manage invoices  
- Create and manage quotes (convertible to invoices)  
- Manage clients and their contact details  
- Track status of quotes and invoices (signed, paid, unread, etc.)  
- Built-in quote signing system with secure tokens  
- Generate and send quote/invoice emails directly from the app
- Generate clean PDF documents (quotes, invoices, receipts, and more)  
- Custom brand identity: logo, company name, VAT, and more  
- Authentication via JWT or OIDC (stored in cookies)
- International-friendly: Default English UI, customizable currencies  
- SQLite database for quick local setup  
- Docker & docker-compose ready for self-hosting  
- Built with modern stack: React, NestJS, Prisma, SQLite/PostgreSQL  
- REST API backend, ready for future integrations (mobile & desktop apps)
- Plugin system for community-made features

---

## 🌍 Translation

Invoicerr uses weblate to easily manage the translations

[![Translation status](https://hosted.weblate.org/widget/invoicerr/horizontal-auto.svg)](https://hosted.weblate.org/engage/invoicerr/)

[![Translation status](https://hosted.weblate.org/widget/invoicerr/open-graph.png)](https://hosted.weblate.org/engage/invoicerr/)

---

## 🐳 Docker Installation (Recommended)

#### Supported Architectures

The images are built for the following architectures:

- `linux/amd64` (x86_64)
- `linux/arm64/v8` (ARMv8)

#### Why not `linux/arm/v7`?

The `linux/arm/v7` architecture is not supported due to the use of prisma, which does not provide prebuilt binaries for this architecture. This means that the application will not run on 32-bit ARM devices.

The fastest way to run Invoicerr is using Docker Compose. A prebuilt image is available at [ghcr.io/impre-visible/invoicerr](https://ghcr.io/impre-visible/invoicerr).

### 🚀 Quick Start

1. Clone the repository:  
   ```bash
   git clone https://github.com/Impre-visible/invoicerr.git
   cd invoicerr
   ```

2. Edit the `docker-compose.yml` to set your environment variables.

3. Run the app:  
   ```bash
   docker compose up -d
   ```

4. Open your browser at:  
   ```
   http://localhost
   ```

---

### 🔧 Environment Variables

These environment variables are defined in `docker-compose.yml` under the `invoicerr` service:

- `DATABASE_URL`  
  PostgreSQL connection string. Example:  
  `postgresql://invoicerr:invoicerr@invoicerr_db:5432/invoicerr_db`

- `APP_URL`  
  Full public URL of the frontend (e.g., `https://invoicerr.example.com`).  
  This is required for email templates and links.

- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`  
  Credentials and server used for sending emails (quotes, invoices, etc.)

- `SMTP_FROM`  
  Optional — address used as the sender for emails. If omitted, defaults to `SMTP_USER`.

- `JWT_SECRET`  
  Optional but recommended for JWT authentication. Can be any random string.  
  If not set, a default secret will be used. But it can have issues with docker deployments.

Make sure port 80 is available on your host machine, or change the mapping.

---

## 💻 Manual Installation (Local Development)

### Prerequisites

- Node.js v20+  
- SQLite (or configure another `DATABASE_URL`)  
- PNPM or NPM

### Steps

1. Clone the project:  
   ```bash
   git clone https://github.com/Impre-visible/invoicerr.git
   cd invoicerr
   ```

2. Backend setup:  
   ```bash
   cd backend
   npm install
   npx prisma generate
   npm run start
   ```

3. Frontend setup (in a new terminal):  
   ```bash
   cd frontend
   npm install
   npm run start
   ```

4. Open in your browser:
   - Frontend: `http://localhost:5173`
   - API: `http://localhost:3000`

---

## 🤖 Claude Code Users

This repository includes a `CLAUDE.md` file at the root, which provides context and instructions for [Claude Code](https://claude.ai/code) (Anthropic's CLI tool for AI-assisted development).

**If you're using Claude Code to contribute to this project, you don't need to create your own `CLAUDE.md` file.** The included file contains project-specific guidelines, architecture overview, and development commands that Claude Code will automatically use.

> **Note:** This file is provided as a convenience for contributors using AI-assisted development tools. It does not affect the application itself and can be safely ignored if you're not using Claude Code.

---

## 🧪 Running End-to-End Tests (Cypress)

To run e2e tests locally or in CI:

1. Start the backend and frontend with test environment variables:
   ```bash
   cd backend && npm run start:test &
   cd frontend && npm run start:test &
   ```
   (Make sure you have a `.env.test` file in each folder)

2. In another terminal, run Cypress:
   ```bash
   cd e2e
   npm install
   npm run e2e:open # or npm run e2e:run
   ```

In CI, the GitHub Actions workflow handles these steps automatically.

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
- <img src="https://ziadoua.github.io/m3-Markdown-Badges/badges/SQLite/sqlite1.svg"/>
- <img src="https://ziadoua.github.io/m3-Markdown-Badges/badges/PostgreSQL/postgresql1.svg"/>
- <img src="https://ziadoua.github.io/m3-Markdown-Badges/badges/TailwindCSS/tailwindcss1.svg"/>
- <img src="https://ziadoua.github.io/m3-Markdown-Badges/badges/Docker/docker1.svg"/>

## ⚖️ License

This project is dual-licensed:
- Open Source: [AGPL-3.0](./LICENSE)
- Commercial: [COMMERCIAL-LICENSE](./COMMERCIAL-LICENSE)

Contact me for commercial use.
