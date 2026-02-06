# 🇧🇴 Bolivia - E-Invoicing Specifications (SIN Sistema de Factura Electrónica)

**Status:** 🟢 **Mandatory** | Active for all businesses
**Authority:** SIN (Servicio de Impuestos Nacionales)
**Platform:** SIN Electronic Invoice System

---

## 1. Context & Overview

Bolivia has implemented mandatory e-invoicing through the SIN (Servicio de Impuestos Nacionales). The system follows a **Clearance Model** requiring CUFD (Código Único de Facturación Electrónica) authorization for each invoice. Bolivia uses an offline-first approach with periodic synchronization.

| Date | Scope | Obligation |
| --- | --- | --- |
| **2015+** | Progressive | Initial rollout by sector |
| **Ongoing** | All businesses | Continuous SIN authorization |
| **Current** | Offline mode | Contingency with sync |

---

## 2. Technical Workflow (CUFD Authorization)

Bolivia uses a CUFD-based authorization system with offline capability for areas with limited connectivity.

```mermaid
flowchart TD
    S["Invoicerr (Supplier)"] -->|1. Request CUFD| SIN[SIN Platform]
    SIN -->|2. CUFD Authorization| CUFD[Unique Code]
    CUFD -->|3. Store CUFD| S
    
    S -->|4. Generate Invoice XML| X[XML Document]
    X -->|5. Sign with CUFD| S
    
    S -->|6. Include CUFD in XML| X2[Invoice + CUFD]
    X2 -->|7. Contingency Mode| Offline[Offline Storage]
    
    alt Online Available
    X2 -->|8. Submit to SIN| SIN
    SIN -->|9. Validate & Register| SIN
    SIN -->|10. Return ACK| S
    else Offline
    X2 -->|8a. Store Locally| DB[Local Database]
    DB -->|9a. Sync Later| SIN
    end
    
    S -->|11. Deliver Invoice| C[Client]
```

### 🧱 Key Components

1. **CUFD (Código Único de Facturación Electrónica):** Unique authorization code
2. **NIT (Número de Identificación Tributaria):** Bolivian tax ID
3. **Digital Certificate:** SIN-approved certificates
4. **Offline Mode:** Contingency when connectivity unavailable
5. **CUF (Código Único de Facturación):** Invoice-level unique code

---

## 3. Data Standards & Formats

### A. Required Format

- **XML Format:** SIN national schema
- **Encoding:** UTF-8
- **Digital Signature:** Required for all documents
- **QR Code:** For verification

### B. Document Types

| Code | Type | Description |
| --- | --- | --- |
| **1** | Factura | Standard invoice |
| **2** | Factura Cruce | Cross invoice |
| **3** | Nota Débito | Debit note |
| **4** | Nota Crédito | Credit note |
| **5** | Nota de Remisión | Dispatch note |
| **6** | Guía de Remisión | Transport guide |

### C. Critical Data Fields

- **NITEmisor:** Seller tax ID
- **NITReceptor:** Buyer tax ID
- **NúmeroFactura:** Invoice number
- **CUF:** Unique invoice code
- **CUFD:** Authorization code
- **MontoTotal:** Total amount
- **IVA:** VAT amount (13%)

---

## 4. Business Model & Compliance

### A. Authorization Workflow

1. **NIT Registration:** Obtain Bolivian tax ID
2. **Certificate:** Acquire SIN digital certificate
3. **CUFD Request:** Get authorization code from SIN
4. **Invoice Generation:** Create XML with CUF calculation
5. **Signing:** Apply digital signature
6. **Submission:** Send to SIN (online or offline)
7. **Delivery:** Send to client

### B. Offline Mode

- **CUF Calculation:** Mathematical algorithm for uniqueness
- **Local Storage:** Contingency database
- **Periodic Sync:** Upload when connection restored
- **Validation:** Server-side verification after sync

### C. Archiving Requirements

- **Retention Period:** 5 years minimum
- **Format:** Original XML
- **Location:** Bolivia

---

## 5. Implementation Checklist

- [ ] **NIT Registration:** Obtain Bolivian tax ID
- [ ] **Digital Certificate:** Acquire SIN certificate
- [ ] **CUFD System:** Implement authorization code logic
- [ ] **CUF Algorithm:** Calculate unique invoice codes
- [ ] **XML Engine:** Build SIN schema generator
- [ ] **Signature Integration:** Implement digital signing
- [ ] **Offline Storage:** Build contingency database
- [ ] **Sync Logic:** Handle periodic synchronization
- [ ] **Document Types:** Support all Bolivian types
- [ ] **IVA Calculation:** Handle 13% VAT

---

## 6. Resources

- **SIN Portal:** [Impuestos.gob.bo](https://www.impuestos.gob.bo)
- **E-Invoicing Section:** [Factura Electrónica](https://www.impuestos.gob.bo/factura-electronica/)
