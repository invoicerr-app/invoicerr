# 🇹🇼 Taiwan - E-Invoicing Specifications (NRA e-Invoice)

**Status:** 🟢 **Mandatory** | Active for all businesses
**Authority:** NRA (National Taxation Bureau)
**Platform:** e-Invoice System

---

## 1. Context & Overview

Taiwan has mandatory e-invoicing through the NRA. All businesses must issue electronic invoices for tax compliance. The system distinguishes between B2B (structured) and B2C (QR code) invoicing.

| Date | Scope | Obligation |
| --- | --- | --- |
| **2015+** | B2C | Progressive mandatory rollout |
| **2020+** | B2B | Extended requirements |
| **Ongoing** | All businesses | Continuous reporting |

---

## 2. Technical Workflow (B2B/B2C Model)

```mermaid
flowchart TD
    S["Invoicerr (Supplier)"] -->|1. Generate Invoice| X[Invoice Document]
    
    alt B2B
    X -->|2. Submit to NRA| NRA[NRA Platform]
    NRA -->|3. Validation| NRA
    NRA -->|4. Return ACK| S
    S -->|5. Deliver e-Invoice| C[Business]
    else B2C
    X -->|2. Generate QR Code| QR[QR Code]
    QR -->|3. Print on Receipt| C[Consumer]
    QR -->|4. Periodic Reporting| NRA
    end
    
    S -->|6. Store Document| DB[Archive]
```

### 🧱 Key Components

1. **Business Registration Number:** Tax ID
2. **NRA Certification:** Required for software
3. **QR Code:** Required for B2C

---

## 3. Data Standards & Formats

### A. Required Format

- **B2B:** XML format
- **B2C:** QR code with plain text
- **Encoding:** UTF-8

### B. Document Types

| Type | Description |
| --- | --- |
| **B2B e-Invoice** | Structured XML |
| **B2C e-Invoice** | QR code receipt |
| **Adjustment Note** | Credit/Debit |

### C. Critical Data Fields

- **Business ID:** Registration number
- **Invoice Number:** Unique identifier
- **VAT Rate:** 5% standard
- **Clearance Number:** NRA reference

---

## 4. Business Model & Compliance

### A. Workflow

1. **Registration:** Obtain NRA certification
2. **B2B:** Submit structured XML to NRA
3. **B2C:** Print QR code on receipts
4. **Reporting:** Periodic submission for B2C
5. **Delivery:** Send to buyer/recipient

### B. Archiving

- **Retention:** 5 years
- **Format:** Original document

---

## 5. Implementation Checklist

- [ ] **NRA Registration:** Obtain certification
- [ ] **B2B Engine:** Build XML generator
- [ ] **B2C QR:** Implement QR code generation
- [ ] **NRA API:** Connect to platform

---

## 6. Resources

- **NRA Portal:** [Ntb.gov.tw](https://www.ntb.gov.tw)
- **e-Invoicing:** [Einvoice.nat.gov.tw](https://einvoice.nat.gov.tw)
