# 🇿🇼 Zimbabwe - Fiscalisation Specifications (Virtual Fiscalisation)

**Status:** 🟢 **Mandatory** | Active since January 2022
**Authority:** ZIMRA (Zimbabwe Revenue Authority)
**Platform:** FDMS (Fiscalisation Data Management System)

---

## 1. Context & Overview

Zimbabwe implemented mandatory fiscalisation through the use of Electronic Tax Registers (ETRs) and the Fiscalisation Data Management System (FDMS). The system requires real-time transmission of transaction data to ZIMRA.

| Date | Scope | Obligation |
| --- | --- | --- |
| **January 1, 2022** | All VAT-registered operators | Mandatory fiscal devices |
| **May 31, 2025** | All businesses | Full FDMS/TaRMS integration |

---

## 2. Technical Requirements

### Platform
- **FDMS (Fiscalisation Data Management System)**
- Electronic Tax Registers (ETRs)
- Fiscal printers
- API/Virtual Fiscalisation (VFD) for medium/large businesses

### Format Requirements
- ZIMRA-specified format
- QR code for validation
- Fiscal memory in devices

### Virtual Fiscalisation Options
1. Direct Interface of Taxpayer Server → ZIMRA Server
2. Direct Interface of Accounting/POS System → ZIMRA Server

---

## 3. Key Requirements

- **TPIN** (Tax Payer Identification Number)
- Certified fiscal device (ETR, fiscal printer, or VFD)
- FDMS API connection
- Buyer details for B2B transactions:
  - Name
  - Address
  - TIN/VAT number
  - Contact information
- QR code validation on each invoice

---

## 4. Implementation Timeline

| Phase | Date | Description |
| --- | --- | --- |
| Phase 1 | January 1, 2022 | Mandatory ETRs for VAT-registered operators |
| Phase 2 | May 31, 2025 | Full FDMS-TaRMS integration |
| Ongoing | Continuous | Real-time transaction reporting |

---

## 5. Business Model

- **Fiscalisation Model:** Real-time transaction reporting to FDMS
- **QR Code Validation:** Each invoice must display a valid QR code
- **Device Certification:** Only approved devices permitted
- **Buyer Data:** Required for B2B transactions

---

## 6. Implementation Checklist

- [ ] Register with ZIMRA FDMS
- [ ] Obtain certified fiscal device or API access
- [ ] Configure VFD/API for real-time transmission
- [ ] Implement buyer data capture for B2B
- [ ] Ensure backup power for device connectivity
- [ ] Test with ZIMRA sandbox
- [ ] Train staff on fiscalisation requirements

---

## 7. Resources

- **ZIMRA:** [Zimra.co.zw](https://www.zimra.co.zw)
- **FDMS Portal:** [Zimra.co.zw/fdms](https://www.zimra.co.zw)
- **Public Notices:** ZIMRA publishes regular compliance notices

---

## Note

Zimbabwe's system is a "fiscalisation" model similar to other African countries, focused on fiscal devices with real-time reporting rather than traditional B2B e-invoicing.
