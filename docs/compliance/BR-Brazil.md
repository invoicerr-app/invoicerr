# 🇧🇷 Brazil - E-Invoicing Specifications (NF-e / NFS-e / NFCom / CT-e)

**Status:** 🟢 **Mandatory** | Multi-document system active
**Authority:** SEFAZ (Secretaria da Fazenda) + CONFAZ
**Platform:** National Electronic Invoice System (Sistema Nacional de NF-e)

---

## 1. Context & Overview

Brazil operates one of the world's most complex e-invoicing ecosystems with multiple document types. The system follows a **Clearance Model** requiring SEFAZ validation before invoice authorization. With over 1,280 municipalities participating in the National NFS-e System, Brazil mandates nationwide unified e-invoicing by January 1, 2026.

| Date | Scope | Obligation |
| --- | --- | --- |
| **2008** | NF-e Launch | Goods invoice clearance begins |
| **2014** | NFC-e Rollout | Retail consumer invoices |
| **2020+** | NFS-e Migration | Service invoice centralization |
| **Nov 1, 2025** | NFCom Mandatory | Telecommunications invoices |
| **Jan 1, 2026** | NFS-e Nationwide | All municipalities unified |
| **Ongoing** | CT-e | Freight transport documents |

---

## 2. Technical Workflow (Clearance Model)

Brazil requires real-time validation through SEFAZ. The process differs by document type but follows a common pattern of signature, submission, validation, and authorization.

```mermaid
flowchart TD
    S["Invoicerr (Supplier)"] -->|1. Generate XML| P[Prepare Document]
    P -->|2. Sign XML| Cert[Digital Certificate (A1/A3)]
    Cert -->|3. Signed XML| WS[SEFAZ Web Services]
    
    subgraph "SEFAZ Processing"
    WS -->|4. Validation| V[Schema + Business Rules]
    V -->|5. Check Status| Q[Quota/Limit Check]
    end
    
    WS -->|6. Authorization| Auth[Return Result]
    Auth -->|7. Signed XML + Protocol| S
    
    S -->|8. Deliver Document| C[Client]
    S -->|9. Store XML| DB[Archive 11 Years]
    
    subgraph "Document Types"
    Auth -.->|NF-e| NF[Nota Fiscal Eletrônica]
    Auth -.->|NFC-e| NFC[Nota Fiscal de Consumidor]
    Auth -.->|NFS-e| NFS[Nota Fiscal de Serviços]
    Auth -.->|NFCom| Com[Nota Fiscal de Comunicação]
    Auth -.->|CT-e| CT[Conhecimento de Transporte]
    end
```

### 🧱 Key Components

1. **NF-e (Nota Fiscal Eletrônica):** Electronic invoice for goods sales between businesses/states
2. **NFC-e (Nota Fiscal de Consumidor Eletrônica):** Consumer-facing retail invoices
3. **NFS-e (Nota Fiscal de Serviço Eletrônica):** Service invoices (municipal)
4. **NFCom:** Telecommunications and communication services
5. **CT-e (Conhecimento de Transporte Eletrônico):** Electronic freight documents
6. **Digital Certificate:** ICP-Brasil A1 or A3 certificates required
7. **Authorization Protocol:** Unique code returned by SEFAZ

---

## 3. Data Standards & Formats

### A. XML Schema

- **Standard:** ANATEL/NF-e schemas (XSD)
- **Namespace:** Varies by document type (urn:http://www.portalfiscal.inf.br/nfe)
- **Encoding:** UTF-8
- **Signature:** XMLDSig with ICP-Brasil certificates

### B. Document Types & Usage

| Document | Code | Purpose | Authority |
| --- | --- | --- | --- |
| **NF-e** | 55 | Interstate goods | Federal SEFAZ |
| **NFC-e** | 65 | Retail/B2C consumer | State SEFAZ |
| **NFS-e** | -- | Services | Municipal |
| **NFCom** | 66 | Telecom | Federal SEFAZ |
| **CT-e** | 57 | Freight transport | Federal SEFAZ |
| **MDF-e** | 58 | Manifest of goods | Federal SEFAZ |

### C. Critical Data Fields

- **IE:** State tax registration (Inscrição Estadual)
- **CNPJ/CPF:** Company/Personal tax ID (14/11 digits)
- **NCM:** Mercosur common nomenclature (8 digits)
- **CST/NCM:** Tax status codes
- **vBC/vICMS:** Base value and VAT amount
- **pIPI/pICMS:** Tax rates
- **chNFe:** 44-character access key (CNPJ + date + model + series + number + emission type + code)
- **cUF:** IBGE state code

---

## 4. Business Model & Compliance

### A. Clearance Workflow

1. **Certificate Setup:** Install ICP-Brasil digital certificate
2. **XML Generation:** Create document according to schema
3. **Digital Signing:** Sign with private key
4. **Web Service Submission:** Send to SEFAZ endpoint
5. **Validation:** SEFAZ checks schema, business rules, quotas
6. **Authorization:** Return signed XML with protocol
7. **Delivery:** Send XML/DANFE to client
8. **Archival:** Store for minimum 11 years (updated May 2025)

### B. Contingency Mode (Contingência)

- **EPEC:** Emergency mode for NF-e when SEFAZ unavailable
- **FS-DA:** Contingency for NFC-e
- **SCAN:** Federal backup system
- **SVC-AN/SVC-RS:** Alternative validation centers

### C. State-Specific Variations

- **State Codes:** 11-52 (IBGE codes)
- **PISCOFINS:** Federal contributions
- **ICMS:** State VAT (rates vary 7-18%)
- **ISS:** Municipal service tax
- **Municipal NFS-e:** Each city may have different requirements

### D. Archiving Requirements

- **Retention Period:** 11 years minimum (132 months) from May 2025
- **Format:** Original signed XML
- **Location:** Brazil (data sovereignty)

---

## 5. Implementation Checklist

- [ ] **ICP-Brasil Certificate:** Obtain A1/A3 certificate from authorized CA
- [ ] **SEFAZ Registration:** Register with federal and state authorities
- [ ] **XML Engine:** Build schema-compliant XML generator
- [ ] **Signing Implementation:** Integrate XMLDSig with certificates
- [ ] **Web Services:** Connect to multiple SEFAZ endpoints
- [ ] **DANFE Generation:** Create printable NF-e format
- [ ] **Multi-Document Support:** Implement NF-e, NFC-e, NFS-e, CT-e
- [ ] **Contingency Handling:** Build EPEC/SCAN fallback systems
- [ ] **Status Monitoring:** Track authorization protocols
- [ ] **cXML Generation:** Handle cancellation and correction letters
- [ ] **Event Tracking:** Support distribution notifications
- [ ] **Municipal Integration:** Connect to city NFS-e systems

---

## 6. Resources

- **National Portal:** [Portal NF-e](https://www.nfe.fazenda.gov.br)
- **CONFAZ:** [Confaz.fazenda.gov.br](http://www.confaz.fazenda.gov.br)
- **Schema Repository:** [Repository with XSD files](https://www.nfe.fazenda.gov.br/portal/listaSchemas.aspx)
- **Development Tools:** [NF-e Utilities](https://www.nfe.fazenda.gov.br/portal/listaUtilidadesNF-e.aspx)
- **NFCom Info:** [NFCom Specifications](https://www.fazenda.gov.br/notas-fiscais-de-servicos-de-comunicacao)
