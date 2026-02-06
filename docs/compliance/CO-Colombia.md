# 🇨🇴 Colombia - E-Invoicing Specifications (DIAN Sistema de Factura Electrónica)

**Status:** 🟢 **Mandatory** | Active for all VAT-registered businesses
**Authority:** DIAN (Dirección de Impuestos y Aduanas Nacionales)
**Platform:** DIAN Electronic Invoice System (SFE)

---

## 1. Context & Overview

Colombia implemented mandatory e-invoicing starting in 2019, expanding to all VAT-registered businesses. The system follows a **Clearance Model** requiring DIAN validation before invoice delivery. Colombia includes comprehensive e-reporting and equivalent documents for all transaction types.

| Date | Scope | Obligation |
| --- | --- | --- |
| **2019** | Progressive | Initial mandatory rollout |
| **Aug 2021** | Large taxpayers | Full mandatory for large corps |
| **2023-2024** | Expansion | All VAT-registered businesses |
| **Ongoing** | B2B/B2C/B2G | All transaction types |
| **Future** | E-reporting | Enhanced data submission |

---

## 2. Technical Workflow (Clearance Model)

Colombia requires DIAN validation before invoice becomes legally valid. The system uses UBL 2.1 format with local extensions.

```mermaid
flowchart TD
    S["Invoicerr (Supplier)"] -->|1. Generate UBL 2.1 XML| X[XML Document]
    X -->|2. Digital Signature| Cert[Digital Certificate]
    Cert -->|3. Signed XML| DIAN[DIAN Platform]
    
    DIAN -->|4. Validation| V[Schema + Business Rules]
    V -->|5. CUFE Generation| CUFE[Unique Code]
    
    DIAN -->|6. Response XML| Res[ACK/NACK + CUFE]
    Res -->|7. Return| S
    
    alt Accepted
    S -->|8. Deliver to Client| C[Client]
    S -->|9. Include QR Code| C
    else Rejected
    S -->|10. Fix and Resubmit| S
    end
    
    C -->|11. Acknowledgment| DIAN
    DIAN -->|3 Working Days| Status[Acceptance Status]
```

### 🧱 Key Components

1. **UBL 2.1:** International standard with Colombian extensions
2. **CUFE (Clave Única de Facturación Electrónica):** Unique 96-character invoice code
3. **Digital Certificate:** DIAN-approved certificates
4. **QR Code:** Mandatory for verification
5. **Technical Provider:** Certified solutions for transmission

---

## 3. Data Standards & Formats

### A. Required Format

- **UBL 2.1:** OASIS standard with Colombian customization
- **Encoding:** UTF-8
- **Digital Signature:** X.509 certificates
- **QR Code:** 2D barcode for verification link

### B. Document Types

| Code | Type | Description |
| --- | --- | --- |
| **01** | Factura de Venta | Sales invoice |
| **02** | Factura de Exportación | Export invoice |
| **03** | Nota Débito | Debit note |
| **04** | Nota Crédito | Credit note |
| **05** | Documento Equivalente | Equivalent document (POS, receipts) |

### C. Critical Data Fields

- **NIT:** Tax ID (9-10 digits)
- **DV:** Verification digit
- **Razón Social:** Company name
- **Dirección:** Address
- **Código Postal:** Postal code
- **CUFE:** 96-character unique code
- **ValorTotal:** Total amount
- **IVA:** VAT amount (19% standard)
- **Descuento:** Discounts

---

## 4. Business Model & Compliance

### A. Clearance Workflow

1. **Registration:** Obtain DIAN registration and certificate
2. **UBL Generation:** Create XML with all required fields
3. **Digital Signing:** Apply electronic signature
4. **Submission:** Send to DIAN via API or provider
5. **Validation:** DIAN validates format and business rules
6. **Response:** Receive CUFE and acceptance status
7. **Delivery:** Send to buyer (XML, PDF, or print with QR)
8. **Acknowledgment:** Buyer has 3 working days

### B. Special Documents

- **Equivalent Documents:** For transactions not requiring invoices
- **Self-Billing:** Buyer-created documents
- **Cross-Border:** Special handling for imports/exports

### C. Verification

- **QR Code:** Links to DIAN verification portal
- **CUFE Lookup:** Validate invoice authenticity online

### D. Archiving Requirements

- **Retention Period:** 5 years minimum
- **Format:** Original XML with CUFE
- **Location:** Colombia (data sovereignty)

---

## 5. Implementation Checklist

- [ ] **DIAN Registration:** Complete RUT registration
- [ ] **Digital Certificate:** Obtain DIAN-approved certificate
- [ ] **UBL 2.1 Engine:** Build XML generator with Colombian extensions
- [ ] **Signature Integration:** Implement digital signing
- [ ] **DIAN API:** Connect to web services
- [ ] **CUFE Generation:** Create unique invoice codes
- [ ] **QR Code:** Generate verification codes
- [ ] **Client Delivery:** Support all formats (XML, PDF, print)
- [ ] **Document Types:** Support invoices, notes, equivalents
- [ ] **Buyer Acknowledgment:** Track 3-day acceptance window
- [ ] **VAT Calculation:** Handle Colombian tax rates

---

## 6. Resources

- **DIAN Portal:** [Dian.gov.co](https://www.dian.gov.co)
- **E-Invoicing Section:** [DIAN Electronic Invoice](https://www.dian.gov.co/fiscalizacioncontrol/factura-electronica/)
- **Technical Specifications:** [UBL Colombia](https://www.dian.gov.co/fiscalizacioncontrol/factura-electronica/Paginas/tecnicos.aspx)
