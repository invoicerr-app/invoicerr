---
region: Europe
status: phased
priority: high
formats:
  - EN 16931
  - Factur-X
scope:
  - B2B
  - B2C
  - B2G
progress: testing
---
# 🇫🇷 France - E-Invoicing Specifications (Réforme de la facturation électronique)

**Status:** 🟢 **B2G Active** (Chorus Pro) | 🟡 **B2B/B2C Phased 2026-2027**
**Authority:** DGFiP (Direction Générale des Finances Publiques)
**Platform:** PPF (Portail Public de Facturation — annuaire) + PDP (Plateformes de Dématérialisation Partenaires)

---

## 1. Context & Overview

France is moving its entire B2B economy to mandatory structured e-invoicing plus transaction
e-reporting, under a **Decentralized CTC ("Y" / 5-corner) Model**. B2G has been mandatory since
2017-2020 via **Chorus Pro** (EU Directive 2014/55/EU). The B2B/B2C reform, established by Ordonnance
n° 2021-1190 and rescheduled by the 2024 Finance Act (art. 91), introduces two parallel obligations:
**e-invoicing** (structured invoices for domestic B2B) and **e-reporting** (transaction and payment
data for B2C and cross-border flows). A key design choice (confirmed October 2024) is that the **PPF is
not a free invoicing platform** — it acts as the central **annuaire** (directory) and data concentrator,
while actual invoice exchange flows through **PDP** (state-registered private platforms).

| Date | Scope | Obligation |
| --- | --- | --- |
| **2017-2020** | B2G | Mandatory e-invoicing to the public sector via Chorus Pro (phased by size) |
| **Sep 15, 2021** | Legal basis | Ordonnance 2021-1190 establishes the B2B/B2C reform |
| **Oct 2024** | Architecture pivot | PPF refocused on the *annuaire* + e-reporting; exchange via PDP |
| **Sep 1, 2026** | Reception (all) + Emission (large + ETI) | All must *receive*; large & mid-cap must *issue* + e-report |
| **Sep 1, 2027** | Emission (PME + TPE) | SMEs & micro-enterprises must *issue* + e-report |

> Note: the 2026/2027 dates are those set by the 2024 Finance Act; a decree may adjust by up to a few
> months. Reception capability is required for **everyone** from the first wave (Sep 1, 2026).

---

## 2. Technical Workflow (Decentralized CTC — "Y" / 5-corner Model)

Invoices never go directly to the tax authority. The supplier's PDP routes the invoice to the buyer's
PDP using the **PPF annuaire**, while extracting e-reporting/lifecycle data for the DGFiP.

```mermaid
flowchart TD
    S["Invoicerr (Supplier)"] -->|1. Factur-X / UBL / CII| PDP_S[Supplier PDP]

    subgraph "Routing via PPF"
    PDP_S -->|2. Directory lookup| ANN[PPF Annuaire]
    ANN -->|3. Buyer's PDP + routing code| PDP_S
    end

    PDP_S -->|4. Deliver e-invoice| PDP_B[Buyer PDP]
    PDP_B -->|5. Make available| B[Client]

    subgraph "Data to tax authority"
    PDP_S -.->|6. e-reporting (B2C / cross-border / payment data)| DGFiP[DGFiP]
    PDP_S -.->|7. Lifecycle statuses| DGFiP
    end

    B -->|8. Status: refusée / approuvée| PDP_B
    PDP_B -->|9. Status back| PDP_S
    B -->|10. Status: encaissée (on payment)| PDP_S
```

### 🧱 Key Components

1. **PDP (Plateforme de Dématérialisation Partenaire):** State-registered platform that issues,
   transmits, receives and converts invoices and pushes data to the DGFiP.
2. **PPF (Portail Public de Facturation):** Central **annuaire** (directory) for recipient/PDP
   discovery and the concentrator of e-reporting data. Not a free exchange platform.
3. **OD (Opérateur de Dématérialisation):** Non-registered operator that connects to a PDP.
4. **Annuaire:** Directory keyed by SIREN/SIRET (+ routing code) used to find the recipient's PDP.
5. **Chorus Pro:** Existing B2G platform (still used for public-sector invoices).

---

## 3. Data Standards & Formats

### A. Accepted Formats (socle EN 16931)

- **Factur-X:** Hybrid PDF/A-3 with embedded CII XML (human-readable + machine-readable)
- **UBL 2.1:** EN 16931 syntax
- **UN/CEFACT CII:** EN 16931 syntax
- **Encoding:** UTF-8

### B. Document Types

