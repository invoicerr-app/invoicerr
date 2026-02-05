# Multi-Tenant Dynamic Numbering Architecture

## Overview

This document describes the architecture for implementing a multi-tenant, country-aware dynamic numbering system for quotes, invoices, and receipts in Invoicerr.

## Current State Analysis

### Existing Components

1. **Basic Numbering (Implemented)**
   - Company-level format configuration (`quoteNumberFormat`, `invoiceNumberFormat`, `receiptNumberFormat`)
   - Format placeholders: `{year}`, `{month}`, `{day}`, `{number}`, `{number:N}`
   - Prisma extension auto-formats numbers after creation
   - Frontend UI for configuring formats in Settings

2. **Compliance Module Framework (Partially Used)**
   - `NumberingService` with advanced features (atomic generation, series, hash chaining)
   - `NumberingSequence` model for tracking sequences per company/series
   - `NumberingConfig` interface for country-specific rules
   - Hash chain support for Spain (Veri*Factu) and Portugal (SAF-T)
   - NOT currently integrated into Invoice/Quote/Receipt services

3. **Multi-Tenant Infrastructure (Complete)**
   - Company model with user relationships
   - CompanyGuard for context isolation
   - Company-scoped data (all documents include companyId)

### Critical Gaps

1. **Country-specific numbering rules not configured** (only generic config exists)
2. **Compliance NumberingService not used** by document creation services
3. **No series management** (required for ES, PT)
4. **No hash storage** in document models (required for ES, PT)
5. **No country context** passed during document numbering
6. **No dynamic configuration** loading per company/country

## Target Architecture

### Core Principles

1. **Company Isolation**: Each company has independent numbering sequences
2. **Country Adaptation**: Numbering rules adapt to company's country
3. **Series Support**: Multiple document series per company (where required)
4. **Hash Chaining**: Cryptographic chaining for compliance (ES, PT)
5. **Extensibility**: Easy to add new countries/rules
6. **Zero Downtime**: Atomic number generation prevents collisions

### System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                         DATABASE                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐      ┌──────────────────┐                    │
│  │   Company    │      │ NumberingSequence │                    │
│  ├──────────────┤      ├──────────────────┤                    │
│  │ id           │──────│ companyId        │                    │
│  │ countryCode  │      │ series           │                    │
│  │ currency     │      │ documentType     │                    │
│  │ ...          │      │ lastSequence     │                    │
│  └──────────────┘      │ lastHash         │                    │
│                        │ year, month      │                    │
│                        └──────────────────┘                    │
│                              │                                  │
│                              ▼                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │              Invoice / Quote / Receipt                  │    │
│  ├────────────────────────────────────────────────────────┤    │
│  │ id, companyId, number, rawNumber                       │    │
│  │ series, hash, platformId  ← NEW FIELDS                 │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      BACKEND (NestJS)                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              NumberingOrchestratorService                │  │
│  │  (Main entry point - facade for all numbering ops)       │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │ generateNext(companyId, type, countryCode, series?)      │  │
│  │ previewNext(companyId, type, countryCode, series?)       │  │
│  │ validateFormat(format, countryCode)                      │  │
│  │ getSeriesList(companyId, type)                           │  │
│  │ checkGaps(companyId, type, series?)                      │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                  │
│          ┌───────────────────┼───────────────────┐              │
│          ▼                   ▼                   ▼              │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐       │
│  │ Numbering    │   │ Country      │   │ Series       │       │
│  │ Generator    │   │ Config       │   │ Manager      │       │
│  │ Service      │   │ Registry     │   │ Service      │       │
│  ├──────────────┤   ├──────────────┤   ├──────────────┤       │
│  │ Atomic tx    │   │ Load config  │   │ CRUD series  │       │
│  │ Format app   │   │ Per country  │   │ Validation   │       │
│  │ Reset logic  │   │ Validation   │   │ Registration │       │
│  └──────────────┘   └──────────────┘   └──────────────┘       │
│          │                   │                   │              │
│          └───────────────────┼───────────────────┘              │
│                              ▼                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              Compliance Integrations                     │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │ HashChainService (ES Veri*Factu, PT SAF-T)               │  │
│  │ Format Validation (per country regex)                    │  │
│  │ Gap Detection (ES, PT require continuous)                │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      FRONTEND (React)                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐        │
│  │ Numbering    │   │ Series       │   │ Document     │        │
│  │ Settings     │   │ Manager      │   │ Creation     │        │
│  │ Page         │   │ Modal        │   │ Form         │        │
│  ├──────────────┤   ├──────────────┤   ├──────────────┤        │
│  │ Format config│   │ Create/Edit  │   │ Series select│        │
│  │ Preview      │   │ List series  │   │ Number preview│       │
│  │ Country rules│   │ Register AT  │   │ Country warn │        │
│  └──────────────┘   └──────────────┘   └──────────────┘        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. Document Creation with Dynamic Numbering

