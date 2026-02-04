# Backend TODO - Multi-Tenant Dynamic Invoicing System

**Date**: February 4, 2026
**Purpose**: Rebuild plan for multi-tenant compliant invoicing system

---

## Summary

The Invoicerr backend already has a **well-structured multi-tenant foundation**. The main work needed is to integrate the compliance module architecture (documented in `/docs/compliance/ARCHITECTURE.md`) with the existing invoice/quote/receipt modules, and to complete the country-specific implementations.

---

## Part 1: What Exists and Works

### Core Infrastructure ✅
- **NestJS Framework**: Properly configured with TypeScript
- **Prisma ORM**: PostgreSQL with proper schema
- **Better Auth**: JWT + OIDC authentication with multi-tenant support
- **Multi-Tenant Architecture**: 
  - UserCompany model with roles (SYSTEM_ADMIN, OWNER, ADMIN, ACCOUNTANT)
  - companyId on all business entities
  - CompanyGuard for tenant isolation
  - @CompanyId and @CurrentCompany decorators

### Prisma Schema ✅
All required models exist with proper relationships:
- `Company` (tenant root) with PDFConfig and ComplianceSettings
- `User`, `Session`, `Account`, `Verification` (Better Auth)
- `UserCompany` (multi-tenant link with roles)
- `Client`, `Quote`, `Invoice`, `Receipt`, `RecurringInvoice`
- `InvoiceItem`, `QuoteItem`, `ReceiptItem`, `RecurringInvoiceItem`
- `PaymentMethod`, `Webhook`, `InvitationCode`, `MailTemplate`
- `NumberingSequence`, `Log`, `Plugin`

### Guards & Security ✅
- `AuthGuard`: Better Auth session validation
- `CompanyGuard`: Multi-tenant isolation (header/route/query extraction)
- `RoleGuard`: Role-based access control
- Proper soft delete (`isActive` flag)

### Compliance Module Structure ✅ (Skeleton)
The following structure exists but needs completion:
```
src/modules/compliance/
├── compliance.module.ts
├── compliance.service.ts
├── compliance.controller.ts
├── interfaces/ (all interfaces defined ✅)
├── services/
│   ├── context-builder.service.ts
│   ├── rule-resolver.service.ts
│   ├── vat-engine.service.ts
│   ├── numbering.service.ts
│   ├── hash-chain.service.ts
│   ├── qr-code.service.ts
│   ├── correction.service.ts
│   ├── compliance-settings.service.ts
│   ├── vies.service.ts
│   └── xades-signature.service.ts
├── documents/
│   ├── document.service.ts
│   ├── document.types.ts
│   ├── builders/
│   │   ├── base.builder.ts ✅
│   │   ├── generic.builder.ts ✅
│   │   └── index.ts
│   ├── templates/ (all templates exist ✅)
│   └── renderers/
│       ├── pdf.renderer.ts ✅
│       ├── hybrid.renderer.ts ✅
│       └── xml.renderer.ts ✅
├── formats/
│   ├── format.service.ts
│   └── generators/
│       ├── base.generator.ts
│       └── index.ts
└── transmission/
    ├── transmission.service.ts
    ├── resilient-transmission.service.ts
    ├── validation.ts
    └── strategies/
        └── email.strategy.ts ✅
```

### Country Compliance ✅ (Factory Pattern)
- `CountryComplianceFactory`: Creates country-specific instances
- `AbstractCountryCompliance`: Base class with common logic
- `GenericCountryCompliance`: Fallback for unsupported countries
- `FranceCompliance`: France-specific implementation
- `GermanyCompliance`: Germany-specific implementation

### Document Generation ✅ (Partially)
- PDFRenderer: Puppeteer-based PDF generation
- GenericDocumentBuilder: Simple HTML template builder
- Handlebars templates for invoice, quote, receipt, credit-note
- PDF configuration with custom colors, fonts, logo

### Business Modules ✅ (Partially Working)
- InvoicesModule: CRUD operations, PDF generation, webhooks
- QuotesModule: CRUD operations
- ReceiptsModule: CRUD operations  
- ClientsModule: CRUD operations
- CompanyModule: Company management, PDF config
- WebhooksModule: Event dispatching to Slack, Discord, Teams, etc.
- PaymentMethodsModule: Payment method management

---

## Part 2: Files to Keep

### Core Infrastructure (KEEP ALL)
```
src/
├── main.ts
├── app.module.ts
├── app.controller.ts
├── app.service.ts
├── guards/ (all)
├── decorators/ (all)
├── types/ (all)
├── prisma/ (all)
├── logger/
├── lib/auth.ts
└── mail/mail.service.ts
```

