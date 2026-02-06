# 🇧🇬 Bulgaria - E-Invoicing Specifications

**Status:** 🟢 **B2G Active** | 🟡 **B2B Voluntary** | 🟡 **SAF-T 2026+**
**Authority:** National Revenue Agency (NRA)
**Platform:** NIS (National Information System) + eCommerce Platform

---


## 1. Context & Overview

Bulgaria has implemented mandatory e-invoicing for B2G transactions and is preparing for SAF-T reporting. The B2B e-invoicing mandate is not yet in force, but the country is aligning with EU ViDA requirements.

| Date | Scope | Obligation |
| --- | --- | --- |
| **2016** | B2G | Mandatory e-invoicing for public procurement via NIS |
| **2024** | All businesses | SAF-T reporting requirements announced |
| **Jan 1, 2026** | Large enterprises | SAF-T reporting mandatory (first wave) |
| **2030** | All businesses | Full SAF-T scope implementation |

---


## 2. Technical Workflow

```mermaid
flowchart TD
    S["Invoicerr (Supplier)"] -->|1. EN 16931 XML| NIS[National Information System]
    
    subgraph "B2G Flow"
    NIS -->|"2. Validation & Routing"| B2G_Rec[Government Entity]
    NIS -->|"3. Archiving"| NRA_Arch[NRA Archive]
    end
    
    subgraph "B2B Flow [Voluntary]"
    S -->|1a. Direct Delivery| B2B_Rec[Business Client]
    S -->|1b. Optional Reporting"| NRA_Rep[NRA Reporting]
    end
    
    B2G_Rec -->|4. Acknowledgment| NIS
    NRA_Arch -.->|Audit Access| NRA[National Revenue Agency]
```


### 🧱 Key Components

1. **NIS (National Information System):** Centralized platform for B2G e-invoicing
2. **eCommerce Platform:** Web portal for invoice submission
3. **SAF-T System:** Upcoming structured accounting file reporting


---


## 3. Data Standards & Formats

### A. Accepted Formats

* **EN 16931** compliant XML (mandatory for B2G)
* **UBL 2.1** syntax (accepted)
* **National XML schema** (NIS format)

### B. Critical Data Fields

* **Bulstat ID:** Business identification number
* **VAT Number:** Bulgarian VAT registration
* **Invoice Number:** Unique numbering scheme
* **Tax Point Date:** Date of supply


---


## 4. Business Model

* **B2G Clearance:** Invoices validated through NIS
* **B2B Post-Audit:** Voluntary compliance, no clearance required
* **SAF-T Reporting:** Periodic structured data submission


---


## 5. Implementation Checklist

* [ ] **NIS Registration:** Register for B2G e-invoicing access
* [ ] **EN 16931 Compliance:** Ensure XML format meets EU standard
* [ ] **Peppol Connectivity:** Set up Peppol access point for cross-border
* [ ] **SAF-T Preparation:** Prepare for 2026 reporting requirements
* [ ] **Archive Configuration:** Set up 10-year invoice archiving


---


## 6. Resources

* **National Revenue Agency:** [Nra.bg](https://www.nra.bg)
* **NIS Portal:** [Invoice.bgreceipts.bg](https://invoice.bgreceipts.bg)
* **EU ViDA Overview:** [ec.europa.eu](https://ec.europa.eu)