```
User creates invoice
       │
       ▼
InvoicesService.create()
       │
       ├─► Get company country code
       │
       ├─► NumberingOrchestratorService.generateNext()
       │       │
       │       ├─► CountryConfigRegistry.get(countryCode)
       │       │       └─► Returns NumberingConfig for country
       │       │
       │       ├─► SeriesManager.validateSeries(series, country)
       │       │       └─► Check if series required/valid
       │       │
       │       ├─► NumberingGeneratorService.generate()
       │       │       │
       │       │       ├─► BEGIN TRANSACTION (atomic)
       │       │       ├─► Get last sequence from NumberingSequence
       │       │       ├─► Increment sequence
       │       │       ├─► Apply format (with year/month reset check)
       │       │       ├─► Generate hash if required (ES, PT)
       │       │       └─► COMMIT TRANSACTION
       │       │
       │       └─► Return: { number, rawNumber, series, hash }
       │
       ├─► Create invoice with number, series, hash
       │
       └─► Return invoice
```

### 2. Country Configuration Resolution

```
NumberingOrchestrator.generateNext(companyId, 'invoice', 'ES')
       │
       ├─► Load company config (format overrides)
       │
       ├─► Load country config ('ES')
       │       │
       │       ├─► Check configs/countries/es.config.ts
       │       └─► If not found, use generic.config.ts
       │
       ├─► Merge configs (company overrides country defaults)
       │
       └─► Apply numbering rules:
           - Spain: series required, hash chaining, no gaps
           - France: no series, no hash, gaps allowed
           - Generic: configurable per company
```

### 3. Format Application

```
Format: "INV-{year}-{series}-{number:4}"
Data:
  - year: 2025
  - series: A
  - number: 1
  - padding: 4

Result: "INV-2025-A-0001"

Special cases:
  - Spain (hash): "INV-2025-A-0001" + hash stored separately
  - Italy (SDI): Platform assigns number, stored in platformId
  - Portugal (AT): Series must be registered with tax authority
```

## Implementation Phases

### Phase 1: Database Schema Updates

**New Fields on Document Models:**
```prisma
model Invoice {
  // Existing fields...
  series        String?    // For ES, PT multi-series
  hash          String?    // For ES Veri*Factu, PT SAF-T
  platformId    String?    // For Italy SDI clearance
  platformStatus String?   // Transmission status from platform
}
```

**Enhanced NumberingSequence:**
```prisma
model NumberingSequence {
  // Existing fields...
  format        String?    // Override format per series
  resetPeriod   String     // 'never' | 'yearly' | 'monthly'
  lastResetAt   DateTime?  // When was sequence last reset
}
```

### Phase 2: Country Configuration Files

Create country configs with numbering rules:

**`configs/countries/es.config.ts`** (Spain - Veri*Factu):
```typescript
numbering: {
  seriesRequired: true,
  seriesFormat: '^[A-Z0-9]{1,20}$',
  hashChaining: true,
  hashAlgorithm: 'SHA-256',
  hashFields: ['supplierNIF', 'invoiceNumber', 'date', 'totalTTC', 'customerNIF', 'previousHash'],
  gapAllowed: false,
  resetPeriod: 'yearly',
}
```

**`configs/countries/pt.config.ts`** (Portugal - SAF-T):
```typescript
numbering: {
  seriesRequired: true,
  seriesRegistration: true,  // Must register with AT
  hashChaining: true,
  hashAlgorithm: 'RSA-SHA1',
  gapAllowed: false,
  resetPeriod: 'yearly',
}
```

**`configs/countries/fr.config.ts`** (France):
```typescript
numbering: {
  seriesRequired: false,
  hashChaining: false,
  gapAllowed: true,
  resetPeriod: 'never',  // Or configurable per company
}
```

### Phase 3: Core Services Implementation

**NumberingOrchestratorService** - Main facade:
- Coordinates all numbering operations
- Handles country config loading
- Manages transaction safety

**NumberingGeneratorService** - Atomic generation:
- Database transactions for number generation
- Format application with padding
- Reset logic (yearly/monthly)
- Collision prevention

**SeriesManagerService** - Series management:
- CRUD operations for series
- Validation against country rules
- Registration tracking (PT)

### Phase 4: Integration with Document Services

Refactor existing services to use new numbering:

```typescript
// InvoicesService.createInvoice()
async createInvoice(data: CreateInvoiceDto, user: User) {
  const company = await this.getUserCompany(user.id, data.companyId);
  
  // Generate number using new system
  const numbering = await this.numberingOrchestrator.generateNext({
    companyId: company.id,
    documentType: 'invoice',
    countryCode: company.countryCode,
    series: data.series,  // Optional, validated by country rules
  });
  
  // Create invoice with generated numbering
  const invoice = await this.prisma.invoice.create({
    data: {
      ...data,
      companyId: company.id,
      number: numbering.sequence,
      rawNumber: numbering.formatted,
      series: numbering.series,
      hash: numbering.hash,
    },
  });
  
  return invoice;
}
```

### Phase 5: Frontend Implementation

