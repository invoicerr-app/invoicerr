# Compliance Module Architecture

> **Version**: 2.0
> **Last updated**: January 2026

Complete architecture of the compliance module for multi-country electronic invoicing.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Directory Structure](#2-directory-structure)
3. [Configs - Country Configuration](#3-configs---country-configuration)
4. [Interfaces - Types and Contracts](#4-interfaces---types-and-contracts)
5. [Services - Business Logic](#5-services---business-logic)
6. [Documents - PDF/XML Generation](#6-documents---pdfxml-generation)
7. [Formats - XML Generators](#7-formats---xml-generators)
8. [Transmission - Invoice Sending](#8-transmission---invoice-sending)
9. [Data Flow](#9-data-flow)
10. [System Extension](#10-system-extension)

---

## 1. Overview

The `compliance` module centralizes all tax compliance and document generation logic. It is designed to support different electronic invoicing models:

| Model | Countries | Principle |
|-------|-----------|-----------|
| **Clearance** | IT, PL, IN, MY | Prior validation by tax authority |
| **PDP/Y-model** | FR | Certified private platforms |
| **Real-time reporting** | HU, GR | Real-time reporting without clearance |
| **Hash chaining** | ES, PT | Cryptographic chain signature |
| **Peppol** | DE, BE, NL, NO, SE, AT, AU, NZ, JP, SG | European/international network |
| **Email** | All | Universal fallback |

### Design Principles

1. **One config per country**: All country-specific rules in a single file
2. **Strategy pattern**: Transmission, formats, and builders are interchangeable
3. **Fail-safe**: Generic config for unsupported countries, email as fallback
4. **i18n ready**: All texts use translation keys

---

## 2. Directory Structure

```
backend/src/modules/compliance/
├── compliance.module.ts           # Main NestJS module
├── compliance.controller.ts       # REST endpoints /compliance/*
├── compliance.service.ts          # Main facade (entry point)
├── index.ts                       # Public exports
│
├── configs/                       # 🌍 Country configuration
│   ├── index.ts                   # Registry and access functions
│   ├── generic.config.ts          # Fallback config
│   └── countries/
│       ├── fr.config.ts           # France
│       ├── de.config.ts           # Germany
│       ├── be.config.ts           # Belgium
│       ├── it.config.ts           # Italy
│       ├── es.config.ts           # Spain
│       └── pt.config.ts           # Portugal
│
├── interfaces/                    # 📐 TypeScript types
│   ├── index.ts                   # Re-exports
│   ├── country-config.interface.ts    # Complete CountryConfig
│   ├── document-config.interface.ts   # DocumentConfig (PDF/formats)
│   ├── vat.interface.ts               # VAT rates, exemptions
│   ├── identifier.interface.ts        # SIRET, NIF, Partita IVA...
│   ├── transmission.interface.ts      # Transmission models
│   ├── numbering.interface.ts         # Numbering, series
│   ├── format.interface.ts            # XML formats (UBL, CII...)
│   ├── signature.interface.ts         # Signatures and QR codes
│   ├── correction.interface.ts        # Credit notes, corrections
│   ├── archiving.interface.ts         # Legal retention
│   ├── clearance.interface.ts         # Clearance model
│   ├── peppol.interface.ts            # Peppol config
│   ├── transaction-context.interface.ts
│   └── applicable-rules.interface.ts
│
├── services/                      # ⚙️ Business services
│   ├── index.ts
│   ├── context-builder.service.ts     # Builds TransactionContext
│   ├── rule-resolver.service.ts       # Resolves applicable rules
│   ├── vat-engine.service.ts          # VAT calculation (line/total rounding)
│   ├── numbering.service.ts           # Invoice number generation
│   ├── hash-chain.service.ts          # Hash ES/PT
│   ├── qr-code.service.ts             # QR codes (PT, ES, CH)
│   ├── correction.service.ts          # Credit note management
│   ├── vies.service.ts                # EU VAT number validation
│   ├── xades-signature.service.ts     # XAdES signature (IT, ES)
│   └── compliance-settings.service.ts # User settings
│
├── documents/                     # 📄 Document generation
│   ├── index.ts
│   ├── document.service.ts            # Main orchestrator
│   ├── document.types.ts              # Types (DocumentType, OutputFormat...)
│   │
│   ├── builders/                      # Builders by region
│   │   ├── index.ts                   # Builder registry
│   │   ├── base.builder.ts            # Abstract class
│   │   ├── generic.builder.ts         # Simple PDF
│   │   └── eu.builder.ts              # PDF + XML (Factur-X, UBL, CII)
│   │
│   ├── templates/                     # Handlebars templates
│   │   ├── index.ts
│   │   ├── base.template.ts           # Common CSS/HTML
│   │   ├── invoice.template.ts        # Invoice
│   │   ├── quote.template.ts          # Quote
│   │   ├── receipt.template.ts        # Receipt
│   │   └── credit-note.template.ts    # Credit note
│   │
│   └── renderers/                     # Rendering engines
│       ├── index.ts                   # Renderer registry
│       ├── pdf.renderer.ts            # HTML → PDF (Puppeteer)
│       ├── hybrid.renderer.ts         # PDF/A-3 + XML (pdf-lib)
│       └── xml.renderer.ts            # XML only
│
├── formats/                       # 📑 XML e-invoice generators
│   ├── index.ts
│   ├── format.interface.ts            # FormatGenerator interface
│   ├── format.service.ts              # Format orchestrator
│   └── generators/
│       ├── index.ts
│       ├── base.generator.ts          # Abstract class
│       ├── facturx.generator.ts       # Factur-X / ZUGFeRD (CII)
│       ├── ubl.generator.ts           # UBL 2.1 / XRechnung
│       └── fatturapa.generator.ts     # FatturaPA (IT)
│
├── transmission/                  # 📤 Invoice sending
│   ├── index.ts
│   ├── transmission.interface.ts      # TransmissionStrategy interface
│   ├── transmission.service.ts        # Orchestrator
│   ├── resilience.ts                  # Retry, circuit breaker
│   ├── resilient-transmission.service.ts
│   ├── validation.ts                  # Payload validation
│   └── strategies/
│       ├── index.ts
│       ├── email.strategy.ts          # Universal fallback
│       ├── chorus.strategy.ts         # FR B2G
│       ├── superpdp.strategy.ts       # FR B2B (PDP)
│       ├── peppol.strategy.ts         # Peppol network
│       ├── sdi.strategy.ts            # IT - Sistema di Interscambio
│       ├── verifactu.strategy.ts      # ES - Veri*Factu
│       └── saft.strategy.ts           # PT - SAF-T
│
└── dto/                           # 📋 DTOs
    ├── compliance-config.dto.ts       # Frontend config
    └── compliance-settings.dto.ts     # User settings
```

---

## 3. Configs - Country Configuration

### File: `configs/index.ts`

Central access point for country configurations.

```typescript
// Available functions
getCountryConfig(code: string): CountryConfig     // Country config (fallback: generic)
getAllCountryConfigs(): CountryConfig[]           // All configs
isCountrySupported(code: string): boolean         // Country supported?
getSupportedCountryCodes(): string[]              // List of country codes

// Injectable service
@Injectable()
class ConfigRegistry {
  get(code: string): CountryConfig
  getAll(): CountryConfig[]
  has(code: string): boolean
  getCodes(): string[]
  getEUCountries(): CountryConfig[]
}
```

### File: `configs/countries/fr.config.ts`

Example country configuration (France).

```typescript
export const frConfig: CountryConfig = {
  code: 'FR',
  name: 'country.france',
  currency: 'EUR',
  locale: 'fr-FR',
  timezone: 'Europe/Paris',
  isEU: true,
  euSince: '1958-01-01',

  vat: { ... },           // VAT rates, exemptions
  identifiers: { ... },   // SIRET, SIREN, VAT
  transmission: { ... },  // B2B (PDP), B2G (Chorus), B2C
  numbering: { ... },     // Series, annual reset
  format: { ... },        // Factur-X preferred
  signature: { ... },     // Not required
  qrCode: { ... },        // Not required
  correction: { ... },    // Credit notes mandatory
  archiving: { ... },     // 10 years
  peppol: { ... },        // Enabled, schemeId 0009
  documents: EU_DOCUMENT_CONFIG,  // Builder 'eu'
  requiredFields: { ... },
  legalMentions: { ... },
  customFields: [],
};
```

### File: `configs/generic.config.ts`

Default configuration for unsupported countries.

```typescript
export const genericConfig: Partial<CountryConfig> = {
  code: 'GENERIC',
  vat: {
    rates: [
      { code: 'S', rate: 20, labelKey: 'vat.standard', category: 'S' },
      { code: 'Z', rate: 0, labelKey: 'vat.zero', category: 'Z' },
    ],
    defaultRate: 20,
    roundingMode: 'total',
  },
  transmission: {
    b2b: { model: 'email', mandatory: false },
    b2g: { model: 'email', mandatory: false },
    b2c: { model: 'email', mandatory: false },
  },
  documents: DEFAULT_DOCUMENT_CONFIG,  // Builder 'generic'
  // ...
};
```

---

## 4. Interfaces - Types and Contracts

### `interfaces/country-config.interface.ts`

Main interface grouping all country configuration.

```typescript
interface CountryConfig {
  code: string;                    // 'FR', 'DE', 'IT'...
  name?: string;                   // i18n key
  currency: string;                // 'EUR', 'GBP'...
  locale?: string;                 // 'fr-FR'
  timezone?: string;               // 'Europe/Paris'
  isEU: boolean;
  euSince?: string;                // '1958-01-01'

  vat: VATConfig;
  identifiers: IdentifierConfig;
  transmission: {
    b2b: TransmissionConfig;
    b2g: TransmissionConfig;
    b2c?: TransmissionConfig;
  };
  numbering: NumberingConfig;
  format: FormatConfig;
  signature?: SignatureConfig;
  qrCode?: QRCodeConfig;
  correction?: CorrectionConfig;
  archiving?: ArchivingConfig;
  clearance?: ClearanceConfig;
  peppol?: PeppolConfig;

  documents: DocumentConfig;       // ⬅️ PDF generation config

  requiredFields: { invoice: string[]; client: string[]; };
  legalMentions: { mandatory: string[]; conditional: ConditionalMention[]; };
  customFields?: CustomFieldDefinition[];
  paymentReference?: PaymentReferenceConfig;
}
```

### `interfaces/document-config.interface.ts`

Document generation configuration.

```typescript
type BuilderType = 'generic' | 'eu' | 'it' | 'es' | 'pt';

type OutputFormat =
  | 'pdf'        // Simple PDF
  | 'facturx'    // PDF/A-3 + CII XML
  | 'zugferd'    // German alias for Factur-X
  | 'xrechnung'  // XRechnung (DE B2G)
  | 'ubl'        // UBL 2.1 XML
  | 'cii'        // UN/CEFACT CII XML
  | 'fatturapa'; // FatturaPA XML (IT)

interface DocumentConfig {
  builder: BuilderType;            // Which builder to use

  outputFormats: {
    invoice: OutputFormat[];       // Available formats for invoices
    quote: OutputFormat[];
    receipt: OutputFormat[];
    'credit-note': OutputFormat[];
  };

  defaultFormat: OutputFormat;     // Default format

  modification: {
    invoiceEditable: boolean;      // Can invoices be modified?
    quoteEditable: boolean;
    requiresCreditNote: boolean;   // Credit note mandatory?
  };

  requiredElements: {
    invoice: RequiredElement[];    // QR code, signature, hash...
    quote: RequiredElement[];
  };
}

// Predefined configs
const DEFAULT_DOCUMENT_CONFIG: DocumentConfig;  // builder: 'generic', pdf only
const EU_DOCUMENT_CONFIG: DocumentConfig;       // builder: 'eu', facturx/ubl/cii
```

### Other Key Interfaces

| Interface | Description |
|-----------|-------------|
| `VATConfig` | Rates, exemptions, VAT number format, rounding |
| `IdentifierConfig` | SIRET, NIF, Partita IVA definitions... |
| `TransmissionConfig` | Model (email, peppol, clearance...), platform |
| `NumberingConfig` | Series, hash chain, reset period |
| `FormatConfig` | Syntax (UBL, CII, FatturaPA), version, profile |
| `SignatureConfig` | Type (xades, pades, hash_chain), algorithm |
| `QRCodeConfig` | Content, position, format |
| `CorrectionConfig` | Method (credit note, corrective), codes |
| `ClearanceConfig` | Endpoint, auth, returned ID |
| `PeppolConfig` | schemeId, participantIdFormat, documentTypeId |

---

## 5. Services - Business Logic

### `compliance.service.ts` - Main Facade

Single entry point for all compliance logic.

```typescript
@Injectable()
class ComplianceService {
  // Configuration
  getConfig(countryCode: string): CountryConfig
  isCountrySupported(code: string): boolean
  getAvailableCountries(): CountrySummaryDto[]

  // Context and rules
  buildContext(input: ContextBuildInput): Promise<TransactionContext>
  resolveRules(context: TransactionContext): ApplicableRules

  // VAT
  calculateVAT(items: VATCalculationInput[], rules: VATEngineRules): VATCalculationResult

  // Numbering
  generateInvoiceNumber(context, countryCode): Promise<{ number, rawNumber }>
  checkNumberingGaps(companyId, series, existingNumbers): Promise<Gap[]>

  // Hash chain (ES, PT)
  generateInvoiceHash(input, countryCode): string | null
  getInitialHash(): string

  // QR Code (PT, ES, CH)
  generateQRCode(input, countryCode): string | null

  // Corrections
  canModifyInvoice(invoice, countryCode): boolean
  createCreditNote(invoice, request, countryCode): CreditNoteResult
  getCorrectionCodes(countryCode): CorrectionCode[]

  // XML formats
  generateInvoiceXML(invoice, countryCode): Promise<FormatResult>

  // Transmission
  sendInvoice(platform, payload): Promise<TransmissionResult>
  checkTransmissionStatus(platform, externalId): Promise<TransmissionStatus>

  // Frontend API
  getConfigForFrontend(supplierCountry, customerCountry, transactionType, nature): FrontendComplianceConfigDto
}
```

### `services/vat-engine.service.ts`

VAT calculation with line or total rounding depending on the country.

```typescript
@Injectable()
class VATEngineService {
  calculate(items: VATCalculationInput[], rules: VATEngineRules): VATCalculationResult
  // Returns: { totalHT, totalVAT, totalTTC, breakdown[] }

  calculateVAT(amount: number, rate: number): number
  calculateHT(amountTTC: number, rate: number): number
  calculateTTC(amountHT: number, rate: number): number
  validateBreakdown(breakdown, expectedHT, expectedVAT): { valid, htDiff, vatDiff }
}
```

### `services/context-builder.service.ts`

Builds transaction context from raw data.

```typescript
@Injectable()
class ContextBuilderService {
  build(input: ContextBuildInput): Promise<TransactionContext>
  // Determines: isDomestic, isIntraEU, isExport, transactionType, place of taxation
}
```

### `services/rule-resolver.service.ts`

Resolves applicable rules based on context.

```typescript
@Injectable()
class RuleResolverService {
  resolve(context: TransactionContext): ApplicableRules
  // Determines: VAT rates, reverse charge, format, transmission method, legal mentions...
}
```

### Other Services

| Service | Role |
|---------|------|
| `NumberingService` | Number generation, series, gap checking |
| `HashChainService` | SHA-256/SHA-1 hash for ES/PT |
| `QRCodeService` | QR content generation (PT/ES/CH) |
| `CorrectionService` | Credit note and corrective invoice logic |
| `VIESService` | EU VAT number validation via VIES API |
| `XadesSignatureService` | XAdES-BES signature for IT/ES |

---

## 6. Documents - PDF/XML Generation

### `documents/document.service.ts` - Orchestrator

Entry point for generating any type of document.

```typescript
@Injectable()
class DocumentService {
  // Complete generation
  async generate(request: GenerateDocumentRequest): Promise<GenerateDocumentResponse>
  // request = { type, data, format, supplierCountry, locale?, pdfConfig? }
  // response = { buffer, format, mimeType, filename, metadata }

  // Simplified interface
  async generateDocument(
    type: DocumentType,
    data: DocumentData,
    supplierCountry: string,
    format?: OutputFormat,
    pdfConfig?: PDFStyleConfig
  ): Promise<Buffer>

  // Information
  getSupportedFormats(type: DocumentType, country: string): OutputFormat[]
  getDefaultFormat(country: string): OutputFormat
  canModifyInvoice(country: string): boolean
  requiresCreditNote(country: string): boolean
}
```

### `documents/document.types.ts` - Types

```typescript
// Document types
type DocumentType =
  | 'invoice'
  | 'quote'
  | 'receipt'
  | 'credit-note'
  | 'proforma'
  | 'corrective-invoice'
  | 'deposit-invoice';

// Output formats
type OutputFormat = 'pdf' | 'facturx' | 'zugferd' | 'xrechnung' | 'ubl' | 'cii' | 'fatturapa';

// Builder types
type BuilderType = 'generic' | 'eu' | 'it' | 'es' | 'pt';

// Document data (union type)
type DocumentData =
  | InvoiceDocumentData
  | QuoteDocumentData
  | ReceiptDocumentData
  | CreditNoteDocumentData
  | ProformaDocumentData;

// Data interfaces
interface BaseDocumentData {
  id: string;
  number: string;
  createdAt: Date;
  currency: string;
  supplier: DocumentParty;
  customer: DocumentParty;
  items: DocumentItem[];
  totals: DocumentTotals;
  notes?: string;
  paymentMethod?: { type: string; details?: string; };
  legalMentions?: string[];
}

interface InvoiceDocumentData extends BaseDocumentData {
  type: 'invoice';
  dueDate: Date;
  paymentTerms?: string;
}

// etc. for Quote, Receipt, CreditNote, Proforma
```

### `documents/builders/` - Builders

Each builder generates HTML + XML according to its strategy.

```typescript
// Interface
interface IDocumentBuilder {
  readonly type: BuilderType;
  readonly supportedFormats: OutputFormat[];
  readonly supportedDocuments: DocumentType[];

  build(request: GenerateDocumentRequest): Promise<BuildResult>;
  supportsFormat(format: OutputFormat): boolean;
  supportsDocument(type: DocumentType): boolean;
}

interface BuildResult {
  html: string;              // HTML for PDF
  xml?: string;              // XML to embed
  metadata: {
    requiresXmlEmbed: boolean;
    xmlSyntax?: 'ubl' | 'cii' | 'fatturapa';
  };
}
```

| Builder | Usage | Supported Formats |
|---------|-------|-------------------|
| `GenericDocumentBuilder` | Simple PDF | `pdf` |
| `EUDocumentBuilder` | Europe with e-invoicing | `pdf`, `facturx`, `zugferd`, `ubl`, `cii`, `xrechnung` |

### `documents/templates/` - Handlebars Templates

HTML templates for each document type.

| Template | Document |
|----------|----------|
| `base.template.ts` | Common CSS and HTML structure |
| `invoice.template.ts` | Invoice |
| `quote.template.ts` | Quote |
| `receipt.template.ts` | Receipt |
| `credit-note.template.ts` | Credit note |

Available Handlebars context:
```typescript
interface TemplateContext {
  number: string;
  date: string;
  dueDate?: string;
  company: DocumentParty;
  client: DocumentParty;
  items: Array<{ description, quantity, unitPrice, vatRate, totalPrice, type }>;
  totalHT, totalVAT, totalTTC: string;
  currency, currencySymbol: string;
  paymentMethod?, paymentDetails?: string;
  vatExemptText?, legalMentions?: string[];
  notes?: string;
  // Style
  fontFamily, primaryColor, secondaryColor, padding: ...;
  includeLogo: boolean;
  logoB64: string;
  // Labels (i18n)
  labels: PDFLabels;
  // Credit note specific
  originalInvoiceRef?, correctionReason?: string;
  // QR Code
  qrCode?: string;
}
```

### `documents/renderers/` - Rendering Engines

```typescript
interface IDocumentRenderer {
  render(html: string, format: OutputFormat, options?: RenderOptions): Promise<Buffer>;
}
```

| Renderer | Role | Technology |
|----------|------|------------|
| `PDFRenderer` | HTML → PDF | Puppeteer |
| `HybridRenderer` | PDF/A-3 + embedded XML | pdf-lib |
| `XMLRenderer` | XML only | Returns XML directly |

---

## 7. Formats - XML Generators

### `formats/format.service.ts` - Orchestrator

```typescript
@Injectable()
class FormatService {
  async generate(invoice: InvoiceData, config: FormatConfig): Promise<FormatResult>
  getSupportedFormats(): string[]
  isFormatSupported(format: string): boolean
  async validate(xml: string, format: string): Promise<{ valid, errors }>
}
```

### `formats/generators/` - Generators

```typescript
interface FormatGenerator {
  readonly name: string;
  readonly supportedFormats: string[];
  supports(format: string): boolean;
  generate(invoice: InvoiceData, config: FormatConfig): Promise<FormatResult>;
  validate?(xml: string): Promise<{ valid, errors }>;
}
```

| Generator | Formats | Syntax |
|-----------|---------|--------|
| `FacturXGenerator` | `facturx`, `zugferd`, `cii` | UN/CEFACT CII |
| `UBLGenerator` | `ubl`, `xrechnung`, `peppol-bis` | UBL 2.1 |
| `FatturaPAGenerator` | `fatturapa` | FatturaPA 1.2.2 |

---

## 8. Transmission - Invoice Sending

### `transmission/transmission.service.ts` - Orchestrator

```typescript
@Injectable()
class TransmissionService {
  async send(platform: string, payload: TransmissionPayload): Promise<TransmissionResult>
  async checkStatus(platform: string, externalId: string): Promise<TransmissionStatus>
  async cancel(platform: string, externalId: string): Promise<boolean>
  getStrategy(platform: string): TransmissionStrategy | null
  getSupportedPlatforms(): string[]
}
```

### `transmission/strategies/` - Strategies

```typescript
interface TransmissionStrategy {
  readonly name: string;
  readonly supportedPlatforms: string[];
  supports(platform: string): boolean;
  send(payload: TransmissionPayload): Promise<TransmissionResult>;
  checkStatus?(externalId: string): Promise<TransmissionStatus>;
  cancel?(externalId: string): Promise<boolean>;
}

interface TransmissionPayload {
  companyId: string;
  invoiceId: string;
  invoiceNumber: string;
  pdfBuffer: Buffer;
  xmlContent?: string;
  recipient: { email, name, siret?, vatNumber? };
  sender: { email, name, siret?, vatNumber? };
  metadata: { totalHT, totalVAT, totalTTC, currency };
}

interface TransmissionResult {
  success: boolean;
  externalId?: string;      // KSeFID, MARK, IRN...
  status?: TransmissionStatus;
  message?: string;
  errorCode?: string;
  validationUrl?: string;
  qrCodeData?: string;
}
```

| Strategy | Platform | Countries |
|----------|----------|-----------|
| `EmailStrategy` | `email` | All (fallback) |
| `ChorusStrategy` | `chorus` | FR B2G |
| `SuperPDPStrategy` | `superpdp` | FR B2B |
| `PeppolStrategy` | `peppol` | DE, BE, NL, NO, SE... |
| `SdIStrategy` | `sdi` | IT |
| `VerifactuStrategy` | `verifactu` | ES |
| `SaftStrategy` | `saft` | PT |

---

## 9. Data Flow

### Creating an Invoice

```
InvoicesService.createInvoice()
    │
    ├─→ ComplianceService.buildContext()
    │       └─→ ContextBuilderService.build()
    │
    ├─→ ComplianceService.resolveRules()
    │       └─→ RuleResolverService.resolve()
    │
    ├─→ ComplianceService.calculateVAT()
    │       └─→ VATEngineService.calculate()
    │
    └─→ prisma.invoice.create()
```

### PDF/XML Generation

```
InvoicesService.getInvoicePdf()
    │
    └─→ DocumentService.generate()
            │
            ├─→ getCountryConfig(supplierCountry)
            │       └─→ documents.builder → 'eu' | 'generic'
            │
            ├─→ getBuilder('eu')
            │       └─→ EUDocumentBuilder.build()
            │               ├─→ compileTemplate(invoiceTemplate)
            │               ├─→ buildTemplateContext()
            │               └─→ generateCII() / generateUBL()
            │
            └─→ getRenderer('facturx')
                    └─→ HybridRenderer.render()
                            ├─→ PDFRenderer (HTML → PDF)
                            └─→ embedXmlInPdf() (pdf-lib)
```

### Sending an Invoice

```
InvoicesService.sendInvoice()
    │
    ├─→ ComplianceService.buildContext()
    ├─→ ComplianceService.resolveRules()
    │       └─→ rules.transmission.platform → 'chorus' | 'peppol' | ...
    │
    ├─→ DocumentService.generate()  // PDF + XML if needed
    │
    └─→ ComplianceService.sendInvoice(platform, payload)
            └─→ TransmissionService.send()
                    └─→ ChorusStrategy.send()
                        or PeppolStrategy.send()
                        or EmailStrategy.send()
```

---

## 10. System Extension

### Adding a New Country

1. Create `configs/countries/{code}.config.ts`
2. Define all `CountryConfig` fields
3. Choose the appropriate `documents.builder` (`'generic'` or `'eu'`)
4. Import it in `configs/index.ts`

```typescript
// configs/countries/nl.config.ts
export const nlConfig: CountryConfig = {
  code: 'NL',
  name: 'country.netherlands',
  currency: 'EUR',
  isEU: true,
  // ...
  documents: EU_DOCUMENT_CONFIG,
};

// configs/index.ts
import { nlConfig } from './countries/nl.config';
const configs = {
  // ...
  NL: nlConfig,
};
```

### Adding a New Builder

1. Create `documents/builders/{name}.builder.ts`
2. Extend `BaseDocumentBuilder`
3. Implement `build()`
4. Register it in `documents/builders/index.ts`

```typescript
// documents/builders/it.builder.ts
export class ITDocumentBuilder extends BaseDocumentBuilder {
  readonly type: BuilderType = 'it';
  readonly supportedFormats = ['pdf', 'fatturapa'];

  async build(request) {
    // FatturaPA logic
  }
}

// documents/builders/index.ts
builderRegistry.set('it', ITDocumentBuilder);
```

### Adding a New Transmission Strategy

1. Create `transmission/strategies/{name}.strategy.ts`
2. Implement `TransmissionStrategy`
3. Register it in `ComplianceModule`

```typescript
// transmission/strategies/ksef.strategy.ts
@Injectable()
export class KSeFStrategy implements TransmissionStrategy {
  readonly name = 'ksef';
  readonly supportedPlatforms = ['ksef'];

  supports(platform: string) { return platform === 'ksef'; }

  async send(payload) {
    // KSeF logic (Poland)
  }
}
```

### Adding a New XML Format

1. Create `formats/generators/{name}.generator.ts`
2. Implement `FormatGenerator`
3. Register it in `ComplianceModule`

```typescript
// formats/generators/facturae.generator.ts
@Injectable()
export class FacturaeGenerator extends BaseGenerator {
  readonly name = 'facturae';
  readonly supportedFormats = ['facturae'];

  async generate(invoice, config) {
    // Generate Facturae XML (Spain)
  }
}
```

---

## Key Files Summary

| File | Role |
|------|------|
| `compliance.service.ts` | Main facade, entry point |
| `configs/index.ts` | Country configuration registry |
| `configs/countries/*.ts` | Complete configuration per country |
| `interfaces/country-config.interface.ts` | CountryConfig type |
| `interfaces/document-config.interface.ts` | DocumentConfig type + presets |
| `documents/document.service.ts` | Document generation orchestrator |
| `documents/document.types.ts` | DocumentType, OutputFormat types... |
| `documents/builders/*.ts` | HTML/XML builders by region |
| `documents/templates/*.ts` | Handlebars templates |
| `documents/renderers/*.ts` | HTML→PDF, PDF+XML, XML |
| `formats/format.service.ts` | XML format orchestrator |
| `formats/generators/*.ts` | UBL, CII, FatturaPA generators |
| `transmission/transmission.service.ts` | Sending orchestrator |
| `transmission/strategies/*.ts` | Strategies per platform |
| `services/vat-engine.service.ts` | VAT calculation |
| `services/context-builder.service.ts` | Transaction context building |
| `services/rule-resolver.service.ts` | Applicable rules resolution |

---

*Architecture updated on January 25, 2026*
