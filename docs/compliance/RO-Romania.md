# 🇷🇴 Romania - Invoicing Specifications (RO e-Factura)

**Status:** 🔴 **Mandatory Clearance (B2B / B2G / B2C)**
**Authority:** ANAF (Agenția Națională de Administrare Fiscală)
**Platform:** **SPV** (Spațiul Privat Virtual) / **RO e-Factura**

---

## 1. Context & Roadmap

Romania has implemented a full **Clearance** system to combat VAT fraud. The system is mandatory for **all** invoices issued by companies with a Romanian VAT ID (including non-resident VAT payers).

| Date | Scope | Obligation |
| --- | --- | --- |
| **Active** | **B2G** | Mandatory. |
| **Active** | **B2B** | Mandatory. No paper invoices allowed. |
| **Active** | **B2C** | Mandatory reporting. |
| **Jan 1, 2026** | **Updates** | **5 Working Days** transmission deadline (changed from calendar days). |

---

## 2. Technical Workflow (SPV & OAuth)

Invoicerr must act as an automated client uploading to the SPV platform.

```mermaid
sequenceDiagram
    participant S as Invoicerr
    participant SPV as ANAF SPV
    participant B as Buyer
    
    Note over S: 1. Auth (OAuth 2.0)
    S->>SPV: Authenticate (Digital Cert/Token)
    SPV-->>S: Access Token (JWT)
    
    Note over S: 2. Upload
    S->>S: Generate XML (UBL 2.1 / RO_CIUS)
    S->>SPV: POST XML
    SPV-->>S: 200 OK + Upload Index
    
    Note over S: 3. Validation (Polling)
    loop Every 60s
        S->>SPV: Check Status (Index)
        SPV-->>S: Status (Processing / OK / Error)
    end
    
    alt Status OK
        Note over SPV: 4. Download
        S->>SPV: Download ZIP (XML + ANAF Signature)
        S->>B: Send ZIP (Legal Invoice)
    else Error
        Note over S: 5. Correction
        S->>S: Fix Data & Retry (New Upload)
    end

```

### 🧱 Key Components

1. **RO_CIUS:** The national specification of EN 16931. Strict rules on VAT breakdown and units of measure.
2. **SPV (Virtual Private Space):** The portal. Access requires a **Qualified Digital Certificate** (hardware or cloud) to generate the initial OAuth token.
3. **ANAF Signature:** The final proof of validity. The legal invoice is the **ZIP file** returned by ANAF containing the XML and the official signature.

---

## 3. Data Standards & Requirements

### A. Format: `UBL 2.1` (RO_CIUS)

* **Syntax:** Standard UBL XML.
* **Constraints:**
* **VAT Breakdown:** Must perfectly match ANAF's calculation logic (strict rounding).
* **Units:** Must use UN/ECE codes (e.g., `H87` for piece, `HUR` for hour).
* **Supplier ID:** Must use the Romanian `CUI` (VAT number without RO prefix if non-payer, with RO if payer).



### B. Business Rules

* **B2G Reference:** `BT-13` (Purchase Order Reference) is mandatory for public sector invoices to ensure payment via *ForexeBug* (Treasury system).
* **B2C:** Must report sales to individuals. If `CNP` (Personal ID) is provided, it must be included.

---

## 4. Transmission Deadline

* **New Rule (2026):** Invoices must be transmitted within **5 working days** of issuance.
* **Sanctions:** Fines range from 1,000 to 10,000 RON depending on company size. Non-transmitted invoices are **non-deductible** for the buyer.

---

## 5. Implementation Checklist

* [ ] **OAuth 2.0:** Implement the authentication flow. *Note: The initial setup requires a physical token or e-Token to register the application.*
* [ ] **Polling Engine:** Build a robust background worker to check the status of uploaded invoices (asynchronous processing).
* [ ] **ZIP Storage:** Store the **response ZIP** from ANAF. This is the legal original, not the XML you sent.
* [ ] **Unit Mapping:** Create a mapping table between Invoicerr's internal units and UN/ECE codes (H87, etc.).
* [ ] **ForexeBug Logic:** For B2G invoices, force the user to input the "Engagement/PO Number".

---

## 6. Resources

* **Official Portal:** [ANAF SPV](https://pfinternet.anaf.ro/)
* **Technical Specs:** [RO e-Factura Registry](https://www.google.com/search?q=https://mfinante.gov.ro/ro/web/etax/ro-efactura)
* **Validator:** [DUK Integrator](https://www.google.com/search?q=https://static.anaf.ro/static/10/Anaf/Declaratii_R/Aplicatii_dec/DUKIntegrator.htm)