### Compliance Module (KEEP ALL - needs completion)
```
src/modules/compliance/
├── All interfaces/ (keep all)
├── All services/ (keep all)
├── documents/
│   ├── All files
│   └── Keep templates/
├── formats/ (all)
└── transmission/ (all)
```

### Business Modules (KEEP - need refactoring)
```
src/modules/
├── invoices/
│   ├── invoices.module.ts
│   ├── invoices.controller.ts
│   └── dto/invoices.dto.ts (modify for compliance integration)
├── quotes/
│   ├── quotes.module.ts
│   ├── quotes.controller.ts
│   └── dto/quotes.dto.ts (modify)
├── receipts/
│   ├── receipts.module.ts
│   ├── receipts.controller.ts
│   └── dto/receipts.dto.ts (modify)
├── clients/
│   ├── clients.module.ts
│   ├── clients.controller.ts
│   ├── clients.service.ts
│   └── dto/clients.dto.ts
├── company/
│   ├── company.module.ts
│   ├── company.controller.ts
│   ├── company.service.ts
│   └── dto/company.dto.ts
├── payment-methods/ (all)
├── webhooks/ (all)
├── signatures/ (all)
├── invitations/ (all)
├── auth-extended/ (all)
├── admin/ (all)
├── dashboard/ (all)
├── directory/ (all)
├── stats/ (all)
├── plugins/ (all)
├── danger/ (all)
└── cron/ (all)
```

### Database Schema (KEEP - needs additions)
```
prisma/schema.prisma (keep - add country configs later)
```

---

## Part 3: Files to Delete

### Old PDF Generation Code (DELETE)
These are superseded by the compliance document service:
```
src/utils/pdf.ts (DELETE)
src/utils/quote-pdf.ts (DELETE)
src/utils/generate-quote-pdf.ts (DELETE)
src/utils/adress.ts (DELETE - typo in filename, and unused)
```

### Old Template Directories (DELETE)
These are superseded by compliance module templates:
```
src/modules/invoices/templates/ (DELETE - moved to compliance)
src/modules/quotes/templates/base.template.ts (DELETE - moved to compliance)
src/modules/receipts/templates/ (DELETE - moved to compliance)
```

### Unused Utility Files (DELETE)
```
src/utils/plugins.ts (DELETE)
src/utils/plugins/signing.ts (DELETE)
src/utils/storage-upload.ts (DELETE - moved to plugins/)
src/utils/webhook-security.ts (DELETE - moved to webhooks/)
```

### Stub/Incomplete Services (DELETE)
These are throwing errors and not implemented:
```
src/modules/invoices/invoices.service.ts - Keep but remove stub PDF methods
src/modules/quotes/quotes.service.ts - Keep but remove stub PDF methods
src/modules/receipts/receipts.service.ts - Keep but remove stub PDF methods
```

---

## Part 4: What Needs to Be Built

### Priority 1: Country Configuration System

#### Create `compliance/configs/` directory
```
src/modules/compliance/configs/
├── index.ts (registry and access functions)
├── generic.config.ts (fallback config)
└── countries/
    ├── fr.config.ts
    ├── de.config.ts
    ├── be.config.ts
    ├── it.config.ts
    ├── es.config.ts
    ├── pt.config.ts
    ├── nl.config.ts
    ├── at.config.ts
    └── (more as needed)
```

Each country config needs:
```typescript
export const frConfig: CountryConfig = {
  code: 'FR',
  name: 'country.france',
  currency: 'EUR',
  locale: 'fr-FR',
  timezone: 'Europe/Paris',
  isEU: true,
  
  vat: { rates, exemptions, defaultRate, roundingMode },
  identifiers: { types, formats },
  transmission: { b2b, b2g, b2c },
  numbering: { prefix, format, resetPeriod, seriesRequired },
  format: { syntax, version, profile },
  signature: { type, algorithm, required },
  qrCode: { content, format, position, required },
  correction: { method, codes, mandatory },
  archiving: { periodYears, format },
  clearance: { endpoint, auth, idReturned },
  peppol: { enabled, schemeId, participantIdFormat },
  
  documents: EU_DOCUMENT_CONFIG,
  
  requiredFields: { invoice, client },
  legalMentions: { mandatory, conditional },
  customFields: [],
};
```

### Priority 2: EU Document Builder

