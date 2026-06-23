---
sidebar_position: 3
---

# Manual Installation (Local Development)

## Prerequisites

- Node.js v20+
- SQLite (or configure another `DATABASE_URL`)
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
