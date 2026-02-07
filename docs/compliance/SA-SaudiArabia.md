# 🇸🇦 Saudi Arabia - E-Invoicing Specifications (ZATCA e-Invoicing)

**Status:** 🔴 **Mandatory Clearance** | Active
**Authority:** ZATCA (Zakat, Tax and Customs Authority)
**Platform:** FATOORA (e-Invoicing Platform)

---

## 1. Context & Overview

Saudi Arabia has implemented one of the most advanced e-invoicing systems globally. The phased mandate began in December 2021 with Phase 1 (generation and storage) and Phase 2 (clearance and integration) fully active. The system follows a **Clearance Model** requiring ZATCA validation.

| Date | Scope | Obligation |
| --- | --- | --- |
| **Dec 1, 2021** | Phase 1 | Generation and storage mandatory |
| **Dec 1, 2023** | Phase 2 | Clearance mandatory for B2B |
| **Jan 1, 2025** | B2C Integration | Consumer QR verification |
| **Ongoing** | All businesses | Continuous ZATCA compliance |

---

## 2. Technical Workflow (Clearance Model)

```mermaid
flowchart TD
    S["Invoicerr (Supplier)"] -->|1. Generate XML| X[XML Document]
    X -->|2. Apply QR Code| QR[ZATCA QR Code]
    QR -->|3. Sign Invoice| Cert[Digital Certificate]
    Cert -->|4. Submit to ZATCA| ZATCA[ZATCA Platform]
    
    ZATCA -->|5. Validation| V[Schema + Rules]
    V -->|6. Clearance Check| ZATCA
    
    alt B2B / B2G
    ZATCA -->|7. Return ACK + UUID| S
    S -->|8. Send to Client| C
    else B2C
    ZATCA -->|7b. Store & Report| S
    S -->|8b. Print QR for Customer| C
    end
    
    subgraph "Integration"
    S -.->|XML/API| ERP[ERP Systems]
    end
```

### 🧱 Key Components

1. **UUID:** Unique identifier for each invoice
2. **QR Code:** ZATCA-compliant with specific data fields
3. **Digital Certificate:** ZATCA-approved for signing
4. **Invoice Type:** Simplified (B2C) or Standard (B2B)
5. **Clearance:** Real-time validation for B2B/B2G

---

## 3. Data Standards & Formats

### A. Required Format

- **XML Format:** UBL 2.1 with ZATCA extensions
- **Encoding:** UTF-8
- **Digital Signature:** X.509 certificate
- **QR Code:** PNG format with specific fields

### B. Document Types

| Type | Code | Description |
| --- | --- | --- |
| **Standard** | 0100000 | B2B/B2G invoices |
| **Simplified** | 0200000 | B2C consumer invoices |

### C. Critical Data Fields

- **TIN:** Tax ID (15 digits)
- **VAT Rate:** 15% standard
- **UUID:** 128-bit unique ID
- **QR Fields:** Seller name, TIN, VAT total, timestamp, hash
- **Invoice Date/Time:** ISO 8601 format

---

## 4. Business Model & Compliance

### A. Workflow

1. **Registration:** Obtain ZATCA certificate
2. **XML Generation:** Create UBL 2.1 document
3. **QR Code:** Generate compliant QR
4. **Signing:** Apply digital certificate
5. **Submission:** Send to ZATCA (B2B/B2G)
6. **Delivery:** Send to buyer with clearance

### B. QR Code Requirements

- **Dimensions:** Minimum 2cm x 2cm
- **Data:** Encoded in Base64
- **Fields:** 12 mandatory elements
- **Scannable:** Must work with ZATCA app

### C. Archiving

- **Retention:** 6 years
- **Format:** Original XML
- **Location:** Saudi Arabia

---

## 5. Implementation Checklist

- [ ] **ZATCA Certificate:** Obtain digital certificate
- [ ] **UBL 2.1 Engine:** Build XML generator
- [ ] **QR Code Generator:** Implement ZATCA QR format
- [ ] **Signature Integration:** Implement digital signing
- [ ] **ZATCA API:** Connect to clearance platform
- [ ] **Document Types:** Support Standard and Simplified
- [ ] **B2B Clearance:** Implement real-time validation
- [ ] **B2C Reporting:** Handle consumer invoice rules

---

## 6. Resources

- **ZATCA Portal:** [Zatca.gov.sa](https://zatca.gov.sa)
- **E-Invoicing Portal:** [Fatoora.zatca.gov.sa](https://fatoora.zatca.gov.sa)
- **Technical Guides:** [ZATCA Documentation](https://zatca.gov.sa/en/help/Pages/default.aspx)
