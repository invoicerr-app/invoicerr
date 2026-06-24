# 🇲🇽 Mexico - E-Invoicing Specifications (CFDI 4.0)

**Status:** 🟢 **Mandatory** | Active for all taxpayers
**Authority:** SAT (Servicio de Administración Tributaria)
**Platform:** SAT Electronic Invoice System (Factura Electrónica)

---

## 1. Context & Overview

Mexico is a Latin American pioneer in e-invoicing, introducing electronic invoicing in 2004 and making it mandatory for all taxpayers since January 1, 2014. The system follows a **Clearance Model** requiring validation through Authorized Certification Providers (PAC). CFDI 4.0 became mandatory on April 1, 2023.

| Date | Scope | Obligation |
| --- | --- | --- |
| **2004** | CFD | Initial electronic invoicing |
| **2011** | CFDI | Internet-based system |
| **Jan 1, 2014** | All taxpayers | Mandatory e-invoicing |
| **2017** | CFDI 3.3 | Major format update |
| **Jan 1, 2022** | CFDI 4.0 | New version introduction |
| **Apr 1, 2023** | All taxpayers | CFDI 4.0 mandatory |
| **Ongoing** | Complementos | Additional document types |

---

## 2. Technical Workflow (PAC Clearance Model)

Mexico uses a three-tier system: issuer → PAC → SAT. The PAC validates and forwards invoices to SAT.

```mermaid
flowchart TD
    S["Invoicerr (Supplier)"] -->|1. Generate CFDI 4.0 XML| X[XML Document]
    X -->|2. Sign with CSD| Cert[Finkit Certificate (CSD)]
    Cert -->|3. Signed XML| PAC[PAC Provider]
    
    PAC -->|4. Validate Format| V[Schema + Rules]
    V -->|5. Sign & Timestamp| PAC
    
    PAC -->|6. Submit to SAT| SAT[SAT Platform]
    SAT -->|7. Verify & Register| SAT
    
    SAT -->|8. Return XML + UUID| PAC
    PAC -->|9. Return to Issuer| S
    
    S -->|10. Deliver PDF+XML| C[Client]
    S -->|11. 3-day Delivery Window| C
    
    subgraph "Complements"
    S -.->|Pagos| CompP[CFDI Pago]
    S -.->|Nomina| CompN[CFDI Nómina]
    S -.->|IEPS| CompI[CFDI IEPS]
    end
```

### 🧱 Key Components

1. **CSD (Certificado de Sello Digital):** Digital seal certificate from SAT
2. **PAC (Proveedor Autorizado de Certificación):** Certified provider for validation
3. **UUID (UUID/Folio Fiscal):** 36-character unique identifier
4. **CFDI 4.0:** Current mandatory format
5. **Complements:** Additional documents (payments, payroll, IEPS)

---

## 3. Data Standards & Formats

### A. Required Format

- **CFDI 4.0 XML:** SAT schema
- **Encoding:** UTF-8
- **Digital Signature:** CSD (RSA 2048+)
- **PDF Delivery:** Mandatory for buyers

### B. Document Types

| Code | Type | Description |
| --- | --- | --- |
| **I** | Factura | Income/Invoice |
| **E** | Factura de Egreso | Refund/ Credit Note |
| **P** | Pago | Payment receipt |
| **N** | Nómina | Payroll |
| **T** | Traslado | Transfer/Waybill |

### C. Critical Data Fields

- **RFC:** Tax ID (12-13 characters: 4 letters + 6 digits + 3 alphanumerics)
- **Nombre:** Legal name
- **DomicilioFiscal:** Fiscal address with postal code
- **RegimenFiscal:** Tax regime code
- **UsoCFDI:** Purpose code (G01, G03, P01, etc.)
- **FormaPago:** Payment method code
- **MétodoPago:** Payment method (PPD, PUE)
- **Moneda:** Currency (MXN, USD, etc.)
- **TipoCambio:** Exchange rate
- **Impuesto:** Tax (002 = IVA, 003 = IEPS)
- **TasaOCuota:** Tax rate
- **Importe:** Line amount

---

## 4. Business Model & Compliance

### A. PAC Workflow

1. **CSD Registration:** Obtain digital seal from SAT
2. **PAC Contract:** Sign with authorized provider
3. **CFDI Generation:** Create XML with all required fields
4. **Digital Signing:** Apply CSD signature
5. **PAC Submission:** Send for validation
6. **PAC Processing:** Provider signs, timestamps, forwards to SAT
7. **SAT Registration:** Authority validates and registers
8. **UUID Return:** Receive folio fiscal
9. **Delivery:** Send XML+PDF to buyer within 3 days

### B. Tax Regimes

| Code | Regime |
| --- | --- |
| **601** | General |
| **605** | Incorporated (RESICO) |
| **612** | Small businesses |
| **620** | Agricultural |

### C. Complementos (Addendas)

- **CFDI de Pago:** Payment receipt complement
- **CFDI de Nómina:** Payroll complement (mandatory)
- **IEDU:** Educational institution details
- **Vendedor:** Sales representative details
- **Terceros:** Third-party information

### D. Archiving Requirements

- **Retention Period:** 5 years minimum
- **Format:** Original XML with UUID
- **Location:** Mexico (data sovereignty)

---

## 5. Implementation Checklist

- [ ] **RFC Registration:** Obtain Mexican tax ID
- [ ] **CSD Certificate:** Acquire digital seal from SAT
- [ ] **PAC Contract:** Sign with certified provider
- [ ] **CFDI 4.0 Engine:** Build schema-compliant generator
- [ ] **Signature Integration:** Implement CSD signing
- [ ] **PAC API:** Integrate with provider
- [ ] **Complement Support:** Implement Nómina, Pago, others
- [ ] **PDF Generation:** Create printable CFDI format
- [ ] **Client Delivery:** Send XML+PDF within 3 days
- [ ] **UUID Tracking:** Monitor folio assignment
- [ ] **Cancellation Logic:** Handle CFDI cancellations
- [ ] **Addendas:** Support customer-specific addendas

---

## 6. Resources

- **SAT Portal:** [Sat.gob.mx](https://www.sat.gob.mx)
- **CFDI Documentation:** [CFDI 4.0 Specifications](https://www.sat.gob.mx/consultas/portalesat/factura-electronica)
- **PAC Directory:** [Authorized Providers](https://www.sat.gob.mx/consultas/portalesat/proveedores-certificacion)
- **Schema Repository:** [CFDI XSD Files](https://www.sat.gob.mx/archivos/recurso_cfdi_xsd.zip)
