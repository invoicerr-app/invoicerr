# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Invoicerr is an open-source invoicing application for freelancers to manage quotes, invoices, receipts, and clients. It's a monorepo with separate frontend and backend directories.

## Development Commands

### Backend (NestJS + Prisma)
```bash
cd backend
npm install
npx prisma generate        # Generate Prisma client (required before first run)
npm run start:dev          # Development with hot reload
npm run start:test         # Run with .env.test configuration
npm run lint               # ESLint with auto-fix
npm run test               # Jest unit tests
npm run test:e2e           # E2E tests
npm run migrate            # Run Prisma migrations
```

### Frontend (React + Vite)
```bash
cd frontend
npm install
npm run dev                # Development server (default port 5173)
npm run start:test         # Run with .env.test configuration
npm run build              # TypeScript check + Vite build
npm run lint               # ESLint
```

### E2E Tests (Cypress)
```bash
cd e2e
npm install
npm run e2e:open           # Interactive Cypress
npm run e2e:run            # Headless Cypress
```

## Architecture

### Backend (`/backend`)
- **Framework**: NestJS with TypeScript
- **Database**: PostgreSQL via Prisma ORM (schema at `prisma/schema.prisma`)
- **Authentication**: Better Auth with JWT and OIDC support (`@thallesp/nestjs-better-auth`)
- **Global auth guard**: Applied via `APP_GUARD` in `app.module.ts`

Key modules in `/backend/src/modules/`:
- `quotes/`, `invoices/`, `receipts/` - Core document management
- `clients/`, `company/` - Business entity management
- `signatures/` - Quote signing with OTP verification
- `webhooks/` - Event notifications (Discord, Slack, Teams, etc.)
- `plugins/` - Extensibility system (signing, storage providers)

### Frontend (`/frontend`)
- **Framework**: React 19 with TypeScript
- **Routing**: Generouted (file-based routing in `/src/pages/`)
- **UI**: Radix UI primitives + Tailwind CSS + shadcn/ui patterns
- **State**: React Hook Form with Zod validation
- **i18n**: i18next with 16 locales in `/src/locales/`
- **Auth client**: Better Auth React client (`/src/lib/auth.ts`)

Pages follow Generouted conventions:
- `(app)/` - Protected app routes (dashboard, quotes, invoices, etc.)
- `auth/` - Authentication pages
- `signature/[id]` - Public quote signing page

### Shared Patterns
- Path aliases: `@/` maps to `/src` in both frontend and backend
- Currency handling: Extensive `Currency` enum in Prisma schema
- PDF generation: Configurable via `PDFConfig` model with e-invoicing formats (Factur-X, ZUGFeRD, XRechnung, UBL, CII)

## Database

Prisma schema defines core models: `Company`, `Client`, `Quote`, `Invoice`, `Receipt`, `PaymentMethod`, `Signature`, `Webhook`, `Plugin`.

Run `npx prisma generate` in `/backend` after schema changes.

## Environment Setup

Copy `.env.example` files in both `backend/` and `frontend/` directories. Key variables:
- Backend: `DATABASE_URL`, `APP_URL`, `SMTP_*`, `OIDC_*`
- Frontend: `VITE_BACKEND_URL`

## Docker

Production deployment uses `docker-compose.yml` at root. The app runs on port 80 by default with PostgreSQL.

## Commit Guidelines

This project uses **gitmoji** commit conventions. See `COMMIT_GUIDELINES.md` for:
- Full emoji to type mapping
- Scope conventions (frontend, backend, compliance, etc.)
- Real examples from project history
- Body and footer formatting rules

**Quick reference:**
```
✨ feat(scope): Add new feature
🐛 fix(scope): Fix bug
♻️ refactor(scope): Code refactoring
📝 docs: Documentation changes
✅ test(e2e): Add tests
```

When I help you commit, I will:
1. Analyze the changes with `git diff`
2. Suggest appropriate commit type and scope
3. Write the message following project conventions
4. Include `Co-Authored-By` with the AI model's own identifier when it contributes significantly (the AI should identify itself)
