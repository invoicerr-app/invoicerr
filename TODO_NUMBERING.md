# TODO: Multi-Tenant Dynamic Numbering Implementation

## Orchestrator Instructions

This TODO file tracks the implementation of the multi-tenant dynamic numbering system.

**Architecture Document:** See `ARCHITECTURE_NUMBERING.md` for complete system design.

**Skills to Activate:**
- `skill nestjs-best-practices` (for backend services)
- `skill prisma-expert` (for database migrations)
- `skill design-patterns-expert` (for architecture patterns)
- `skill modular-architecture` (for module organization)

**Commit Convention:** Use gitmoji format
- ✨ feat: New features
- 🗄️ db: Database changes
- ♻️ refactor: Code refactoring
- 📝 docs: Documentation

**DO NOT commit this TODO.md file**

---

## Phase 1: Database Schema Updates

### Task 1.1: Add fields to Invoice model
**Assignee:** Database Agent
**Status:** ⬜ Pending
**Files:** `backend/prisma/schema.prisma`

Add fields:
- `series String?` - Document series (for ES, PT)
- `hash String?` - Hash for chaining (ES Veri*Factu, PT SAF-T)
- `platformId String?` - Platform-assigned number (Italy SDI)
- `platformStatus String?` - Transmission status

Commit: `🗄️ db: Add numbering fields to Invoice model`

### Task 1.2: Add fields to Quote model
**Assignee:** Database Agent
**Status:** ⬜ Pending
**Files:** `backend/prisma/schema.prisma`

Add same fields as Invoice.

Commit: `🗄️ db: Add numbering fields to Quote model`

### Task 1.3: Add fields to Receipt model
**Assignee:** Database Agent
**Status:** ⬜ Pending
**Files:** `backend/prisma/schema.prisma`

Add same fields as Invoice.

Commit: `🗄️ db: Add numbering fields to Receipt model`

### Task 1.4: Enhance NumberingSequence model
**Assignee:** Database Agent
**Status:** ⬜ Pending
**Files:** `backend/prisma/schema.prisma`

Add fields:
- `format String?` - Override format per series
- `resetPeriod String @default('never')` - Reset period
- `lastResetAt DateTime?` - Last reset timestamp

Commit: `🗄️ db: Enhance NumberingSequence with reset support`

### Task 1.5: Generate and run migrations
**Assignee:** Database Agent
**Status:** ⬜ Pending

```bash
cd backend
npx prisma migrate dev --name add_numbering_fields
npx prisma generate
```

Commit: `🗄️ db: Migration for numbering system`

---

## Phase 2: Country Configuration

### Task 2.1: Create Spain config
**Assignee:** Backend Agent
**Status:** ⬜ Pending
**Files:** `backend/src/modules/compliance/configs/countries/es.config.ts`

Configure numbering for Spain (Veri*Factu):
- seriesRequired: true
- hashChaining: true (SHA-256)
- gapAllowed: false
- resetPeriod: 'yearly'

Commit: `✨ feat(compliance): Add Spain numbering configuration`

### Task 2.2: Create Portugal config
**Assignee:** Backend Agent
**Status:** ⬜ Pending
**Files:** `backend/src/modules/compliance/configs/countries/pt.config.ts`

Configure numbering for Portugal (SAF-T):
- seriesRequired: true
- seriesRegistration: true
- hashChaining: true (RSA-SHA1)
- gapAllowed: false

Commit: `✨ feat(compliance): Add Portugal numbering configuration`

### Task 2.3: Create France config
**Assignee:** Backend Agent
**Status:** ⬜ Pending
**Files:** `backend/src/modules/compliance/configs/countries/fr.config.ts`

Configure numbering for France:
- seriesRequired: false
- hashChaining: false
- gapAllowed: true
- resetPeriod: 'never'

Commit: `✨ feat(compliance): Add France numbering configuration`

### Task 2.4: Register country configs
**Assignee:** Backend Agent
**Status:** ⬜ Pending
**Files:** `backend/src/modules/compliance/configs/index.ts`

Import and register ES, PT, FR configs in the registry.

Commit: `✨ feat(compliance): Register country numbering configs`

---

## Phase 3: Core Numbering Services

### Task 3.1: Create NumberingModule
**Assignee:** Backend Agent
**Status:** ⬜ Pending
**Files:** `backend/src/modules/numbering/numbering.module.ts`

Create NestJS module for numbering system.

Commit: `✨ feat(numbering): Create NumberingModule`

### Task 3.2: Implement NumberingOrchestratorService
**Assignee:** Backend Agent
**Status:** ⬜ Pending
**Files:** `backend/src/modules/numbering/numbering-orchestrator.service.ts`

