# 🇨🇾 Cyprus - E-Invoicing Specifications

**Status:** 🟢 **B2G Active** | 🔴 **B2B Planned** | 🟡 **ViDA 2030**
**Authority:** Tax Department
**Platform:** Central Gateway / Peppol

---


## 1. Context & Overview

Cyprus has transposed EU Directive 2014/55/EU for B2G e-invoicing. B2B e-invoicing remains voluntary but the country is preparing for ViDA 2030 requirements.

| Date | Scope | Obligation |
| --- | --- | --- |
| **Apr 2019** | B2G Central | Public bodies must receive EN 16931 e-invoices |
| **Apr 2020** | B2G All | All public entities must receive e-invoices |
| **2025** | Platform | Centralized e-invoicing platform expected |
| **2030** | B2B ViDA | Mandatory e-invoicing under EU ViDA directive |

---


## 2. Technical Workflow

```mermaid
flowchart TD
    S["Invoicerr (Supplier)"] -->|1. Peppol BIS 3.0| GW[Cyprus Government Gateway]
    
    subgraph "B2G Flow"
    GW -->|"2. Validation"| PE[Public Entity]
    GW -->|"3. Archiving"| TD_Arch[Tax Department Archive]
    end
    
    subgraph "B2B Flow [ViDA Future]"
    S -->|1a. Direct/ Peppol| B2B_Rec[Business Client]
    S -->|1b. Future: CTC Reporting"| TD_Rep[Tax Authority]
    end
    
    PE -->|4. Status Update| GW
    TD_Arch -.->|Future: Real-time| TD[Tax Department]
```


### 🧱 Key Components

1. **Government Gateway:** Central platform for B2G invoice processing
2. **Peppol Network:** Interoperability framework
3. **Future CTC Platform:** Under development for ViDA compliance


---


## 3. Data Standards & Formats

### A. Accepted Formats

* **EN 16931** compliant XML (mandatory for B2G)
* **Peppol BIS Billing 3.0** (recommended)
* **UBL 2.1** syntax (accepted)

### B. Critical Data Fields

* **VAT Number:** Cyprus VAT registration
* **Tax ID:** TIN for businesses
* **Invoice Reference:** Unique identifier


---


## 4. Business Model

* **B2G Post-Audit:** No real-time clearance, invoice delivery via Peppol
* **B2B Post-Audit:** Voluntary, will transition to CTC under ViDA


---


## 5. Implementation Checklist

* [ ] **Peppol Access:** Obtain Peppol participant identifier
* [ ] **B2G Registration:** Register with Government Gateway
* [ ] **EN 16931 Compliance:** Ensure XML format meets EU standard
* [ ] **ViDA Preparation:** Plan for 2030 B2B mandate
* [ ] **Archive Setup:** Configure 6-year invoice storage


---


## 6. Resources

* **Tax Department:** [Mof.gov.cy](https://www.mof.gov.cy)
* **Peppol Cyprus:** [Peppol network access](https://peppol.eu)
* **EU ViDA:** [ec.europa.eu/vida](https://ec.europa.eu)