**Numbering Settings Page:**
- Format configuration with live preview
- Series management (if required by country)
- Country-specific rule display
- Reset period configuration

**Document Creation Forms:**
- Series selector (conditional on country)
- Next number preview
- Country compliance warnings

**API Endpoints:**
```
GET  /api/numbering/preview?type=invoice&series=A
POST /api/numbering/validate-format
GET  /api/numbering/series
POST /api/numbering/series
```

### Phase 6: Migration & Testing

**Migration Strategy:**
1. Add new fields to database (nullable)
2. Backfill existing documents with default values
3. Deploy new services alongside old
4. Switch document creation to new system
5. Remove old numbering logic

**Testing Requirements:**
- Unit tests for all services
- Integration tests for document creation
- E2E tests for numbering flows per country
- Load tests for atomic generation
- Gap detection tests

## Special Cases & Edge Handling

### 1. Italy (SDI) - Platform-Assigned Numbers

Italy's SDI system assigns invoice numbers. Architecture handles this:

```typescript
// Document created with temporary number
// After SDI transmission, update with platform-assigned number
await this.invoicesService.updatePlatformNumber({
  invoiceId: invoice.id,
  platformId: sdiResponse.invoiceNumber,
  platformStatus: sdiResponse.status,
});
```

### 2. Spain (Veri*Factu) - Hash Chaining

Every invoice must include hash of previous invoice:

```typescript
// Hash includes: NIF + invoiceNumber + date + total + customerNIF + previousHash
const hash = await this.hashChainService.generate({
  supplierNIF: company.identifiers.vatNumber,
  invoiceNumber: rawNumber,
  date: invoice.date,
  totalTTC: invoice.totalTTC,
  customerNIF: client.identifiers.vatNumber,
  previousHash: lastInvoice?.hash,
});
```

### 3. Portugal (SAF-T) - Series Registration

Series must be registered with Portuguese tax authority:

```typescript
// Before using a series, check registration
const canUseSeries = await this.seriesManager.isRegistered({
  companyId: company.id,
  series: 'A',
  countryCode: 'PT',
});

// If not registered, block creation or auto-register
```

### 4. Reset Periods

Handle yearly/monthly sequence resets:

```typescript
// Check if reset needed
if (numberingConfig.resetPeriod === 'yearly' && sequence.year !== currentYear) {
  // Reset sequence to 1 for new year
  await this.numberingGenerator.resetSequence({
    companyId,
    series,
    year: currentYear,
  });
}
```

## Compliance & Legal Requirements

| Country | Series | Hash | Gaps | Reset | Notes |
|---------|--------|------|------|-------|-------|
| France | No | No | Allowed | Configurable | Simple sequential |
| Spain | Yes | SHA-256 | No | Yearly | Veri*Factu mandatory B2B |
| Portugal | Yes | RSA-SHA1 | No | Yearly | SAF-T, series registration |
| Italy | Yes* | No | No | Yearly | *SDI assigns numbers |
| Germany | No | No | Allowed | Configurable | ZUGFeRD optional |
| Generic | Config | Config | Config | Config | Per-company settings |

## Success Metrics

1. **Zero numbering collisions** - Atomic transactions prevent duplicates
2. **Country compliance** - All documents meet local numbering laws
3. **Performance** - <100ms for number generation under load
4. **Extensibility** - New country config in <1 day
5. **User experience** - Clear preview and validation

## Files to Create/Modify

### New Files
- `backend/src/modules/numbering/numbering.module.ts`
- `backend/src/modules/numbering/numbering-orchestrator.service.ts`
- `backend/src/modules/numbering/numbering-generator.service.ts`
- `backend/src/modules/numbering/series-manager.service.ts`
- `backend/src/modules/compliance/configs/countries/es.config.ts`
- `backend/src/modules/compliance/configs/countries/pt.config.ts`
- `backend/src/modules/compliance/configs/countries/fr.config.ts`
- `frontend/src/pages/(app)/settings/numbering.tsx`
- `frontend/src/components/numbering/series-manager.tsx`
- `frontend/src/components/numbering/number-preview.tsx`

### Modified Files
- `backend/prisma/schema.prisma` - Add fields to Invoice, Quote, Receipt
- `backend/src/modules/invoices/invoices.service.ts` - Use new numbering
- `backend/src/modules/quotes/quotes.service.ts` - Use new numbering
- `backend/src/modules/receipts/receipts.service.ts` - Use new numbering
- `backend/src/modules/compliance/configs/index.ts` - Register country configs
- `frontend/src/pages/(app)/settings/_components/company.settings.tsx` - Enhanced numbering UI

## Conclusion

This architecture provides a robust, extensible foundation for multi-tenant, country-aware dynamic numbering. It leverages existing infrastructure while filling critical gaps, ensuring compliance with diverse international requirements.

Key benefits:
- **Compliance-ready** for ES, PT, IT, FR, and extensible to others
- **Multi-tenant safe** with atomic number generation
- **User-friendly** with previews and validation
- **Maintainable** with clear separation of concerns