#### Create `documents/builders/eu.builder.ts`
```typescript
export class EUDocumentBuilder extends BaseDocumentBuilder {
  readonly type: BuilderType = 'eu';
  readonly supportedFormats: OutputFormat[] = [
    'pdf', 'facturx', 'zugferd', 'xrechnung', 'ubl', 'cii'
  ];
  
  async build(request: GenerateDocumentRequest): Promise<BuildResult> {
    // 1. Generate HTML from template
    const template = this.getTemplate(request.type);
    const html = this.compileTemplate(template)(this.buildContext(request));
    
    // 2. Generate XML if needed
    let xml: string | undefined;
    if (['facturx', 'zugferd', 'xrechnung', 'ubl', 'cii'].includes(request.format)) {
      xml = await this.generateXML(request.data, request.format);
    }
    
    // 3. Generate QR code if required
    const qrCode = this.generateQRCode(request);
    
    return { html, xml, metadata: { requiresXmlEmbed: !!xml } };
  }
}
```

### Priority 3: XML Format Generators

#### Complete `formats/generators/`
```
├── base.generator.ts (exists)
├── facturx.generator.ts (CREATE - CII syntax)
├── ubl.generator.ts (CREATE - UBL 2.1)
└── fatturapa.generator.ts (CREATE - Italy specific)
```

### Priority 4: Transmission Strategies

#### Create transmission strategies for:
```
├── email.strategy.ts (exists ✅)
├── chorus.strategy.ts (CREATE - France B2G)
├── superpdp.strategy.ts (CREATE - France B2B)
├── peppol.strategy.ts (CREATE - Peppol network)
├── sdi.strategy.ts (CREATE - Italy SDI)
├── verifactu.strategy.ts (CREATE - Spain)
└── saft.strategy.ts (CREATE - Portugal)
```

### Priority 5: Refactor Invoice/Quote/Receipt Services

#### Remove old PDF generation methods from:
- `InvoicesService.getInvoicePdf()` - Replace with compliance DocumentService
- `InvoicesService.getInvoiceXML()` - Use compliance FormatService
- `QuotesService.getQuotePdf()` - Replace with compliance DocumentService
- `ReceiptsService.getReceiptPdf()` - Replace with compliance DocumentService

#### Update to use compliance services:
```typescript
// OLD
async getInvoicePdf(companyId, id, format) {
  // Direct PDF generation
}

// NEW
async getInvoicePdf(companyId, id, format) {
  const invoice = await this.getInvoice(companyId, id);
  const company = invoice.company;
  const data = this.transformToDocumentData(invoice);
  
  return this.documentService.generateDocument(
    'invoice',
    data,
    company.country,
    format,
    company.pdfConfig
  );
}
```

### Priority 6: Update DTOs for Compliance

#### Add compliance-related fields to DTOs:
```typescript
export class CreateInvoiceDto {
  clientId: string;
  quoteId?: string;
  dueDate?: Date;
  currency?: Currency;
  notes?: string;
  paymentMethod?: string;
  paymentDetails?: string;
  paymentMethodId?: string;
  
  // Compliance fields
  nature?: 'goods' | 'services' | 'mixed';
  supplierCountry?: string;  // Override company default
  customerCountry?: string;  // Override client default
  
  items: InvoiceItemDto[];
}
```

### Priority 7: Numbering Service Integration

#### Update `NumberingService` to use `NumberingSequence` table:
```typescript
async generateNextNumber(
  companyId: string,
  documentType: 'invoice' | 'quote' | 'receipt',
  series?: string
): Promise<{ number: number; rawNumber: string }> {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  
  // Get or create sequence
  const sequence = await this.prisma.numberingSequence.upsert({
    where: {
      companyId_series_documentType: { companyId, series, documentType }
    },
    create: { companyId, series, documentType, year, month },
    update: {}
  });
  
  // Check if reset is needed (annual)
  if (sequence.year !== year) {
    await this.prisma.numberingSequence.update({
      where: { id: sequence.id },
      data: { lastSequence: 0, year, month }
    });
  }
  
  // Generate next number
  const nextNumber = sequence.lastSequence + 1;
  const countryCompliance = this.complianceFactory.create(companyCountryCode);
  const rawNumber = await countryCompliance.generateNextInvoiceNumber({
    year,
    lastNumber: sequence.lastSequence,
    series
  });
  
  // Update sequence
  await this.prisma.numberingSequence.update({
    where: { id: sequence.id },
    data: { lastSequence: nextNumber }
  });
  
  return { number: nextNumber, rawNumber };
}
```

### Priority 8: Transmission Integration