| Type | Description |
| --- | --- |
| **Facture** | Standard invoice (B2B domestic = e-invoicing) |
| **Avoir** | Credit note |
| **Facture d'acompte** | Deposit / prepayment invoice |
| **Facture rectificative** | Corrective invoice |
| **e-reporting** | Transaction data (B2C, cross-border) + payment data (services) |

### C. Critical Data Fields

- **SIREN / SIRET:** Legal identifier (9 / 14 digits)
- **N° TVA intracommunautaire:** French VAT number (FR + key + SIREN)
- **Code routage:** Routing code for the recipient within the annuaire
- **4 new mandatory mentions (reform):** client SIREN; delivery address (if ≠ billing);
  nature of the operation (goods / services / mixed); option for VAT on debits (if applicable)
- **TVA:** Rates 20% (standard), 10% / 5.5% / 2.1% (reduced); category & reason codes (EN 16931)

---

## 4. Business Model & Compliance

### A. Two Obligations

1. **e-invoicing** — structured invoices for **domestic B2B** (both parties French VAT taxable),
   exchanged PDP → annuaire → PDP.
2. **e-reporting** — **transaction data** (B2C, and B2B with foreign parties where there is no domestic
   e-invoice) and **payment data** (for services, tied to the "encaissée" status), pushed to the DGFiP.

### B. Mandatory Invoice Lifecycle Statuses

The reform mandates exchange of invoice statuses between platforms:

- **Mandatory:** `déposée` (submitted), `rejetée` (rejected by platform), `refusée` (refused by
  recipient), `encaissée` (cashed/paid — services, feeds payment e-reporting)
- **Recommended:** `mise à disposition`, `prise en charge`, `approuvée`, `approuvée partiellement`,
  `en litige`, `suspendue`, `complétée`
- **Free:** operator-defined statuses

### C. VAT Specifics

- **Reverse charge (autoliquidation):** Intra-EU B2B services and certain domestic operations
- **Franchise en base (art. 293 B CGI):** Small-business exemption — mention
  *"TVA non applicable, art. 293 B du CGI"*, VAT rate 0 / category E
- **Monaco:** Within the French VAT territory — follows the French regime

### D. Archiving Requirements

- **Retention Period:** 10 years (commercial documents)
- **Format:** Original structured invoice (Factur-X / UBL / CII)
- **Integrity:** Reliable audit trail (piste d'audit fiable) or qualified e-signature/seal

---

## 5. Implementation Checklist

- [ ] **PDP Selection:** Choose / connect to a registered PDP (or become an OD connected to one)
- [ ] **Annuaire Integration:** Implement directory lookup (SIREN/SIRET + routing code)
- [ ] **Factur-X Engine:** Generate EN 16931 (Factur-X / UBL / CII) — already covered by `@fin.cx/einvoice`
- [ ] **Reception Capability:** Be able to *receive* e-invoices (mandatory for all from Sep 1, 2026)
- [ ] **Lifecycle Statuses:** Emit/consume mandatory statuses (déposée, rejetée, refusée, encaissée)
- [ ] **e-reporting:** Submit transaction data (B2C / cross-border) and payment data (services)
- [ ] **New Mandatory Mentions:** Add client SIREN, delivery address, operation nature, VAT-on-debits
- [ ] **293 B Handling:** Franchise-en-base exemption mention and tax treatment
- [ ] **Archiving:** 10-year retention with reliable audit trail
- [ ] **Chorus Pro:** Keep B2G flows via Chorus Pro

---

## 6. Resources

- **DGFiP / impots.gouv.fr:** [Facture électronique](https://www.impots.gouv.fr/professionnel/facturation-electronique)
- **Réforme overview:** [La facturation électronique (impots.gouv.fr)](https://www.impots.gouv.fr/professionnel/je-passe-la-facturation-electronique)
- **External specifications:** Spécifications externes de la facturation électronique (DGFiP)
- **Chorus Pro (B2G):** [Chorus Pro](https://chorus-pro.gouv.fr)
- **Factur-X / FNFE-MPE:** [fnfe-mpe.org](https://fnfe-mpe.org)
- **Architecture mapping:** see [`COMPLIANCE_ARCHITECTURE.md` §16.0](COMPLIANCE_ARCHITECTURE.md) — France is the home-market reference flow

---

## Note

France combines almost every compliance axis at once (decentralized CTC, certified-platform
transmission, central-directory routing, mandatory bidirectional statuses, simultaneous e-invoicing
**and** e-reporting, hybrid Factur-X, franchise-base scheme). In the Invoicerr architecture it requires
**no new engine code** beyond the generic mechanisms — it is fully expressed as a country profile
(`compliance/profiles/data/fr.ts`) plus a PDP transmission provider.
