---
sidebar_position: 0
---

# Manual Installation (Local Development)

## Prerequisites

- Node.js — the app itself (NestJS 12) boots on v20.19+, but the backend test runner (Vitest 5)
  refuses to start below v22.12, so use **v22.12+** to actually run `npm test`.
- PostgreSQL — the repo ships `docker-compose.dev.yml` to start one locally (also Redis and Mailpit), or point `DATABASE_URL` at your own instance
- npm

## Steps

1. Clone the project:

   ```bash
   git clone https://github.com/invoicerr-app/invoicerr.git
   cd invoicerr
   ```

2. Backend setup:

   ```bash
   cd backend
   npm install
   npx prisma generate
   npm run start
   ```

   PDF generation (every document type shares one renderer — quotes, invoices, credit notes,
   expenses, received invoices, purchase orders, goods receipts) needs a Chromium/Chrome binary. Outside
   the Docker image nothing provides one automatically, so run `npx playwright-core install chromium`
   once to fetch a matching build — or point `CHROMIUM_EXECUTABLE_PATH` at a browser you already have
   (see `backend/.env.example`).

3. Frontend setup, in a new terminal:

   ```bash
   cd frontend
   npm install
   npm run start
   ```

4. Open in your browser:
   - Frontend: `http://localhost:5173`
   - API: `http://localhost:3000`

## Running end-to-end tests (Cypress)

1. Start the backend and frontend with the test environment variables:

   ```bash
   cd backend && npm run start:test &
   cd frontend && npm run start:test &
   ```

   Make sure you have a `.env.test` file in each directory.

2. In another terminal, run Cypress:

   ```bash
   cd e2e
   npm install
   npm run e2e:open # or npm run e2e:run
   ```

In CI, the GitHub Actions workflow runs these steps automatically.