#### Add invoice sending methods:
```typescript
// In InvoicesController
@Post(':id/send')
async sendInvoice(
  @CompanyId() companyId: string,
  @Param('id') id: string,
  @Body() body: { platform: string }
) {
  return this.invoicesService.sendInvoice(companyId, id, body.platform);
}

// In InvoicesService
async sendInvoice(companyId: string, invoiceId: string, platform?: string) {
  const invoice = await this.getInvoice(companyId, invoiceId);
  const company = invoice.company;
  const country = company.country;
  
  // Resolve transmission platform
  const rules = await this.complianceService.resolveRules({
    // context
  });
  const actualPlatform = platform || rules.transmission.platform;
  
  // Generate PDF + XML if needed
  const pdfBuffer = await this.documentService.generateDocument(
    'invoice',
    this.transformToDocumentData(invoice),
    country,
    'facturx'  // or appropriate format
  );
  
  const xmlContent = await this.complianceService.generateEInvoiceXML(
    invoiceData,
    'facturx'
  );
  
  // Send via transmission service
  const result = await this.complianceService.sendInvoice(actualPlatform, {
    companyId,
    invoiceId,
    invoiceNumber: invoice.rawNumber || String(invoice.number),
    pdfBuffer,
    xmlContent,
    recipient: {
      email: invoice.client.contactEmail,
      name: invoice.client.name,
      siret: invoice.client.identifiers?.siret,
      vatNumber: extractVAT(invoice.client.identifiers)
    },
    sender: {
      email: company.email,
      name: company.name,
      siret: company.identifiers?.siret,
      vatNumber: extractVAT(company.identifiers)
    },
    metadata: {
      totalHT: invoice.totalHT,
      totalVAT: invoice.totalVAT,
      totalTTC: invoice.totalTTC,
      currency: invoice.currency
    }
  });
  
  // Update invoice with transmission details
  await this.prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: 'SENT',
      // Add transmission fields if needed
    }
  });
  
  return result;
}
```

### Priority 9: Frontend API Endpoints

#### Add compliance config endpoints:
```typescript
// In ComplianceController
@Get('config/frontend')
getComplianceConfig(
  @Query('supplierCountry') supplierCountry: string,
  @Query('customerCountry') customerCountry: string,
  @Query('transactionType') transactionType: 'B2B' | 'B2G' | 'B2C',
  @Query('nature') nature: 'goods' | 'services' | 'mixed'
) {
  return this.complianceService.getConfigForFrontend(
    supplierCountry,
    customerCountry,
    transactionType,
    nature
  );
}

@Get('countries')
getSupportedCountries() {
  return this.complianceService.getAvailableCountries();
}

@Get('vat-rates/:countryCode')
getVATRates(@Param('countryCode') countryCode: string) {
  return this.complianceService.getVatRates(countryCode);
}
```

### Priority 10: Credit Notes & Corrections

#### Implement correction workflow:
```typescript
// In InvoicesService
async createCreditNote(
  companyId: string,
  invoiceId: string,
  body: { correctionCode: string; reason?: string; items: CreditNoteItem[] }
) {
  const invoice = await this.getInvoice(companyId, invoiceId);
  const company = invoice.company;
  const country = company.country;
  
  // Check if credit note is required
  if (!this.complianceService.requiresCreditNote(country)) {
    // Allow modification instead
    return this.editInvoice(companyId, { ...body });
  }
  
  // Generate credit note number
  const numberResult = await this.numberingService.generateNextNumber(
    companyId,
    'credit-note'
  );
  
  // Create credit note invoice
  const creditNote = await this.prisma.invoice.create({
    data: {
      number: numberResult.number,
      rawNumber: numberResult.rawNumber,
      companyId,
      clientId: invoice.clientId,
      currency: invoice.currency,
      totalHT: -body.items.reduce(...),  // Negative amounts
      totalVAT: -body.items.reduce(...),
      totalTTC: -body.items.reduce(...),
      status: 'SENT',
      // ... other fields
    }
  });
  
  // Generate PDF
  const pdf = await this.documentService.generateDocument(
    'credit-note',
    this.transformToCreditNoteData(invoice, creditNote, body),
    country,
    'pdf'
  );
  
  return creditNote;
}
```

---

## Part 5: Multi-Tenant Implementation Assessment

### Current Multi-Tenant Status ✅ EXCELLENT

The backend already has a **production-ready multi-tenant architecture**:

| Component | Status | Notes |
|-----------|--------|-------|
| Schema with companyId | ✅ Complete | All business entities have companyId |
| CompanyGuard | ✅ Complete | Global guard with fallback to default company |
| User-Company roles | ✅ Complete | SYSTEM_ADMIN, OWNER, ADMIN, ACCOUNTANT |
| Tenant isolation | ✅ Complete | All queries filter by companyId |
| Soft delete | ✅ Complete | isActive flag on entities |
| Cascade delete | ✅ Complete | Proper onDelete: Cascade |
| Indexing | ✅ Complete | @@index([companyId]) on all entities |

