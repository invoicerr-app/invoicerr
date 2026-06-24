# 🌍 Global Invoicerr Compliance Index

> **⚠️ Disclaimer: AI-Assisted Documentation**
> This compliance documentation is partially generated using Artificial Intelligence to rapidly cover the technical specifications of multiple jurisdictions. While we strive for accuracy, regulations change frequently.
>
> If you notice an error, an outdated spec, or a missing country, **please open a GitHub Issue** to report it. Your contributions are welcome!

This directory centralizes the technical specifications, workflows, and implementation status for international invoicing mandates within `invoicerr`.

**Goal:** Ensure valid outbound invoice generation (Sales/AR) for every supported jurisdiction.

### 🏷️ Status Legend
- 🔴 **Todo** (Backlog / Not Started)
- 🟡 **In Progress** (Spec written, Dev underway)
- 🟢 **Ready** (Implemented, Tested & Merged)

---

## 🇪🇺 Europe (EMEA)

| Country | Code | Status | Model Type | Technical Spec |
| :--- | :---: | :---: | :--- | :--- |
| **Austria** | `AT` | 🔴 Todo | Post-Audit / B2G XML | [View Specs](./AT-Austria.md) |
| **Belgium** | `BE` | 🔴 Todo | **Peppol** (B2B Mandatory 2026) | [View Specs](./BE-Belgium.md) |
| **France** | `FR` | 🔴 Todo | **Hybrid** (Factur-X) / PDP | [View Specs](./FR-France.md) |
| **Germany** | `DE` | 🔴 Todo | **Hybrid** (ZUGFeRD / XRechnung) | [View Specs](./DE-Germany.md) |
| **Greece** | `GR` | 🔴 Todo | **Reporting** (myDATA) | [View Specs](./GR-Greece.md) |
| **Hungary** | `HU` | 🔴 Todo | **Reporting** (RTIR / Online Számla) | [View Specs](./HU-Hungary.md) |
| **Italy** | `IT` | 🔴 Todo | **Clearance** (SdI) | [View Specs](./IT-Italy.md) |
| **Netherlands**| `NL` | 🔴 Todo | Post-Audit / Peppol | [View Specs](./NL-Netherlands.md) |
| **Norway** | `NO` | 🔴 Todo | **Peppol** (EHF) | [View Specs](./NO-Norway.md) |
| **Poland** | `PL` | 🔴 Todo | **Clearance** (KSeF) | [View Specs](./PL-Poland.md) |
| **Portugal** | `PT` | 🔴 Todo | **Reporting** (ATCUD + QR) | [View Specs](./PT-Portugal.md) |
| **Romania** | `RO` | 🔴 Todo | **Clearance** (RO e-Factura) | [View Specs](./RO-Romania.md) |
| **Serbia** | `RS` | 🔴 Todo | **Clearance** (SEF) | [View Specs](./RS-Serbia.md) |
| **Spain** | `ES` | 🔴 Todo | **Integrity** (Veri*Factu / TicketBAI) | [View Specs](./ES-Spain.md) |
| **Sweden** | `SE` | 🔴 Todo | **Peppol** | [View Specs](./SE-Sweden.md) |
| **Switzerland**| `CH` | 🔴 Todo | **QR-Bill** (Specific visual standard) | [View Specs](./CH-Switzerland.md) |
| **Turkey** | `TR` | 🔴 Todo | **Clearance** (e-Fatura / e-Arsiv) | [View Specs](./TR-Turkey.md) |
| **UK** | `GB` | 🔴 Todo | Post-Audit (MTD is for VAT return) | [View Specs](./GB-UnitedKingdom.md) |

---

## 🌏 Asia Pacific (APAC)

| Country | Code | Status | Model Type | Technical Spec |
| :--- | :---: | :---: | :--- | :--- |
| **Australia** | `AU` | 🔴 Todo | **Peppol** (A-NZ PINT) | [View Specs](./AU-Australia.md) |
| **China** | `CN` | 🔴 Todo | **Clearance** (Golden Tax / OFD) | [View Specs](./CN-China.md) |
| **India** | `IN` | 🔴 Todo | **Clearance** (GST e-Invoice / IRP) | [View Specs](./IN-India.md) |
| **Japan** | `JP` | 🔴 Todo | **Peppol** (JP PINT / Qualified Invoice) | [View Specs](./JP-Japan.md) |
| **Malaysia** | `MY` | 🔴 Todo | **Clearance** (MyInvois) | [View Specs](./MY-Malaysia.md) |
| **New Zealand**| `NZ` | 🔴 Todo | **Peppol** (A-NZ PINT) | [View Specs](./NZ-NewZealand.md) |
| **Singapore** | `SG` | 🔴 Todo | **Peppol** (InvoiceNow / SG PINT) | [View Specs](./SG-Singapore.md) |
| **Vietnam** | `VN` | 🔴 Todo | **Clearance** (GDT) | [View Specs](./VN-Vietnam.md) |

---

## 🌎 Latin America (LATAM)

| Country | Code | Status | Model Type | Technical Spec |
| :--- | :---: | :---: | :--- | :--- |
| **Brazil** | `BR` | 🔴 Todo | **Clearance** (NF-e / NFS-e) | [View Specs](./BR-Brazil.md) |
| **Chile** | `CL` | 🔴 Todo | **Clearance** (DTE / SII) | [View Specs](./CL-Chile.md) |
| **Colombia** | `CO` | 🔴 Todo | **Clearance** (AttachedDocument / DIAN) | [View Specs](./CO-Colombia.md) |
| **Mexico** | `MX` | 🔴 Todo | **Clearance** (CFDI 4.0 / PAC) | [View Specs](./MX-Mexico.md) |
| **Peru** | `PE` | 🔴 Todo | **Clearance** (CPE / OSE) | [View Specs](./PE-Peru.md) |

---

## 🌍 Middle East & Africa (MEA)

| Country | Code | Status | Model Type | Technical Spec |
| :--- | :---: | :---: | :--- | :--- |
| **Egypt** | `EG` | 🔴 Todo | **Clearance** (Hardware Token Signing) | [View Specs](./EG-Egypt.md) |
| **Saudi Arabia**| `SA` | 🔴 Todo | **Clearance** (ZATCA Phase 2) | [View Specs](./SA-SaudiArabia.md) |
| **UAE** | `AE` | 🔴 Todo | **Peppol** (DCT / E-Invoicing) | [View Specs](./AE-UAE.md) |

---

## 🏙️ North America

| Country | Code | Status | Model Type | Technical Spec |
| :--- | :---: | :---: | :--- | :--- |
| **Canada** | `CA` | 🔴 Todo | Standard PDF / EDI | [View Specs](./CA-Canada.md) |
| **USA** | `US` | 🔴 Todo | Standard PDF / DBIA (Pilot) | [View Specs](./US-USA.md) |