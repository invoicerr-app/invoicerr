# 🇴🇲 Oman - E-Invoicing Specifications (Tax Authority)

**Status:** 🟢 **Mandatory** | Active for all businesses
**Authority:** Tax Authority
**Platform:** e-Invoice System (VAT)

---

## 1. Context & Overview

Oman has implemented mandatory e-invoicing through the Tax Authority. The system aligns with GCC VAT requirements and focuses on real-time invoice reporting.

| Date | Scope | Obligation |
| --- | --- | --- |
| **2021+** | All businesses | Mandatory e-invoicing |
| **Ongoing** | Continuous | Real-time reporting |

---

## 2. Technical Workflow (Clearance Model)

```mermaid
flowchart TD
    S["Invoicerr (Supplier)"] -->|1. Generate XML/JSON| X[Invoice Document]
    X -->|2. Submit to TA| TA[Tax Authority]
    
    TA -->|3. Validation| V[Schema + Rules]
    V -->|4. Processing| TA
    
    TA -->|5. Return ACK| S
    
    S -->|6. Deliver Invoice| C[Client]
    S -->|7. Store Document| DB[Archive]
```

### 🧱 Key Components

1. **TIN (Tax Identification Number):** Tax ID
2. **Tax Authority Registration:** Required
3. **Invoice Format:** XML/JSON GCC standard

---

## 3. Data Standards & Formats

### A. Required Format

- **XML/JSON Format:** GCC standard
- **Encoding:** UTF-8
- **Digital Signature:** Required

### B. Document Types

| Type | Description |
| --- | --- |
| **Tax Invoice** | Standard VAT invoice |
| **Simplified Invoice** | B2C invoices |
| **Credit/Debit Note** | Adjustments |

### C. Critical Data Fields

- **TIN:** Tax ID
- **VAT Rate:** 5% standard
- **Invoice Number:** Unique identifier
- **Timestamp:** ISO 8601 format

---

## 4. Business Model & Compliance

### A. Workflow

1. **TIN Registration:** Obtain Omani tax ID
2. **TA Registration:** Register on platform
3. **Document Generation:** Create invoice
4. **Submission:** Send to Tax Authority
5. **Delivery:** Send to buyer

### B. Archiving

- **Retention:** 6 years
- **Format:** Original document

---

## 5. Implementation Checklist

- [ ] **TIN Registration:** Obtain Omani tax ID
- [ ] **TA Registration:** Register on platform
- [ ] **API Integration:** Connect to e-Invoice system
- [ ] **Document Types:** Support all types

---

## 6. Resources

- **Tax Authority Portal:** [Tax.gov.om](https://www.tax.gov.om)
