# 🇳🇮 Nicaragua - E-Invoicing Specifications (Factura Electrónica)

**Status:** 🟢 **Mandatory** | Active for all businesses
**Authority:** DGI (Dirección General de Impuestos)
**Platform:** DGI Electronic Invoice System

---

## 1. Context & Overview

Nicaragua has mandatory e-invoicing through DGI. The system follows a **Clearance Model** requiring pre-authorization. Progressive rollout began in 2019.

| Date | Scope | Obligation |
| --- | --- | --- |
| **2019+** | Progressive | Initial rollout by sector |
| **Ongoing** | All businesses | Continuous DGI authorization |
| **Current** | Full mandatory | All transaction types |

---

## 2. Technical Workflow (Clearance)

```mermaid
flowchart TD
    S["Invoicerr (Supplier)"] -->|1. Generate XML| X[XML Document]
    X -->|2. Digital Signature| Cert[Digital Certificate]
    Cert -->|3. Submit to DGI| DGI[DGI Platform]
    
    DGI -->|4. Validation| V[Schema + Rules]
    V -->|5. Authorization| DGI
    
    DGI -->|6. Return ACK| S
    
    S -->|7. Deliver Invoice| C[Client]
    S -->|8. Store XML| DB[Archive]
```

### 🧱 Key Components

1. **RUC (Registro Único de Contribuyente):** Tax ID
2. **Digital Certificate:** DGI-approved

---

## 3. Data Standards & Formats

### A. Required Format

- **XML Format:** DGI national schema
- **Encoding:** UTF-8
- **Digital Signature:** Required

### B. Document Types

| Code | Type | Description |
| --- | --- | --- |
| **01** | Factura | Invoice |
| **03** | Nota Débito | Debit note |
| **04** | Nota Crédito | Credit note |

### C. Critical Data Fields

- **RUC:** Tax ID (14 digits)
- **IVA:** VAT (15%)
- **Número Autorización:** Authorization number

---

## 4. Business Model & Compliance

### A. Workflow

1. **RUC Registration:** Obtain Nicaraguan tax ID
2. **Certificate:** Acquire DGI digital certificate
3. **XML Generation:** Create schema-compliant document
4. **Signing:** Apply electronic signature
5. **Submission:** Send to DGI
6. **Delivery:** Send to buyer

### B. Archiving

- **Retention:** 5 years
- **Format:** Original XML

---

## 5. Implementation Checklist

- [ ] **RUC Registration:** Obtain Nicaraguan tax ID
- [ ] **Digital Certificate:** Acquire DGI certificate
- [ ] **XML Engine:** Build DGI schema generator
- [ ] **Signature Integration:** Implement signing
- [ ] **DGI API:** Connect to web services

---

## 6. Resources

- **DGI Portal:** [Dgi.gob.ni](https://www.dgi.gob.ni)