### Compliance Multi-Tenant Status ⚠️ PARTIAL

The compliance module is designed to be stateless or tenant-aware:

| Service | Multi-Tenant Support | Notes |
|---------|---------------------|-------|
| ComplianceService | ✅ Stateless | Gets country config, doesn't need companyId |
| DocumentService | ✅ Stateless | Uses data passed in parameters |
| FormatService | ✅ Stateless | Uses data passed in parameters |
| TransmissionService | ✅ Tenant-aware | companyId in TransmissionPayload |
| NumberingService | ⚠️ Partial | Needs to use NumberingSequence table |
| ComplianceSettingsService | ✅ Tenant-aware | Uses companyId parameter |

### What Needs Multi-Tenant Work

1. **NumberingService**: Use `NumberingSequence` table with companyId
2. **HashChainService**: Store hashes per company in `NumberingSequence`
3. **TransmissionService**: Already tenant-aware (good)
4. **WebhookDispatcher**: Already filters by companyId (good)

---

## Part 6: Implementation Order

### Phase 1: Foundation (1-2 days)
1. Delete outdated files (utils/pdf.ts, old templates)
2. Create `compliance/configs/` directory structure
3. Implement `generic.config.ts`
4. Create `configs/index.ts` registry

### Phase 2: Country Configs (2-3 days)
1. Implement `fr.config.ts` (France)
2. Implement `de.config.ts` (Germany)
3. Implement `it.config.ts` (Italy)
4. Implement `es.config.ts` (Spain)
5. Implement `pt.config.ts` (Portugal)

### Phase 3: Document Builders (2-3 days)
1. Create `eu.builder.ts` for European countries
2. Add QR code generation support
3. Test PDF generation with Factur-X embedding

### Phase 4: XML Generators (3-4 days)
1. Implement `facturx.generator.ts` (CII)
2. Implement `ubl.generator.ts` (UBL 2.1)
3. Implement `fatturapa.generator.ts` (Italy)
4. Add XML validation schemas

### Phase 5: Transmission Strategies (4-5 days)
1. Create `peppol.strategy.ts` (highest priority)
2. Create `chorus.strategy.ts` (France B2G)
3. Create `superpdp.strategy.ts` (France B2B)
4. Create `sdi.strategy.ts` (Italy)

### Phase 6: Service Integration (3-4 days)
1. Refactor `InvoicesService` to use DocumentService
2. Refactor `QuotesService` to use DocumentService
3. Refactor `ReceiptsService` to use DocumentService
4. Update DTOs for compliance fields

### Phase 7: Numbering & Corrections (2-3 days)
1. Update `NumberingService` to use NumberingSequence
2. Implement hash chain support for ES/PT
3. Implement credit note workflow
4. Add modification options endpoint

### Phase 8: Frontend API (1-2 days)
1. Add compliance config endpoints
2. Add country listing endpoint
3. Add VAT rates endpoint
4. Document API with Swagger

### Phase 9: Testing (3-4 days)
1. Unit tests for compliance services
2. Integration tests for document generation
3. E2E tests for invoice creation flow
4. Multi-tenant isolation tests

**Total Estimated Time**: 21-30 days

---

## Part 7: Dependencies & Risks

### External Dependencies
- `@fin.cx/einvoice` - Already installed for XML generation
- `puppeteer` - For PDF rendering (already installed)
- `pdf-lib` - For PDF/A-3 with embedded XML (need to install)
- `handlebars` - For templates (already installed)
- `qrcode` - For QR code generation (already installed)

### Key Libraries to Install
```bash
npm install pdf-lib xadesjs  # For hybrid PDF/XMl and signatures
```

### Risks
1. **PDF/A-3 Compliance**: Need to ensure Factur-X embedding is correct
2. **Peppol Integration**: Requires certification and access to Peppol network
3. **Chorus Pro**: Requires French public sector credentials
4. **VIES Rate Limiting**: EU VAT validation API has rate limits
5. **Hash Chain Integrity**: ES/PT hash chains must be sequential and immutable

---

## Conclusion

The Invoicerr backend has an **excellent foundation** for multi-tenant compliant invoicing. The main work is:

1. **Complete the compliance module** with country configs and XML generators
2. **Integrate compliance services** into existing business modules
3. **Implement transmission strategies** for various countries/platforms
4. **Refactor numbering** to use the NumberingSequence table

The multi-tenant architecture is already solid and requires minimal changes. Focus should be on completing the compliance features as documented in `/docs/compliance/ARCHITECTURE.md`.

---

**Last Updated**: February 4, 2026
**Status**: Ready for implementation