Main facade service with methods:
- generateNext()
- previewNext()
- validateFormat()
- getSeriesList()
- checkGaps()

Commit: `✨ feat(numbering): Implement NumberingOrchestratorService`

### Task 3.3: Implement NumberingGeneratorService
**Assignee:** Backend Agent
**Status:** ⬜ Pending
**Files:** `backend/src/modules/numbering/numbering-generator.service.ts`

Atomic number generation with:
- Database transactions
- Format application
- Reset logic
- Sequence management

Commit: `✨ feat(numbering): Implement NumberingGeneratorService`

### Task 3.4: Implement SeriesManagerService
**Assignee:** Backend Agent
**Status:** ⬜ Pending
**Files:** `backend/src/modules/numbering/series-manager.service.ts`

Series management with:
- CRUD operations
- Validation against country rules
- Registration tracking

Commit: `✨ feat(numbering): Implement SeriesManagerService`

### Task 3.5: Integrate with ComplianceModule
**Assignee:** Backend Agent
**Status:** ⬜ Pending
**Files:** Update imports/exports

Export NumberingModule and integrate with ComplianceModule.

Commit: `♻️ refactor(numbering): Integrate with ComplianceModule`

---

## Phase 4: Document Services Integration

### Task 4.1: Refactor InvoicesService
**Assignee:** Backend Agent
**Status:** ⬜ Pending
**Files:** `backend/src/modules/invoices/invoices.service.ts`

Replace current numbering with NumberingOrchestrator:
- Update createInvoice() to use new system
- Add country context detection
- Handle series parameter

Commit: `♻️ refactor(invoices): Use dynamic numbering system`

### Task 4.2: Refactor QuotesService
**Assignee:** Backend Agent
**Status:** ⬜ Pending
**Files:** `backend/src/modules/quotes/quotes.service.ts`

Same changes as InvoicesService.

Commit: `♻️ refactor(quotes): Use dynamic numbering system`

### Task 4.3: Refactor ReceiptsService
**Assignee:** Backend Agent
**Status:** ⬜ Pending
**Files:** `backend/src/modules/receipts/receipts.service.ts`

Same changes as InvoicesService.

Commit: `♻️ refactor(receipts): Use dynamic numbering system`

### Task 4.4: Remove old numbering logic
**Assignee:** Backend Agent
**Status:** ⬜ Pending
**Files:** `backend/src/utils/pdf.ts`, `backend/src/prisma/prisma.service.ts`

Remove old formatPattern logic from Prisma extension once migration complete.

Commit: `🔥 remove: Old numbering logic`

---

## Phase 5: API Endpoints

### Task 5.1: Create NumberingController
**Assignee:** Backend Agent
**Status:** ⬜ Pending
**Files:** `backend/src/modules/numbering/numbering.controller.ts`

Create REST endpoints:
- GET /api/numbering/preview
- POST /api/numbering/validate-format
- GET /api/numbering/series
- POST /api/numbering/series
- DELETE /api/numbering/series/:id
- GET /api/numbering/gaps

Commit: `✨ feat(numbering): Add API endpoints`

### Task 5.2: Add DTOs
**Assignee:** Backend Agent
**Status:** ⬜ Pending
**Files:** `backend/src/modules/numbering/dto/`

Create DTOs for all endpoints.

Commit: `✨ feat(numbering): Add DTOs`

### Task 5.3: Add guards and validation
**Assignee:** Backend Agent
**Status:** ⬜ Pending

Add CompanyGuard and RoleGuard to endpoints.

Commit: `🔒 security(numbering): Add authorization`

---

## Phase 6: Frontend Implementation

### Task 6.1: Create NumberingSettings page
**Assignee:** Frontend Agent
**Status:** ⬜ Pending
**Files:** `frontend/src/pages/(app)/settings/numbering.tsx`

Enhanced numbering settings with:
- Format configuration
- Live preview
- Series management (conditional)
- Country rule display

Commit: `✨ feat(frontend): Add NumberingSettings page`

### Task 6.2: Create SeriesManager component
**Assignee:** Frontend Agent
**Status:** ⬜ Pending
**Files:** `frontend/src/components/numbering/series-manager.tsx`

Modal/component for managing document series.

Commit: `✨ feat(frontend): Add SeriesManager component`

### Task 6.3: Create NumberPreview component
**Assignee:** Frontend Agent
**Status:** ⬜ Pending
**Files:** `frontend/src/components/numbering/number-preview.tsx`

Component showing next invoice number preview.

Commit: `✨ feat(frontend): Add NumberPreview component`

### Task 6.4: Update Document Creation Forms
**Assignee:** Frontend Agent
**Status:** ⬜ Pending
**Files:** 
- `frontend/src/pages/(app)/invoices/new.tsx`
- `frontend/src/pages/(app)/quotes/new.tsx`

