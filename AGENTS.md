# OpenCode Agent Configuration for Invoicerr

This file provides context and instructions for OpenCode when working with the Invoicerr project.

## Project Context

Invoicerr is an open-source invoicing application for freelancers built as a TypeScript monorepo:
- **Frontend**: React 19 + Vite + Tailwind + shadcn/ui + Generouted
- **Backend**: NestJS + Prisma + PostgreSQL + Better Auth
- **Tests**: Cypress E2E + Jest
- **Features**: Quotes, Invoices, Receipts, Multi-company, PDF generation, Webhooks

## Always Active Behaviors

### 1. Commit Message Assistance
When the user asks to commit, create commits, or write commit messages:
- **ALWAYS** read `COMMIT_GUIDELINES.md` first
- Analyze changes with `git status` and `git diff`
- Use gitmoji format: `<emoji> <type>[(scope)]: <description>`
- Suggest appropriate type (feat, fix, refactor, docs, test)
- Include scope when relevant (frontend, backend, compliance, etc.)
- Add `Co-Authored-By` with the current AI model name when it contributes significantly. The AI should identify itself (e.g., `Co-Authored-By: [Model Name] <noreply@provider.com>`)
- Write body explaining WHAT and WHY for complex changes

### 2. Context Detection
Based on file paths, automatically suggest relevant skills:

**Frontend Context** (files in `frontend/`, `.tsx`, `.css`):
- Suggest: vercel-react-best-practices, tailwind-v4-shadcn, react-hook-form-zod

**Backend Context** (files in `backend/`, `.prisma`, `.entity.ts`):
- Suggest: nestjs-best-practices, prisma-expert, api-security-best-practices

**Documents Context** (files with `invoice`, `quote`, `pdf`, `receipt`):
- Suggest: business-document-generator, pdf-generator, finance-expert

**Webhooks Context** (files with `webhook`, `slack`, `discord`):
- Suggest: webhook-integration, slack-webhook, discord-webhook

**Architecture Context** (keywords: pattern, refactor, structure):
- Suggest: design-patterns-expert, modular-architecture, monorepo-architect

### 3. Code Quality Checks
Before suggesting commits:
- Check if linting passes (`npm run lint` in relevant directory)
- Verify TypeScript compilation
- Suggest running tests for modified areas

## Available Skills

These skills are recommended for this project but may not be installed on your system. Install them as needed:

### Installing Skills

```bash
# Install a skill globally (available for all projects)
npx skills add <owner/repo@skill-name> -g

# Find skills
npx skills find <keyword>

# Check installed skills
ls ~/.agents/skills/
```

### Recommended Skills by Context

**Frontend Development:**
- `vercel-react-best-practices` - React performance optimization
- `tailwind-v4-shadcn` - Tailwind CSS and shadcn/ui
- `react-hook-form-zod` - Form validation patterns
- `i18n-localization` - Internationalization
- `frontend-architecture` - Frontend structure

**Backend Development:**
- `nestjs-best-practices` - NestJS patterns
- `prisma-expert` - Prisma ORM expertise
- `prisma-migration-assistant` - Database migrations
- `api-security-best-practices` - API security
- `auth-implementation-patterns` - Authentication patterns
- `typescript-advanced-types` - Advanced TypeScript

**Architecture & Design:**
- `design-patterns-expert` - Design patterns
- `modular-architecture` - Modular system design
- `monorepo-architect` - Monorepo structure

**Documents & PDF:**
- `business-document-generator` - Business document generation
- `pdf-generator` - PDF generation
- `finance-expert` - Financial logic

**Integrations:**
- `webhook-integration` - Webhook patterns
- `slack-webhook` - Slack integrations
- `discord-webhook` - Discord integrations

**Testing:**
- `e2e-testing-patterns` - E2E testing

### Using Skills

Once installed, activate a skill:
```bash
skill <skill-name>
```

Or let the AI detect context and suggest relevant skills automatically.

## Development Workflow

1. **Before coding**: Check current branch, suggest skill activation based on task
2. **While coding**: Follow project conventions from CLAUDE.md
3. **Before commit**: Run linters and type checks
4. **Commit**: Follow gitmoji conventions from COMMIT_GUIDELINES.md
5. **After commit**: Verify CI/CD if applicable

## Important Notes

- This is a **monorepo** with separate frontend/ and backend/ directories
- **Better Auth** is used for authentication (JWT + OIDC)
- **Prisma** is the ORM - run `npx prisma generate` after schema changes
- **i18n** supports 16 locales
- **PDF generation** includes e-invoicing formats (Factur-X, ZUGFeRD, etc.)
- Path aliases `@/` map to `/src` in both frontend and backend

## Commands Reference

```bash
# Backend
cd backend && npm run start:dev    # Dev server
cd backend && npm run lint         # Linting
cd backend && npm run test         # Unit tests
cd backend && npx prisma generate  # After schema changes

# Frontend
cd frontend && npm run dev         # Dev server
cd frontend && npm run build       # Production build
cd frontend && npm run lint        # Linting

# E2E
cd e2e && npm run e2e:run          # Headless tests
cd e2e && npm run e2e:open         # Interactive mode
```
