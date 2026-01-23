# Compliance Module Architecture

> **Purpose**: Ultra-modular design for country-specific invoicing compliance
>
> **Reference**: See [DIFFERENCES.md](./DIFFERENCES.md) for country-by-country comparison

---

## Table of Contents

1. [Overview](#1-overview)
2. [File Structure](#2-file-structure)
3. [Core Interfaces](#3-core-interfaces)
4. [Services](#4-services)
5. [Transmission Layer](#5-transmission-layer)
6. [Country Configuration System](#6-country-configuration-system)
7. [Module Integration](#7-module-integration)
8. [Extension Points](#8-extension-points)

---

## 1. Overview

The compliance module is designed to handle the extreme diversity of invoicing requirements across countries:

- **Clearance models** (IT, PL, CN, TR, IN, MY, VN, RS)
- **PDP/Y-model** (FR)
- **Real-time reporting** (HU, GR)
- **Hash chaining** (ES, PT)
- **Peppol network** (DE, BE, NL, NO, SE, AT, GB, AU, NZ, JP, SG)
- **Payment-focused** (CH)

### Design Principles

1. **One config file per country** - All country specifics in `configs/countries/{code}.config.ts`
2. **Strategy pattern for transmission** - Each platform is a pluggable strategy
3. **Interface segregation** - Small, focused interfaces that compose into full configs
4. **Fail-safe defaults** - Generic config covers unlisted countries
5. **i18n ready** - All text uses translation keys

---

## 2. File Structure

```
backend/src/modules/compliance/
├── compliance.module.ts              # Main NestJS module
├── compliance.controller.ts          # REST endpoints
├── compliance.service.ts             # Main facade
├── index.ts                          # Public exports
│
├── interfaces/
│   ├── index.ts
│   ├── country-config.interface.ts   # Full country config
│   ├── vat.interface.ts              # VAT rates, rules
│   ├── identifier.interface.ts       # Business identifiers
│   ├── transmission.interface.ts     # Transmission models
│   ├── numbering.interface.ts        # Invoice numbering
│   ├── format.interface.ts           # Document formats
│   ├── signature.interface.ts        # Digital signatures
│   ├── correction.interface.ts       # Credit notes / corrections
│   ├── archiving.interface.ts        # Retention rules
│   ├── peppol.interface.ts           # Peppol-specific
│   ├── clearance.interface.ts        # Clearance-specific
│   ├── transaction-context.interface.ts
│   └── applicable-rules.interface.ts
│
├── services/
│   ├── index.ts
│   ├── context-builder.service.ts    # Build TransactionContext
│   ├── rule-resolver.service.ts      # Resolve rules from context
│   ├── vat-engine.service.ts         # VAT calculation
│   ├── correction.service.ts         # Credit note management
│   ├── numbering.service.ts          # Invoice numbering
│   ├── hash-chain.service.ts         # ES/PT hash chaining
│   ├── qr-code.service.ts            # QR code generation
│   ├── vies.service.ts               # EU VAT validation
│   └── xades-signature.service.ts    # XAdES-BES signing (IT, ES)
│
├── configs/
│   ├── index.ts                      # Config registry
│   ├── generic.config.ts             # Default fallback
│   └── countries/
│       ├── fr.config.ts              # France
│       ├── de.config.ts              # Germany
│       ├── it.config.ts              # Italy
│       ├── es.config.ts              # Spain
│       ├── pt.config.ts              # Portugal
│       ├── pl.config.ts              # Poland
│       ├── be.config.ts              # Belgium
│       ├── hu.config.ts              # Hungary
│       ├── ro.config.ts              # Romania
│       ├── gr.config.ts              # Greece
│       ├── gb.config.ts              # United Kingdom
│       ├── nl.config.ts              # Netherlands
│       ├── no.config.ts              # Norway
│       ├── se.config.ts              # Sweden
│       ├── at.config.ts              # Austria
│       ├── ch.config.ts              # Switzerland
│       ├── au.config.ts              # Australia
│       ├── nz.config.ts              # New Zealand
│       ├── cn.config.ts              # China
│       ├── tr.config.ts              # Turkey
│       ├── rs.config.ts              # Serbia
│       ├── in.config.ts              # India
│       ├── jp.config.ts              # Japan
│       ├── my.config.ts              # Malaysia
│       ├── sg.config.ts              # Singapore
│       └── vn.config.ts              # Vietnam
│
├── transmission/
│   ├── index.ts
│   ├── transmission.interface.ts
│   ├── transmission.service.ts       # Orchestrator
│   └── strategies/
│       ├── index.ts
│       ├── base.strategy.ts          # Abstract base
│       │
│       │ # Email / Fallback
│       ├── email.strategy.ts
│       │
│       │ # France
│       ├── chorus.strategy.ts        # Chorus Pro (B2G)
│       ├── superpdp.strategy.ts      # PDP platforms (B2B)
│       │
│       │ # Italy
│       ├── sdi.strategy.ts           # Sistema di Interscambio
│       │
│       │ # Spain
│       ├── verifactu.strategy.ts     # Veri*Factu hash chain
│       │
│       │ # Portugal
│       ├── saft.strategy.ts          # SAF-T export
│       │
│       │ # Poland
│       ├── ksef.strategy.ts          # KSeF clearance
│       │
│       │ # Hungary
│       ├── nav.strategy.ts           # NAV real-time reporting
│       │
│       │ # Romania
│       ├── spv.strategy.ts           # SPV / e-Factura
│       │
│       │ # Greece
│       ├── mydata.strategy.ts        # myDATA reporting
│       │
│       │ # China
│       ├── leqi.strategy.ts          # Golden Tax IV
│       │
│       │ # Turkey
│       ├── gib.strategy.ts           # e-Fatura / e-Arşiv
│       │
│       │ # Serbia
│       ├── sef.strategy.ts           # Sistem E-Faktura
│       │
│       │ # India
│       ├── irp.strategy.ts           # Invoice Registration Portal
│       │
│       │ # Malaysia
│       ├── myinvois.strategy.ts      # MyInvois
│       │
│       │ # Vietnam
│       ├── tvan.strategy.ts          # T-VAN providers
│       │
│       │ # Peppol (multi-country)
│       └── peppol.strategy.ts        # Generic Peppol AS4
│
├── formats/
│   ├── index.ts
│   ├── format.interface.ts
│   ├── format.service.ts             # Format orchestrator
│   └── generators/
│       ├── base.generator.ts
│       ├── facturx.generator.ts      # FR, DE (Factur-X/ZUGFeRD)
│       ├── xrechnung.generator.ts    # DE B2G
│       ├── fatturaPA.generator.ts    # IT
│       ├── facturae.generator.ts     # ES
│       ├── fa3.generator.ts          # PL (KSeF)
│       ├── ubl.generator.ts          # Generic UBL 2.1
│       ├── pint.generator.ts         # AU, NZ, JP, SG
│       ├── cii.generator.ts          # Generic CII
│       ├── mydata.generator.ts       # GR
│       ├── nav.generator.ts          # HU
│       └── gst-json.generator.ts     # IN
│
└── dto/
    ├── compliance-config.dto.ts
    ├── transmission-result.dto.ts
    └── vat-calculation.dto.ts
```

---

## 3. Core Interfaces

### 3.1 VAT Interfaces (`interfaces/vat.interface.ts`)

```typescript
export interface VATRate {
  code: string;           // 'S', 'R1', 'R2', 'Z', 'E', 'AE', 'G'
  rate: number;           // e.g., 20, 10, 5.5
  labelKey: string;       // i18n key: 'vat.rate.standard'
  category?: string;      // UBL category code
}

export interface VATExemption {
  code: string;           // Internal code
  article: string;        // Legal reference: 'Art. 262 CGI'
  labelKey: string;       // i18n key
  ublCode?: string;       // UBL exemption code
}

export interface VATConfig {
  rates: VATRate[];
  defaultRate: number;
  exemptions: VATExemption[];
  numberFormat: RegExp;           // e.g., /^FR[0-9A-Z]{2}[0-9]{9}$/
  numberPrefix: string;           // 'FR', 'DE', etc.
  roundingMode: 'line' | 'total'; // Per-line or per-invoice
  reverseChargeTexts: {
    services: string;             // i18n key
    goods: string;                // i18n key
  };
}
```

### 3.2 Identifier Interfaces (`interfaces/identifier.interface.ts`)

```typescript
export interface IdentifierDefinition {
  id: string;             // 'siret', 'siren', 'nif', 'abn', etc.
  labelKey: string;       // i18n key
  format: RegExp;         // Validation regex
  required: boolean;
  maxLength?: number;
  luhnCheck?: boolean;    // SE requires Luhn algorithm
  peppolScheme?: string;  // '0009', '0151', etc.
}

export interface IdentifierConfig {
  company: IdentifierDefinition[];
  client: IdentifierDefinition[];
}
```

### 3.3 Transmission Interfaces (`interfaces/transmission.interface.ts`)

```typescript
export type TransmissionModel =
  | 'email'           // Simple email delivery
  | 'peppol'          // Peppol AS4 network
  | 'clearance'       // Pre-validation by authority (IT, PL, CN, TR, IN, MY, VN, RS)
  | 'pdp'             // Private platforms (FR)
  | 'rttr'            // Real-time transaction reporting (HU, GR)
  | 'hash_chain';     // Certified software with hash (ES, PT)

export interface TransmissionConfig {
  model: TransmissionModel;
  platform?: string;          // 'chorus', 'sdi', 'ksef', etc.
  mandatory: boolean;
  mandatoryFrom?: string;     // ISO date
  async: boolean;             // Response comes later?
  deadlineDays?: number;      // Days to report/transmit
  labelKey: string;
  icon: string;

  // Peppol-specific
  peppolScheme?: string;
  peppolProfileId?: string;

  // Clearance-specific
  clearanceEndpoint?: string;
  clearanceAuth?: 'oauth2' | 'certificate' | 'api_key';

  // Platform-specific identifiers
  requiredRecipientId?: string;  // 'codiceDestinatario', 'siret', etc.
}

export interface TransmissionPayload {
  invoiceId: string;
  invoiceNumber: string;
  pdfBuffer: Buffer;
  xmlContent?: string;
  format: string;              // 'facturx', 'fatturaPA', etc.
  recipient: RecipientInfo;
  sender: SenderInfo;
  metadata: InvoiceMetadata;
  countrySpecific?: Record<string, unknown>;
}

export interface TransmissionResult {
  success: boolean;
  externalId?: string;         // Platform-assigned ID (KSeFID, MARK, IRN, etc.)
  validationUrl?: string;      // URL to verify invoice
  qrCodeData?: string;         // QR code content to embed
  errorCode?: string;
  errorMessage?: string;
  status?: TransmissionStatus;
}

export type TransmissionStatus =
  | 'pending'
  | 'submitted'
  | 'validated'
  | 'accepted'
  | 'rejected'
  | 'delivered';
```

### 3.4 Numbering Interfaces (`interfaces/numbering.interface.ts`)

```typescript
export interface NumberingConfig {
  seriesRequired: boolean;          // Must use series
  seriesRegistration: boolean;      // PT: register with AT
  seriesFormat?: RegExp;            // Validation for series

  hashChaining: boolean;            // ES, PT: crypto chain
  hashAlgorithm?: 'sha256' | 'sha1';
  hashFields?: string[];            // Fields included in hash

  gapAllowed: boolean;              // Can skip numbers?
  resetPeriod: 'never' | 'yearly' | 'monthly';

  platformAssigned: boolean;        // PL, CN: platform assigns number
  platformIdField?: string;         // 'ksefId', 'mark', 'irn', etc.
  platformIdFormat?: RegExp;
}
```

### 3.5 Format Interfaces (`interfaces/format.interface.ts`)

```typescript
export type DocumentSyntax =
  | 'UBL'           // Universal Business Language
  | 'CII'           // Cross-Industry Invoice (UN/CEFACT)
  | 'FatturaPA'     // Italian
  | 'Facturae'      // Spanish
  | 'FA3'           // Polish KSeF
  | 'NAV'           // Hungarian
  | 'myDATA'        // Greek
  | 'GST_JSON'      // Indian
  | 'GB_T_38636';   // Chinese

export interface FormatConfig {
  preferred: string;              // 'facturx', 'xrechnung', etc.
  supported: string[];
  syntax: DocumentSyntax;
  version?: string;               // '2.2', '1.2', etc.
  profile?: string;               // 'EN16931', 'EXTENDED', etc.

  // Country-specific customization ID
  customizationId?: string;       // UBL CustomizationID
  profileId?: string;             // UBL ProfileID
}
```

### 3.6 Signature Interfaces (`interfaces/signature.interface.ts`)

```typescript
export type SignatureType =
  | 'none'
  | 'xades'          // XML Advanced Electronic Signature
  | 'pades'          // PDF Advanced Electronic Signature
  | 'hash_chain'     // Cryptographic hash chain
  | 'platform_sign'  // Platform signs (IN, MY)
  | 'national';      // National standard (CN: SM2)

export interface SignatureConfig {
  required: boolean;
  type: SignatureType;
  algorithm?: string;             // 'SHA-256', 'SHA3-512', 'SM2', etc.
  certificateType?: 'qualified' | 'advanced' | 'national';
  timestampRequired?: boolean;
}

export interface QRCodeConfig {
  required: boolean;
  contentType: 'verification_url' | 'hash' | 'payment' | 'full_data';
  contentFields?: string[];       // Fields to include
  format?: 'standard' | 'swiss';  // Swiss QR-Bill format
  position?: 'footer' | 'header' | 'side';
}
```

### 3.7 Correction Interfaces (`interfaces/correction.interface.ts`)

```typescript
export type CorrectionMethod =
  | 'credit_note'         // Avoir, Gutschrift, Nota di credito
  | 'corrective_invoice'  // Factura rectificativa
  | 'replacement'         // Vietnam: replacement invoice
  | 'void_and_reissue'    // US/UK style
  | 'platform_request';   // CN: Red-letter info sheet first

export interface CorrectionConfig {
  allowDirectModification: boolean;
  method: CorrectionMethod;
  requiresOriginalReference: boolean;

  // Document type codes (UBL/CII)
  codes: {
    creditNote: string;        // '381'
    debitNote: string;         // '383'
    corrective: string;        // '384'
  };

  // Platform-specific workflow
  requiresPreApproval: boolean;  // CN: Info sheet first
  approvalEndpoint?: string;

  correctionTextKey: string;     // i18n key for legal text
}
```

### 3.8 Archiving Interfaces (`interfaces/archiving.interface.ts`)

```typescript
export interface ArchivingConfig {
  retentionYears: number;         // 5, 7, 10, 30
  formatRequired: 'xml' | 'pdf' | 'both' | 'ofd';
  searchable: boolean;            // JP: EBKA requires searchable
  searchFields?: string[];        // Required search fields
  dataResidency?: string;         // 'CN' for China
  platformStoresCopy: boolean;    // Platform keeps copy?
}
```

### 3.9 Clearance-Specific Interface (`interfaces/clearance.interface.ts`)

```typescript
export interface ClearanceConfig {
  enabled: boolean;
  platform: string;               // 'sdi', 'ksef', 'irp', etc.

  // Authentication
  authMethod: 'oauth2' | 'certificate' | 'api_key' | 'hsm';
  authEndpoint?: string;

  // Submission
  submitEndpoint: string;
  responseType: 'sync' | 'async';
  pollingEndpoint?: string;       // For async responses

  // Returned identifiers
  assignsInvoiceNumber: boolean;
  returnedIdField: string;        // 'ksefId', 'irn', 'mark', etc.
  returnedIdFormat?: RegExp;

  // QR / Validation
  returnsQRCode: boolean;
  returnsValidationUrl: boolean;

  // Acceptance model
  buyerAcceptance: 'none' | 'optional' | 'required';
  acceptanceTimeout?: number;     // Days
  autoAccept?: 'buyer' | 'seller';

  // Middleware required?
  requiresMiddleware: boolean;
  middlewareExamples?: string[];  // 'Baiwang', 'ClearTax', etc.
}
```

### 3.10 Peppol-Specific Interface (`interfaces/peppol.interface.ts`)

```typescript
export interface PeppolConfig {
  enabled: boolean;
  schemeId: string;               // ICD code: '0009', '0151', etc.
  participantIdFormat: RegExp;

  // Profile
  documentTypeId: string;
  processId: string;
  customizationId: string;

  // Local variant
  localStandard?: string;         // 'PINT-ANZ', 'JP-PINT', 'SI-UBL', etc.
  localVersion?: string;

  // Validation
  validatorUrl?: string;
  schematronRules?: string[];

  // 5-corner model?
  fiveCorner?: {
    enabled: boolean;
    taxAuthorityEndpoint: string;
    taxAuthorityScheme: string;
  };
}
```

### 3.11 Full Country Config (`interfaces/country-config.interface.ts`)

```typescript
export interface CountryConfig {
  // Basic info
  code: string;                   // ISO 3166-1 alpha-2
  name: string;
  currency: string;               // ISO 4217
  locale: string;                 // 'fr-FR', 'de-DE'
  timezone: string;

  // EU membership
  isEU: boolean;
  euSince?: string;               // ISO date

  // Sub-configs
  vat: VATConfig;
  identifiers: IdentifierConfig;
  transmission: {
    b2b: TransmissionConfig;
    b2g: TransmissionConfig;
    b2c?: TransmissionConfig;     // If different from B2B
  };
  numbering: NumberingConfig;
  format: FormatConfig;
  signature: SignatureConfig;
  qrCode: QRCodeConfig;
  correction: CorrectionConfig;
  archiving: ArchivingConfig;

  // Platform-specific configs
  clearance?: ClearanceConfig;
  peppol?: PeppolConfig;

  // Required fields by document type
  requiredFields: {
    invoice: string[];
    creditNote: string[];
    client: {
      b2b: string[];
      b2g: string[];
      b2c: string[];
    };
  };

  // Legal mentions
  legalMentions: {
    mandatory: string[];          // i18n keys always shown
    conditional: ConditionalMention[];
  };

  // Country-specific fields (flexible)
  customFields?: CustomFieldDefinition[];

  // Payment references
  paymentReference?: PaymentReferenceConfig;
}

export interface ConditionalMention {
  condition: MentionCondition;
  textKey: string;
}

export type MentionCondition =
  | 'reverse_charge'
  | 'intra_eu'
  | 'export'
  | 'exempt'
  | 'small_business'
  | 'b2g';

export interface CustomFieldDefinition {
  id: string;                     // 'leitwegId', 'codiceDestinatario', etc.
  labelKey: string;
  type: 'string' | 'number' | 'date' | 'select';
  required: boolean | MentionCondition;
  format?: RegExp;
  options?: string[];             // For select type
  mappedTo?: string;              // UBL/CII path
}

export interface PaymentReferenceConfig {
  system: string;                 // 'vcs', 'kid', 'qrr', 'scor'
  format: RegExp;
  generator?: 'modulo97' | 'custom';
  labelKey: string;
}
```

### 3.12 Transaction Context (`interfaces/transaction-context.interface.ts`)

```typescript
export interface TransactionContext {
  supplier: {
    countryCode: string;
    vatNumber: string | null;
    isVatRegistered: boolean;
    identifiers: Record<string, string>;
    config: CountryConfig;
  };

  customer: {
    countryCode: string | null;
    vatNumber: string | null;
    isVatRegistered: boolean;
    isPublicEntity: boolean;
    identifiers: Record<string, string>;
    config: CountryConfig | null;
  };

  transaction: {
    type: 'B2B' | 'B2G' | 'B2C';
    nature: 'goods' | 'services' | 'mixed';
    isDomestic: boolean;
    isIntraEU: boolean;
    isExport: boolean;
  };

  place: {
    delivery: string | null;
    performance: string | null;
    taxation: string;
  };
}
```

### 3.13 Applicable Rules (`interfaces/applicable-rules.interface.ts`)

```typescript
export interface ApplicableRules {
  vat: {
    rates: VATRate[];
    defaultRate: number;
    exemptions: VATExemption[];
    reverseCharge: boolean;
    reverseChargeTextKey: string | null;
    roundingMode: 'line' | 'total';
  };

  validation: {
    requiredFields: {
      invoice: string[];
      client: string[];
    };
    identifierFormats: Record<string, RegExp>;
    vatNumberFormat: RegExp | null;
  };

  format: FormatConfig;
  transmission: TransmissionConfig;
  numbering: NumberingConfig;
  signature: SignatureConfig;
  qrCode: QRCodeConfig;
  correction: CorrectionConfig;
  archiving: ArchivingConfig;

  legalMentionKeys: string[];
  customFields: CustomFieldDefinition[];

  // Platform-specific
  clearance: ClearanceConfig | null;
  peppol: PeppolConfig | null;
}
```

---

## 4. Services

### 4.1 ContextBuilderService

Builds `TransactionContext` from raw invoice data.

```typescript
@Injectable()
export class ContextBuilderService {
  async buildContext(input: ContextInput): Promise<TransactionContext> {
    // 1. Load country configs
    const supplierConfig = this.configRegistry.get(input.supplier.countryCode);
    const customerConfig = input.customer.countryCode
      ? this.configRegistry.get(input.customer.countryCode)
      : null;

    // 2. Validate VAT numbers via VIES (if EU)
    if (supplierConfig.isEU && input.customer.vatNumber) {
      await this.viesService.validate(input.customer.vatNumber);
    }

    // 3. Determine transaction characteristics
    const isDomestic = input.supplier.countryCode === input.customer.countryCode;
    const isIntraEU = supplierConfig.isEU && customerConfig?.isEU && !isDomestic;
    const isExport = !supplierConfig.isEU || !customerConfig?.isEU;

    // 4. Determine place of taxation
    const taxation = this.determineTaxationPlace(input, supplierConfig);

    return { supplier, customer, transaction, place };
  }
}
```

### 4.2 RuleResolverService

Resolves `ApplicableRules` from `TransactionContext`.

```typescript
@Injectable()
export class RuleResolverService {
  resolveRules(context: TransactionContext): ApplicableRules {
    const { supplier, customer, transaction } = context;
    const config = supplier.config;

    // VAT Rules
    const vatRules = this.resolveVATRules(context);

    // Transmission: B2G uses customer country rules
    const transmissionConfig = transaction.type === 'B2G' && customer.config
      ? customer.config.transmission.b2g
      : config.transmission[transaction.type.toLowerCase()];

    // Format: Follow taxation place rules
    const formatConfig = this.resolveFormat(context);

    // Numbering: Always supplier country
    const numberingConfig = config.numbering;

    // Clearance/Peppol: Based on transmission model
    const clearance = transmissionConfig.model === 'clearance'
      ? config.clearance
      : null;
    const peppol = transmissionConfig.model === 'peppol'
      ? config.peppol
      : null;

    return { vat: vatRules, validation, format, transmission, ... };
  }

  private resolveVATRules(context: TransactionContext): VATRules {
    const { transaction, customer, supplier } = context;

    // Intra-EU B2B with registered buyer → Reverse charge
    if (transaction.isIntraEU &&
        transaction.type !== 'B2C' &&
        customer.isVatRegistered) {
      return {
        rates: supplier.config.vat.rates,
        defaultRate: 0,
        reverseCharge: true,
        reverseChargeTextKey: transaction.nature === 'goods'
          ? supplier.config.vat.reverseChargeTexts.goods
          : supplier.config.vat.reverseChargeTexts.services,
      };
    }

    // Export outside EU → Zero rate
    if (transaction.isExport) {
      return {
        rates: supplier.config.vat.rates,
        defaultRate: 0,
        reverseCharge: false,
        reverseChargeTextKey: null,
      };
    }

    // Domestic → Supplier country rates
    return {
      rates: supplier.config.vat.rates,
      defaultRate: supplier.config.vat.defaultRate,
      reverseCharge: false,
      reverseChargeTextKey: null,
    };
  }
}
```

### 4.3 VATEngineService

Calculates VAT with country-specific rounding.

```typescript
@Injectable()
export class VATEngineService {
  calculate(items: VATItem[], rules: VATRules): VATResult {
    if (rules.roundingMode === 'line') {
      return this.calculateWithLineRounding(items, rules);
    }
    return this.calculateWithTotalRounding(items, rules);
  }

  private calculateWithLineRounding(items, rules): VATResult {
    // Round VAT per line, then sum
    // Used by: France
  }

  private calculateWithTotalRounding(items, rules): VATResult {
    // Sum all, then round once per rate
    // Used by: Most countries, JP (strict per-rate rule)
  }
}
```

### 4.4 HashChainService

For countries requiring cryptographic hash chaining (ES, PT).

```typescript
@Injectable()
export class HashChainService {
  async generateHash(invoice: Invoice, config: NumberingConfig): Promise<string> {
    if (!config.hashChaining) return null;

    // Get previous invoice hash
    const previousHash = await this.getPreviousHash(invoice.companyId);

    // Build hash input based on country
    const hashInput = this.buildHashInput(invoice, previousHash, config);

    // Hash with configured algorithm
    return this.hash(hashInput, config.hashAlgorithm);
  }

  private buildHashInput(invoice, previousHash, config): string {
    // ES: invoiceNumber + date + total + previousHash
    // PT: invoiceNumber + date + totalTTC + previousHash
    return config.hashFields.map(f => invoice[f]).join('') + previousHash;
  }
}
```

### 4.5 QRCodeService

Generates QR codes with country-specific content.

```typescript
@Injectable()
export class QRCodeService {
  generate(invoice: Invoice, config: QRCodeConfig, transmissionResult?: TransmissionResult): string {
    if (!config.required) return null;

    switch (config.contentType) {
      case 'verification_url':
        // IN, MY: URL returned by platform
        return transmissionResult?.validationUrl || '';

      case 'hash':
        // ES, PT: Hash + verification data
        return this.buildHashQR(invoice, config);

      case 'payment':
        // CH: Swiss QR-Bill format
        return this.buildSwissQR(invoice);

      case 'full_data':
        // GR: Full invoice data in QR
        return this.buildDataQR(invoice, config);
    }
  }
}
```

### 4.6 CorrectionService

Manages credit notes and corrections.

```typescript
@Injectable()
export class CorrectionService {
  canModify(invoice: Invoice): { allowed: boolean; reason?: string } {
    const config = this.configRegistry.get(invoice.company.countryCode);

    // Already transmitted to platform?
    if (invoice.transmittedAt && !config.correction.allowDirectModification) {
      return {
        allowed: false,
        reason: 'invoice.correction.already_transmitted'
      };
    }

    return { allowed: config.correction.allowDirectModification };
  }

  getCorrectionMethod(invoice: Invoice): CorrectionConfig {
    const config = this.configRegistry.get(invoice.company.countryCode);
    return config.correction;
  }

  async createCreditNote(invoice: Invoice, reason: string): Promise<CreditNote> {
    const config = this.configRegistry.get(invoice.company.countryCode);

    // China: Need pre-approval
    if (config.correction.requiresPreApproval) {
      await this.requestCorrectionApproval(invoice, config);
    }

    return this.generateCreditNote(invoice, reason, config);
  }
}
```

---

## 5. Transmission Layer

### 5.1 Strategy Pattern

Each platform implements `TransmissionStrategy`:

```typescript
export interface TransmissionStrategy {
  readonly name: string;
  readonly supportedPlatforms: string[];

  supports(platform: string): boolean;
  send(payload: TransmissionPayload): Promise<TransmissionResult>;
  checkStatus?(externalId: string): Promise<TransmissionStatus>;
  cancel?(externalId: string): Promise<boolean>;
}
```

### 5.2 TransmissionService (Orchestrator)

```typescript
@Injectable()
export class TransmissionService {
  private strategies: TransmissionStrategy[];

  async send(platform: string, payload: TransmissionPayload): Promise<TransmissionResult> {
    const strategy = this.strategies.find(s => s.supports(platform));

    if (!strategy) {
      this.logger.warn(`No strategy for ${platform}, falling back to email`);
      return this.emailStrategy.send(payload);
    }

    return strategy.send(payload);
  }
}
```

### 5.3 Strategy Examples

**PeppolStrategy** (DE, BE, NL, NO, SE, AT, GB, AU, NZ, JP, SG):
```typescript
@Injectable()
export class PeppolStrategy implements TransmissionStrategy {
  name = 'peppol';
  supportedPlatforms = ['peppol', 'peppol-bis', 'pint-anz', 'jp-pint', 'pint-sg'];

  async send(payload: TransmissionPayload): Promise<TransmissionResult> {
    // 1. Lookup receiver in SMP
    const endpoint = await this.smpLookup(payload.recipient);

    // 2. Send via AS4
    const response = await this.as4Client.send(endpoint, payload.xmlContent);

    return {
      success: response.status === 'accepted',
      externalId: response.messageId,
    };
  }
}
```

**KSeFStrategy** (Poland):
```typescript
@Injectable()
export class KSeFStrategy implements TransmissionStrategy {
  name = 'ksef';
  supportedPlatforms = ['ksef'];

  async send(payload: TransmissionPayload): Promise<TransmissionResult> {
    // 1. Authenticate with qualified signature
    const session = await this.authenticate();

    // 2. Submit invoice
    const response = await this.submit(session, payload.xmlContent);

    // 3. Get assigned KSeF ID
    return {
      success: true,
      externalId: response.ksefId,  // 32-char ID
      validationUrl: `https://ksef.mf.gov.pl/verify/${response.ksefId}`,
    };
  }
}
```

**IRPStrategy** (India):
```typescript
@Injectable()
export class IRPStrategy implements TransmissionStrategy {
  name = 'irp';
  supportedPlatforms = ['irp'];

  async send(payload: TransmissionPayload): Promise<TransmissionResult> {
    // Must go through GSP middleware
    const gsp = this.getGSPClient();

    // 1. Generate JSON (not XML)
    const json = this.toGSTJSON(payload);

    // 2. Submit to IRP via GSP
    const response = await gsp.generateInvoice(json);

    return {
      success: response.status === 'ACT',
      externalId: response.irn,           // 64-char hash
      qrCodeData: response.signedQRCode,  // Must embed in PDF
      validationUrl: response.validationUrl,
    };
  }
}
```

---

## 6. Country Configuration System

### 6.1 Config Registry

```typescript
@Injectable()
export class ConfigRegistry {
  private configs: Map<string, CountryConfig> = new Map();

  constructor() {
    this.registerAll();
  }

  private registerAll() {
    // Import all country configs
    this.configs.set('FR', frConfig);
    this.configs.set('DE', deConfig);
    this.configs.set('IT', itConfig);
    // ... etc

    // Set generic as fallback
    this.configs.set('GENERIC', genericConfig);
  }

  get(countryCode: string): CountryConfig {
    return this.configs.get(countryCode.toUpperCase())
        || this.configs.get('GENERIC');
  }

  getAll(): CountryConfig[] {
    return Array.from(this.configs.values())
      .filter(c => c.code !== 'GENERIC');
  }
}
```

### 6.2 Example Country Config: France

```typescript
// configs/countries/fr.config.ts

export const frConfig: CountryConfig = {
  code: 'FR',
  name: 'France',
  currency: 'EUR',
  locale: 'fr-FR',
  timezone: 'Europe/Paris',
  isEU: true,

  vat: {
    rates: [
      { code: 'S', rate: 20, labelKey: 'vat.rate.standard', category: 'S' },
      { code: 'R1', rate: 10, labelKey: 'vat.rate.intermediate', category: 'AA' },
      { code: 'R2', rate: 5.5, labelKey: 'vat.rate.reduced', category: 'AA' },
      { code: 'R3', rate: 2.1, labelKey: 'vat.rate.super_reduced', category: 'AA' },
      { code: 'Z', rate: 0, labelKey: 'vat.rate.zero', category: 'Z' },
      { code: 'E', rate: 0, labelKey: 'vat.rate.exempt', category: 'E' },
    ],
    defaultRate: 20,
    exemptions: [
      { code: 'TRAINING', article: 'Art. 261-4-4° CGI', labelKey: 'vat.exempt.training' },
      { code: 'MEDICAL', article: 'Art. 261-4-1° CGI', labelKey: 'vat.exempt.medical' },
      { code: 'INTRA_EU', article: 'Art. 262 ter I CGI', labelKey: 'vat.exempt.intra_eu' },
      { code: 'EXPORT', article: 'Art. 262 I CGI', labelKey: 'vat.exempt.export' },
    ],
    numberFormat: /^FR[0-9A-Z]{2}[0-9]{9}$/,
    numberPrefix: 'FR',
    roundingMode: 'line',
    reverseChargeTexts: {
      services: 'compliance.fr.reverseCharge.services',
      goods: 'compliance.fr.reverseCharge.goods',
    },
  },

  identifiers: {
    company: [
      { id: 'siret', labelKey: 'identifier.siret', format: /^[0-9]{14}$/, required: true, peppolScheme: '0009' },
      { id: 'siren', labelKey: 'identifier.siren', format: /^[0-9]{9}$/, required: false },
      { id: 'rcs', labelKey: 'identifier.rcs', format: /^[A-Z]{1,2}\s?\d{3}\s?\d{3}\s?\d{3}$/, required: true },
      { id: 'naf', labelKey: 'identifier.naf', format: /^[0-9]{4}[A-Z]$/, required: false },
    ],
    client: [
      { id: 'siret', labelKey: 'identifier.siret', format: /^[0-9]{14}$/, required: false, peppolScheme: '0009' },
    ],
  },

  transmission: {
    b2b: {
      model: 'pdp',
      platform: 'superpdp',
      mandatory: true,
      mandatoryFrom: '2026-09-01',
      async: true,
      labelKey: 'transmission.pdp',
      icon: 'building',
    },
    b2g: {
      model: 'platform',
      platform: 'chorus',
      mandatory: true,
      async: true,
      labelKey: 'transmission.chorus',
      icon: 'landmark',
      requiredRecipientId: 'siret',
    },
  },

  numbering: {
    seriesRequired: false,
    seriesRegistration: false,
    hashChaining: false,
    gapAllowed: false,
    resetPeriod: 'yearly',
    platformAssigned: false,
  },

  format: {
    preferred: 'facturx',
    supported: ['facturx', 'ubl', 'cii'],
    syntax: 'CII',
    version: '1.0.07',
    profile: 'EN16931',
  },

  signature: {
    required: false,
    type: 'pades',
  },

  qrCode: {
    required: false,
    contentType: 'verification_url',
  },

  correction: {
    allowDirectModification: false,
    method: 'credit_note',
    requiresOriginalReference: true,
    codes: {
      creditNote: '381',
      debitNote: '383',
      corrective: '384',
    },
    requiresPreApproval: false,
    correctionTextKey: 'compliance.fr.creditNote.mention',
  },

  archiving: {
    retentionYears: 10,
    formatRequired: 'both',
    searchable: false,
    platformStoresCopy: true,
  },

  peppol: {
    enabled: true,
    schemeId: '0009',
    participantIdFormat: /^0009:[0-9]{14}$/,
    documentTypeId: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:minimum::2.1',
    processId: 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0',
    customizationId: 'urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:extended',
  },

  requiredFields: {
    invoice: ['number', 'date', 'dueDate', 'currency'],
    creditNote: ['originalInvoiceReference', 'reason'],
    client: {
      b2b: ['name', 'address', 'vatNumber'],
      b2g: ['name', 'address', 'siret'],
      b2c: ['name'],
    },
  },

  legalMentions: {
    mandatory: [
      'compliance.fr.mention.siret',
      'compliance.fr.mention.rcs',
      'compliance.fr.mention.capital',
    ],
    conditional: [
      { condition: 'reverse_charge', textKey: 'compliance.fr.mention.reverseCharge' },
      { condition: 'intra_eu', textKey: 'compliance.fr.mention.intraEU' },
      { condition: 'export', textKey: 'compliance.fr.mention.export' },
      { condition: 'small_business', textKey: 'compliance.fr.mention.smallBusiness' },
    ],
  },
};
```

### 6.3 Example Country Config: India (Clearance)

```typescript
// configs/countries/in.config.ts

export const inConfig: CountryConfig = {
  code: 'IN',
  name: 'India',
  currency: 'INR',
  locale: 'en-IN',
  timezone: 'Asia/Kolkata',
  isEU: false,

  vat: {
    rates: [
      { code: 'S28', rate: 28, labelKey: 'vat.rate.luxury', category: 'S' },
      { code: 'S18', rate: 18, labelKey: 'vat.rate.standard', category: 'S' },
      { code: 'S12', rate: 12, labelKey: 'vat.rate.standard_low', category: 'S' },
      { code: 'S5', rate: 5, labelKey: 'vat.rate.reduced', category: 'AA' },
      { code: 'Z', rate: 0, labelKey: 'vat.rate.zero', category: 'Z' },
      { code: 'E', rate: 0, labelKey: 'vat.rate.exempt', category: 'E' },
    ],
    defaultRate: 18,
    exemptions: [],
    numberFormat: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/,
    numberPrefix: '',  // GSTIN doesn't have prefix
    roundingMode: 'total',
    reverseChargeTexts: {
      services: 'compliance.in.reverseCharge.services',
      goods: 'compliance.in.reverseCharge.goods',
    },
  },

  identifiers: {
    company: [
      { id: 'gstin', labelKey: 'identifier.gstin', format: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/, required: true },
      { id: 'pan', labelKey: 'identifier.pan', format: /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, required: true },
    ],
    client: [
      { id: 'gstin', labelKey: 'identifier.gstin', format: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/, required: true },
    ],
  },

  transmission: {
    b2b: {
      model: 'clearance',
      platform: 'irp',
      mandatory: true,
      async: false,  // Sync response
      labelKey: 'transmission.irp',
      icon: 'shield-check',
    },
    b2g: {
      model: 'clearance',
      platform: 'irp',
      mandatory: true,
      async: false,
      labelKey: 'transmission.irp',
      icon: 'shield-check',
    },
  },

  clearance: {
    enabled: true,
    platform: 'irp',
    authMethod: 'oauth2',
    authEndpoint: 'https://einvoice1.gst.gov.in/eivital/v1.04/auth',
    submitEndpoint: 'https://einvoice1.gst.gov.in/eicore/v1.03/Invoice',
    responseType: 'sync',
    assignsInvoiceNumber: false,
    returnedIdField: 'irn',
    returnedIdFormat: /^[a-f0-9]{64}$/,
    returnsQRCode: true,
    returnsValidationUrl: false,
    buyerAcceptance: 'none',
    requiresMiddleware: true,
    middlewareExamples: ['ClearTax', 'Masters India', 'Tally'],
  },

  numbering: {
    seriesRequired: false,
    seriesRegistration: false,
    hashChaining: false,
    gapAllowed: true,
    resetPeriod: 'yearly',
    platformAssigned: false,
    platformIdField: 'irn',
    platformIdFormat: /^[a-f0-9]{64}$/,
  },

  format: {
    preferred: 'gst-json',
    supported: ['gst-json'],
    syntax: 'GST_JSON',
    version: 'INV-01',
  },

  signature: {
    required: true,
    type: 'platform_sign',  // IRP signs the invoice
  },

  qrCode: {
    required: true,
    contentType: 'verification_url',
    position: 'footer',
  },

  correction: {
    allowDirectModification: false,
    method: 'credit_note',
    requiresOriginalReference: true,
    codes: {
      creditNote: 'CRN',
      debitNote: 'DBN',
      corrective: '',
    },
    requiresPreApproval: false,
    correctionTextKey: 'compliance.in.creditNote.mention',
  },

  archiving: {
    retentionYears: 8,
    formatRequired: 'both',
    searchable: false,
    platformStoresCopy: true,
  },

  requiredFields: {
    invoice: ['number', 'date', 'gstin', 'supplyType'],
    creditNote: ['originalInvoiceReference', 'reason'],
    client: {
      b2b: ['name', 'address', 'gstin', 'stateCode'],
      b2g: ['name', 'address', 'gstin', 'stateCode'],
      b2c: ['name', 'stateCode'],
    },
  },

  customFields: [
    { id: 'supplyType', labelKey: 'field.supplyType', type: 'select', required: true,
      options: ['B2B', 'SEZWP', 'SEZWOP', 'EXPWP', 'EXPWOP', 'DEXP'] },
    { id: 'hsnCode', labelKey: 'field.hsnCode', type: 'string', required: true,
      format: /^[0-9]{6,8}$/ },
    { id: 'stateCode', labelKey: 'field.stateCode', type: 'string', required: true,
      format: /^[0-9]{2}$/ },
  ],

  legalMentions: {
    mandatory: ['compliance.in.mention.gstin'],
    conditional: [
      { condition: 'reverse_charge', textKey: 'compliance.in.mention.reverseCharge' },
      { condition: 'export', textKey: 'compliance.in.mention.export' },
    ],
  },
};
```

---

## 7. Module Integration

### 7.1 ComplianceModule

```typescript
@Module({
  imports: [MailModule, HttpModule],
  controllers: [ComplianceController],
  providers: [
    // Core services
    ComplianceService,
    ConfigRegistry,
    ContextBuilderService,
    RuleResolverService,
    VATEngineService,
    VIESService,
    CorrectionService,
    NumberingService,
    HashChainService,
    QRCodeService,

    // Transmission
    TransmissionService,
    EmailStrategy,
    PeppolStrategy,
    ChorusStrategy,
    SuperPDPStrategy,
    SdIStrategy,
    KSeFStrategy,
    NAVStrategy,
    SPVStrategy,
    MyDataStrategy,
    LeqiStrategy,
    GiBStrategy,
    SEFStrategy,
    IRPStrategy,
    MyInvoisStrategy,
    TVANStrategy,

    // Format generators
    FormatService,
    FacturXGenerator,
    XRechnungGenerator,
    FatturaPAGenerator,
    FacturaeGenerator,
    FA3Generator,
    UBLGenerator,
    PINTGenerator,
    CIIGenerator,
    MyDataGenerator,
    NAVGenerator,
    GSTJSONGenerator,
  ],
  exports: [
    ComplianceService,
    ConfigRegistry,
    VATEngineService,
    TransmissionService,
    FormatService,
    CorrectionService,
    QRCodeService,
  ],
})
export class ComplianceModule {}
```

### 7.2 ComplianceController

```typescript
@Controller('compliance')
export class ComplianceController {
  @Get('config')
  @AllowAnonymous()
  getConfig(
    @Query('supplierCountry') supplierCountry: string,
    @Query('customerCountry') customerCountry?: string,
    @Query('transactionType') transactionType?: 'B2B' | 'B2G' | 'B2C',
  ): FrontendComplianceConfigDto {
    const context = this.contextBuilder.buildContext({ ... });
    const rules = this.ruleResolver.resolveRules(context);
    return this.toFrontendDto(rules);
  }

  @Get('countries')
  @AllowAnonymous()
  getAvailableCountries(): CountrySummaryDto[] {
    return this.configRegistry.getAll().map(c => ({
      code: c.code,
      name: c.name,
      currency: c.currency,
      isEU: c.isEU,
      transmissionModel: c.transmission.b2b.model,
      mandatoryEInvoicing: c.transmission.b2b.mandatory,
    }));
  }

  @Get('validate-vat/:vatNumber')
  async validateVAT(@Param('vatNumber') vatNumber: string): Promise<VATValidationResult> {
    return this.viesService.validate(vatNumber);
  }
}
```

### 7.3 Usage in InvoicesService

```typescript
@Injectable()
export class InvoicesService {
  async createInvoice(dto: CreateInvoiceDto) {
    // 1. Build compliance context
    const context = await this.complianceService.buildContext({
      supplier: { countryCode, vatNumber, identifiers },
      customer: { countryCode, vatNumber, isPublicEntity },
      nature: 'services',
    });

    // 2. Resolve applicable rules
    const rules = this.complianceService.resolveRules(context);

    // 3. Calculate VAT
    const vatResult = this.vatEngine.calculate(items, rules.vat);

    // 4. Generate invoice number (with hash if required)
    const { number, hash } = await this.numberingService.generate(
      company, rules.numbering
    );

    // 5. Create invoice
    const invoice = await this.prisma.invoice.create({ ... });

    // 6. Generate format (Factur-X, UBL, etc.)
    const xml = await this.formatService.generate(invoice, rules.format);

    // 7. Generate QR code if required
    const qrCode = await this.qrCodeService.generate(invoice, rules.qrCode);

    return invoice;
  }

  async sendInvoice(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({ ... });
    const rules = this.complianceService.resolveRules(context);

    // Transmit via appropriate strategy
    const result = await this.transmissionService.send(
      rules.transmission.platform || rules.transmission.model,
      {
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        pdfBuffer: invoice.pdfBuffer,
        xmlContent: invoice.xmlContent,
        format: rules.format.preferred,
        recipient: { ... },
        sender: { ... },
        metadata: { ... },
      }
    );

    // Store platform ID (KSeF ID, IRN, MARK, etc.)
    if (result.externalId) {
      await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: {
          platformId: result.externalId,
          transmittedAt: new Date(),
          qrCodeData: result.qrCodeData,
        },
      });
    }

    return result;
  }
}
```

---

## 8. Extension Points

### 8.1 Adding a New Country

1. Create `configs/countries/{code}.config.ts`
2. Register in `ConfigRegistry`
3. Add any custom fields to the interface if needed
4. No code changes required if using existing transmission strategies

### 8.2 Adding a New Transmission Strategy

1. Create `transmission/strategies/{platform}.strategy.ts`
2. Implement `TransmissionStrategy` interface
3. Register in `ComplianceModule` providers
4. Reference platform name in country config

### 8.3 Adding a New Document Format

1. Create `formats/generators/{format}.generator.ts`
2. Implement `FormatGenerator` interface
3. Register in `ComplianceModule`
4. Add format name to country config's `supported` array

### 8.4 Adding Custom Country Fields

Use the `customFields` array in `CountryConfig`:

```typescript
customFields: [
  {
    id: 'leitwegId',
    labelKey: 'field.leitwegId',
    type: 'string',
    required: 'b2g',  // Only required for B2G
    format: /^\d{2}-\d{4}-\d{6}-\d{2}$/,
    mappedTo: 'cbc:BuyerReference',
  },
],
```

---

## 9. Key Design Decisions

1. **Static TypeScript configs** - Not database-driven. Enables type safety, versioning, and simpler deployment. Can migrate to DB later.

2. **Strategy pattern everywhere** - Transmission, formats, and signatures all use pluggable strategies.

3. **Context-based rule resolution** - All rules derived from transaction context. Makes system testable and predictable.

4. **i18n keys for all text** - Backend stores keys, frontend translates. Supports multi-language invoices.

5. **Fail-safe defaults** - Generic config handles unknown countries. Email always available as fallback.

6. **Separation of concerns** - Each interface handles one aspect (VAT, numbering, transmission, etc.).

7. **Country config is source of truth** - All country-specific logic derived from config, not hardcoded.

---

*Last updated: January 23, 2026*

---

## 10. Implementation Status

The following components have been implemented:

### Core Infrastructure
- ✅ All TypeScript interfaces (13 files)
- ✅ ConfigRegistry service
- ✅ ContextBuilderService
- ✅ RuleResolverService
- ✅ ComplianceModule (NestJS)
- ✅ ComplianceController with REST endpoints
- ✅ Frontend hook `useCompliance`
- ✅ NumberingSequence Prisma model (database persistence)

### Country Configurations
- ✅ France (FR) - PDP + Chorus Pro
- ✅ Germany (DE) - Peppol + XRechnung
- ✅ Belgium (BE) - Peppol
- ✅ Italy (IT) - SdI clearance
- ✅ Spain (ES) - Veri*Factu hash chain
- ✅ Portugal (PT) - ATCUD + SAF-T
- ✅ Generic fallback

### Services
- ✅ VATEngineService (line/total rounding)
- ✅ NumberingService (series, reset periods, database persistence)
- ✅ HashChainService (ES/PT)
- ✅ QRCodeService (PT/ES/CH formats)
- ✅ CorrectionService (credit notes)
- ✅ VIESService (VAT validation with fail-open)
- ✅ XadesSignatureService (XAdES-BES for IT/ES)

### Transmission Strategies
- ✅ EmailStrategy (fallback)
- ✅ ChorusStrategy (FR B2G)
- ✅ SuperPDPStrategy (FR B2B)
- ✅ PeppolStrategy (AS4 with SMP lookup)
- ✅ SdIStrategy (IT with mTLS)
- ✅ SaftStrategy (PT SAF-T export)
- ✅ VerifactuStrategy (ES hash chain)

### Pending
- ❌ Format generators (Factur-X, UBL, FatturaPA, etc.)
- ❌ Additional country configurations (PL, HU, RO, GR, etc.)
- ❌ Additional transmission strategies (KSeF, NAV, SPV, myDATA, etc.)
- ❌ Tests

See [DIFFERENCES.md](./DIFFERENCES.md) for detailed comparison and roadmap.