Add:
- Series selector (conditional on country)
- Number preview
- Country compliance warnings

Commit: `✨ feat(frontend): Update document forms with numbering`

### Task 6.5: Update Settings navigation
**Assignee:** Frontend Agent
**Status:** ⬜ Pending
**Files:** `frontend/src/pages/(app)/settings/_components/company.settings.tsx`

Add link to new NumberingSettings page.

Commit: `✨ feat(frontend): Add numbering settings link`

### Task 6.6: Add API hooks
**Assignee:** Frontend Agent
**Status:** ⬜ Pending
**Files:** `frontend/src/hooks/use-numbering.ts`

Create React hooks for numbering API:
- useNumberingPreview
- useSeriesList
- useCreateSeries
- useDeleteSeries

Commit: `✨ feat(frontend): Add numbering hooks`

---

## Phase 7: Testing & Validation

### Task 7.1: Unit tests for services
**Assignee:** Testing Agent
**Status:** ⬜ Pending
**Files:** `backend/src/modules/numbering/*.spec.ts`

Test:
- NumberingGeneratorService
- NumberingOrchestratorService
- SeriesManagerService

Commit: `✅ test(numbering): Add unit tests`

### Task 7.2: Integration tests
**Assignee:** Testing Agent
**Status:** ⬜ Pending
**Files:** `backend/test/numbering.e2e-spec.ts`

Test document creation with numbering per country.

Commit: `✅ test(numbering): Add integration tests`

### Task 7.3: E2E tests
**Assignee:** Testing Agent
**Status:** ⬜ Pending
**Files:** `e2e/cypress/e2e/numbering.cy.ts`

E2E tests for:
- Number generation
- Series management
- Country-specific rules

Commit: `✅ test(e2e): Add numbering E2E tests`

### Task 7.4: Load testing
**Assignee:** Testing Agent
**Status:** ⬜ Pending

Verify atomic generation under concurrent load.

Commit: `⚡️ perf(numbering): Load testing`

---

## Phase 8: Migration & Deployment

### Task 8.1: Data migration script
**Assignee:** Backend Agent
**Status:** ⬜ Pending
**Files:** `backend/scripts/migrate-numbering.ts`

Script to backfill existing documents with default values.

Commit: `🗄️ db: Add numbering migration script`

### Task 8.2: Feature flags
**Assignee:** Backend Agent
**Status:** ⬜ Pending

Add feature flag to enable new numbering gradually.

Commit: `✨ feat(numbering): Add feature flags`

### Task 8.3: Documentation
**Assignee:** Documentation Agent
**Status:** ⬜ Pending
**Files:** 
- Update `ARCHITECTURE_NUMBERING.md`
- Update `CLAUDE.md`

Document the new system for developers.

Commit: `📝 docs: Update numbering documentation`

---

## Dependencies Between Tasks

```
Phase 1 (DB)
    │
    ▼
Phase 2 (Country Configs) ───────┐
    │                            │
    ▼                            │
Phase 3 (Core Services) ◄────────┘
    │
    ▼
Phase 4 (Integration)
    │
    ▼
Phase 5 (API)
    │
    ▼
Phase 6 (Frontend)
    │
    ▼
Phase 7 (Testing)
    │
    ▼
Phase 8 (Deploy)
```

---

## Status Summary

- ⬜ Not Started
- 🟡 In Progress
- 🟢 Completed
- 🔴 Blocked

**Overall Progress:** 0/35 tasks completed (0%)

---

## Notes for Agents

### Backend Agent Notes:
- Use atomic transactions for number generation
- Validate series against country rules
- Handle reset logic (yearly/monthly)
- Integrate with existing HashChainService

### Frontend Agent Notes:
- Use existing form patterns (React Hook Form + Zod)
- Follow shadcn/ui component conventions
- Add i18n keys for all new text
- Show loading states during API calls

### Database Agent Notes:
- Keep new fields nullable for migration
- Add indexes on frequently queried fields
- Test migrations on copy of production data

### Testing Agent Notes:
- Test concurrent number generation
- Test gap detection
- Test per-country rules
- Test reset logic

### Documentation Agent Notes:
- Document country-specific behaviors
- Add examples for each configuration
- Update API documentation

---

## Questions for Product Owner

1. **Priority countries**: Which countries to implement first? (Recommended: ES, PT, FR)
2. **Series registration**: Auto-register PT series or manual process?
3. **Format validation**: Strict regex validation or flexible?
4. **Gap handling**: Alert on gaps or just detect?
5. **Migration**: Can we have downtime for migration?

---

**Last Updated:** 2025-02-04
**Orchestrator:** Assign tasks to agents based on dependencies and availability
