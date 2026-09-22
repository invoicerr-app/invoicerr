# 03 — Legal Verification Against Primary Sources (Phase 2)

> Six countries: the ones where the code claims the most — bespoke profiles, `confidence: OFFICIAL`,
> vendored authority schemas. The other 100 have no implementation to check a rule against; sourcing
> them would be documentation work, not an audit.
>
> **Sourcing discipline.** Primary sources only: national tax administration, official gazette,
> technical specification published by the authority. Accredited-operator documentation accepted but
> flagged `authority: "vendor"`. Blogs, law firms, publishers: never. Every rule carries its URL, the
> date it was consulted, its effective date and its status. **What has not been established stays
> `open_question` — never a plausible value.**
>
> **All consultations: 2026-08-27.**
>
> Method: one agent per country, identical questionnaire, each checked against what the software's
> profile claims. Load-bearing claims were then **rechecked directly**; rechecks are flagged with
> ✓✓.

---

## FRANCE

### Sources

Dossier de spécifications externes de la facturation électronique (DSE) **v3.2 of 2026-04-30**,
published by AIFE/DGFiP — [authority page](https://www.impots.gouv.fr/specifications-externes-b2b),
archive `specifications-externes-v3.2.zip` (General document v3.2, DSE Chorus Pro v1.1, Annex 1
semantic format v1.2, Annex 2 CDV v2.3, Annex 7 business rules v1.9). Légifrance and BOFiP for hard
law.

### Timeline ✓✓

Rechecked directly on [economie.gouv.fr](https://www.economie.gouv.fr/tout-savoir-sur-la-facturation-electronique-pour-les-entreprises)
and [impots.gouv.fr](https://www.impots.gouv.fr/professionnel/je-passe-la-facturation-electronique)
(page modified 2026-07-10), consulted 2026-08-27:

| Obligation | Scope | Date | Status |
| --- | --- | --- | --- |
| **Receiving** | **all** businesses, regardless of size | **2026-09-01** | in force in 5 days |
| **Issuing** | large enterprises, mid-caps, members of a single taxable group | **2026-09-01** | same |
| **Issuing** | SMEs, small businesses, micro-enterprises | **2027-09-01** | announced |

Micro-entrepreneurs and VAT-exempt businesses are in scope, both for receiving and issuing.

**Caveat**: the final subparagraph of CGI art. 1737 allows a decree to push back application "sans
pouvoir être postérieure au 1er décembre 2026" [without being later than 1 December 2026]. **No
decree published as of 2026-08-27.** To be re-checked before any production rollout.

### Established rules

| # | Rule | Source | Effective date | Status |
| --- | --- | --- | --- | --- |
| 1 | Correction by **corrective invoice (384)** OR **credit note (381)** — both paths are open; other UNTDID 1001 types are forbidden | DSE Annex 7 v1.9, rule G1.01; DSE Chorus Pro §3.4.2.2 citing AFNOR XP Z12-014 | 2026-09-01 | in force |
| 2 | Third path: **internal credit note**, not transmitted to the buyer and **must generate no F1 flow** to the PPF | DSE general §3.6.4 | 2026-09-01 | in force |
| 3 | The content of an issued invoice is **immutable** — no cancellation operation exists in the circuit | DSE Chorus Pro §2.4.2 | 2026-09-01 | in force |
| 4 | Authenticity / integrity / legibility via **four alternative means**: reliable audit trail, qualified electronic signature, EDI, qualified electronic seal | [CGI art. 289, VII](https://www.legifrance.gouv.fr/codes/id/LEGISCTA000006191855) | — | in force, **repealed as of 2027-01-01** |
| 5 | **No state identifier is assigned to the invoice.** Uniqueness is computed: invoice number + supplier SIREN + year | DSE §3.6.8 note 109 | 2026-09-01 | in force |
| 6 | Four mandatory statuses: **200 Déposée, 210 Refusée, 212 Encaissée** (conditional on art. 290 A CGI), **213 Rejetée** | DSE §3.6.4 table 8; Annex 2 | 2026-09-01 | in force |
| 7 | **24 h** deadline — for the F1 flow from the "Déposée" status timestamp, and for lifecycle flows from the status timestamp | DSE §3.6.5 and §3.6.6 | 2026-09-01 | in force |
| 8 | **Tax** retention: **6 years**. Documents created or received on a digital medium **must be kept in that form** ✓✓ | [LPF art. L102 B](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000041471233/) — version in force 2023-01-01 → 2027-01-01 | — | in force |
| 9 | **Commercial** retention: **10 years** for accounting documents and supporting records | [C. com. art. L123-22](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006219327/) | — | in force |
| 10 | **Localization**: storage in France unless immediate, complete online access with download and use is available; forbidden in a country with no mutual-assistance agreement; **the storage location must be declared** and any change reported | [LPF art. L102 C](https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006069583/LEGISCTA000006147333/) | — | in force |
| 11 | Numbering "**based on a chronological and continuous sequence**" | [CGI ann. II art. 242 nonies A, 7°](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000046086694/) | — | in force |
| 12 | Invoice identifier: **35 characters max**, alphanumeric, special characters limited to space `-` `+` `_` `/`, no leading/trailing or consecutive spaces | DSE Annex 7 v1.9, rule G1.05 | 2026-09-01 | in force |
| 13 | Format base: **UBL, CII and Factur-X**. But the F1 flow to the PPF only accepts **UBL 2.1 or CII D22B** — not Factur-X | DSE §2.3.10 and §3.6.3 | 2026-09-01 | in force |
| 14 | New mentions: membership in a single taxable group (5° bis), **goods/services transaction category (8° bis → BT-23, 1..1)**, option to pay VAT on debits (11° bis); **delivery address (7° bis → BG-15) as of 2027-09-01** | [CGI ann. II art. 242 nonies A](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000046086694/), decree no. 2024-1195 of 2024-12-21 | 2026-09-01 / 2027-09-01 | in force / announced |
| 15 | Penalties: omission or inaccuracy **€15** per mention (cap ¼ of the amount); failure to issue electronically **€50/invoice**, cap €15,000/year; refusing to use an accredited platform **€500** then **€1,000** per quarter | [CGI art. 1737](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000046869201) (amended by LOI no. 2026-103 of 2026-02-19) | 2026-09-01 | in force |

### Divergences from the code — France

Ranked by severity. "The code is wrong" means: the profile asserts something the primary source
contradicts.

**FR-D1 — `channels: EMAIL` is unlawful in the domestic B2B scope. ✓✓**
As of 2026-09-01, "seule une plateforme agréée est habilitée à assurer toutes les fonctionnalités
prévues" [only an accredited platform is authorized to provide all the intended functionalities];
issuing, transmission and receiving go through an accredited platform. Email is not a lawful channel
for an in-scope invoice. Penalties: €50/invoice, then €500 and €1,000/quarter. Yet the FR profile
declares `EMAIL` among its channels — and the inventory shows that, along with PDP and Peppol, it is
one of the only ones actually reachable.
*(Terminology: "PDP" is outdated; the official term since the LF 2026 is **plateforme agréée**
[accredited platform].)*

**FR-D2 — `correctionModel: CREDIT_NOTE` alone: the code is wrong.**
G1.01 allows **corrective invoice (384)** on the same footing as **credit note (381)**, and the
semantic model carries BG-3 "prior invoice that must be **corrected** or be the subject of a credit
note". An engine that can only issue a credit note cannot represent the corrective-invoice path.

**FR-D3 — the internal credit note is ignored: over-reporting risk.**
On "Refusée" or "Rejetée" status, accounting cancellation is done via an internal credit note, which
"**ne doit pas générer de flux de données réglementaires (F1) au PPF**" [must not generate a
regulatory-data (F1) flow to the PPF] and must not be transmitted to the buyer. Code that
systematically issues a credit note *via* the platform transmits to the administration precisely in
the case the specification forbids.

**FR-D4 — no localization constraint: a real compliance gap.**
LPF L102 C requires France / a country under an agreement with online access, **and requires
declaring the storage location**. The FR profile declares no residency constraint
(`10y/BOTH/HASH_CHAIN`, with no `residency`). This is the most operationally relevant divergence for
a SaaS or self-hosted deployment outside France.

**FR-D5 — `integrity: HASH_CHAIN` has no basis in French law.**
Art. 289 VII offers four alternative means; hash-chaining is not one of them. The only
"inalterability" requirement in French tax law is that of art. 286, I-3° bis, whose scope is **cash
register software recording payments from private customers** — a separate obligation, €7,500 fine.
The profile thus applies a constraint that does not exist, and implements none of the four means that
do exist.

**FR-D6 — `mandatoryReceiveSyntax: FACTURX`: the code is wrong, twice.**
The format base has **three** formats (UBL, CII, Factur-X) and the receiving platform must convert to
another base format on the customer's request: nothing mandates Factur-X on receipt. Symmetrically,
the PPF **does not accept** Factur-X for the F1 flow — UBL 2.1 or CII D22B only.

**FR-D7 — BT-23 "Invoice type code" missing, cardinality 1..1.**
Machine translation of the statutory mention 8° bis, mandatory from 2026-09-01, restricted values
(`B1`, `S1`, `M1`, `B2`/`S2`/`M2`, `B4`/`S4`/`M4`, `S5`, `S6`, `B7`/`S7`). An invoice without a valid
BT-23 fails the PPF's functional checks.

**FR-D8 — number-format constraint not implemented, and blocking.**
G1.05: 35 characters max, special characters restricted to space `-` `+` `_` `/`. A generator emitting
`#`, `.` or a longer identifier will **get the F1 flow rejected**. To be tied to F-002: numbering is
already the system's weak point.

**FR-D9 — `archival: 10 years`: approximate and poorly grounded. ✓✓**
The **tax** duration is **6 years** (LPF L102 B); the 10 years belong to **commercial law**
(C. com. L123-22). 10 years is a prudent envelope, but labeling it as the tax rule is wrong and
blocks any correct reasoning about the two deadlines. The genuinely structuring constraint —
retaining the **original format** — is not modeled at all.

**FR-D10 — `REAL_TIME_REPORTING` is inaccurate.**
The regime is not real-time: **24 h** from the status timestamp, batched. On the other hand,
`non-blocking` is **correct**: the PPF exercises no clearance, it can only accept (250) or reject
(251) the regulatory data **after** issuance, with no effect on the invoice's validity.

**FR-D11 — `cancellationAllowed: true` needs nuance.**
No cancellation of an issued invoice exists. There is a cross-platform **status** 220 "Annulée",
meaning "replaced by a corrective invoice" and **not transmitted to the administration**, plus
accounting cancellation via an internal credit note. On the other hand `immutableAfter: ISSUE` is
**accurate and well grounded** — one of the few points where the profile gets it right.

**FR-D12 — missing time granularity: the block would be over-strict. ✓✓**
The **issuing** obligation on 2026-09-01 only targets large enterprises, mid-caps and members of a
single taxable group; SMEs/small businesses/micro only issue as of **2027-09-01**. Only
**receiving** is universal on 2026-09-01. A profile that blocks issuance for every French business on
2026-09-01 would be stricter than the law. Likewise, the delivery address (BG-15) is a TARGET for
2027-09-01, not at rollout.

**FR-D13 — scheduled obsolescence of the references.**
Articles 289 and 289 bis CGI are **repealed as of 2027-01-01** by ordinance no. 2025-1247 of
2025-12-17 (VAT recodification into the CIBS), with certain provisions kept in force pending
regulatory pickup. Since the profiles are time-based, the reference switch will need to be carried.

### What the code gets right — France

Worth noting, because an audit that only flags faults is a bad audit:

- `immutableAfter: ISSUE` is accurate and matches the DSE's intangibility principle;
- `GAPLESS_SELF` is accurate: 242 nonies A, 7° does require a chronological **and** continuous
  sequence, sanctioned under art. 1737, II;
- `regimeBlocking: false` is accurate: the PPF exercises no clearance;
- the per-channel PDP architecture — connecting to a third-party accredited platform — is the only
  practical path without a DGFiP registration (see `04-TESTABILITY.md` §2).

### Open questions — France

1. Statutory deadline for issuing a credit note or corrective invoice after the original invoice.
2. Counterparty's consent for a corrective invoice.
3. Cut-off window beyond which a correction is no longer possible.
4. Text designating **what is authoritative** in an audit — no identified text establishes a single
   document; the bundle appears to be invoice + reliable audit trail (289 VII) + timestamped CDV 200.
5. Obligation and retention period for lifecycle messages and platform acknowledgments;
   qualification as "supporting records" under L102 B not settled.
6. Mandated archival format (native XML only, XML + PDF, PDF/A-3). Only safe rule: retention of the
   **original format**.
7. **AFNOR XP Z12-012 / 013 / 014 are paid standards and were not consulted.** Everything above about
   them comes from their citation by DSE Chorus Pro v1.1. They carry the full list of statuses
   (including 220, 224, 225, 227, 228) and the correction use cases.
8. Deferral decree to 2026-12-01 (art. 1737, last subparagraph) — none published as of 2026-08-27.
9. Post-reform update of the archival doctrine BOI-CF-COM-10-10-30, dated 2012-09-12 and therefore
   predating the scheme.

---

---

## POLAND

### Sources

*Podręcznik KSeF 2.0, Cz. II — Wystawianie i otrzymywanie faktur*, MF, **state of the law as of
2026-02-01**; ustawa of 2025-08-05 (**Dz.U. 2025 poz. 1203**) and of 2023-06-16 (**Dz.U. 2023 poz.
1598**) via `eli.gov.pl`; **production OpenAPI specification**
`api.ksef.mf.gov.pl/docs/v2/openapi.json`; broszura FA(3); `ksef.podatki.gov.pl` pages.

### Staggered scope — not modeled by the profile

| Date | Rule | Status |
| --- | --- | --- |
| 2026-02-01 | Issuing mandatory if 2024 gross sales **> PLN 200,000,000**; **receiving mandatory for everyone** | in force |
| 2026-04-01 | Issuing mandatory for **everyone else** | in force |
| 2026-04-01 → 2026-12-31 | Exemption if gross sales **≤ PLN 10,000/month**, lost as soon as an invoice pushes past the threshold (art. 145m) | in force, expiring |
| 2026-02-01 → 2026-12-31 | Cash-register invoices outside KSeF (art. 145n) | in force, expiring |
| 2027-01-01 | Penalties under art. 106ni; KSeF number mandatory in MPP payments | announced |

### Established rules

| # | Rule | Source | Status |
| --- | --- | --- | --- |
| 1 | **No cancellation is possible** once a KSeF number is assigned ✓✓ — "Faktura po przyjęciu do KSeF staje się dokumentem prawnym i nie można jej zmieniać" [Once accepted into KSeF, an invoice becomes a legal document and cannot be changed] | [ksef.podatki.gov.pl Q&A](https://ksef.podatki.gov.pl/pytania-i-odpowiedzi-ksef-20/); Podręcznik §1.6.3 | in force |
| 2 | File **rejected ⇒ the invoice was never issued** ✓✓ — "Nie można więc wystawić faktury korygującej ani anulować faktury" [A correcting invoice cannot therefore be issued, nor can the invoice be cancelled]. The XML is fixed and **resent under the same `P_2` number** | ibid.; Podręcznik §1.6.7 | in force |
| 3 | Only correction path: the **faktura korygująca**. The *nota korygująca* was **abolished as of 2026-02-01** | Podręcznik §1.6.2 | in force |
| 4 | **Buyer's consent not required** for a structured korygująca (art. 29a ust. 13, new wording; ust. 15 pkt 5 repealed) | Dz.U. 2023 poz. 1598 | in force 2026-02-01 |
| 5 | Issue date = **transmission date** to KSeF if it matches `P_1` (art. 106na ust. 1) — **not** the date the number is assigned. `P_1` in the future ⇒ **rejection** | Podręcznik §1.4 | in force |
| 6 | The **KSeF number is not a field on the invoice**; it is returned in the **UPO** | Podręcznik §4.1 | in force |
| 7 | **10-year archival by KSeF**, art. 112aa: "art. 112 i art. 112a **nie stosuje się**" [articles 112 and 112a do not apply] — the taxpayer **is exempted** from retention ✓✓. Automatic deletion at term, with no recovery | Podręcznik §7; Q&A | in force |
| 8 | Three permanent offline modes: **offline24** (free choice, sent by next business day), **niedostępność** (next business day after the outage ends), **awaryjny** (7 business days) | art. 106nda / 106nh / 106nf | in force |
| 9 | Duplicate check on (seller NIP, `P_2`, `RodzajFaktury`), **10 years back** ⇒ code `440` | Podręcznik §3.4 | in force |
| 10 | KSeF **does not check arithmetic**: "Nie odrzuci faktury w przypadku wystąpienia na niej błędów rachunkowych" [It will not reject an invoice for containing arithmetic errors] | Podręcznik §1.6.2 | in force |
| 11 | Numbering: "kolejny numer nadany w ramach **jednej lub więcej serii**" [a sequential number assigned within one or more series] — only **uniqueness** is checked; out-of-order transmission is **not** grounds for rejection or for a korygująca | art. 106e ust. 1 pkt 2; Podręcznik §1.6.7 | in force |

### Divergences from the code — Poland

**PL-D1 — `cancellationAllowed: true`: the code is wrong. The most serious divergence. ✓✓**
"W KSeF nie jest możliwe anulowanie wystawionej faktury" [Cancelling an issued invoice is not
possible in KSeF] — never, whatever the error, and the taxpayer cannot delete the invoice either.
Substitution goes through a korygująca "do zera" [zeroing it out] followed by a new original invoice.
Allowing a cancellation produces a state that does not legally exist on the authority's side.

**PL-D2 — `correctionModel: CREDIT_NOTE + CORRECTIVE_INVOICE`: the code is wrong.**
Only the **faktura korygująca** exists; there is no separate credit note under Polish law, and the
*nota korygująca* has been repealed since 2026-02-01. The `CREDIT_NOTE` branch produces a
non-compliant document.

**PL-D3 — `primarySyntaxes: PLAIN_PDF + FA_VAT`: the code is wrong twice over.**
The sole lawful issuing syntax is **FA(3)** (`kodSystemowy "FA (3)"`, `wersjaSchemy 1-0E`) as of
2026-02-01; "FA_VAT" / FA(2) is outdated. PDF is never a primary syntax: it is a visualization for
buyers under art. 106gb ust. 4, which must then carry a QR code.

**PL-D4 — WITHDRAWN. It was a false positive in my instrumentation.**

*The Polish profile is correct.* It declares `EMAIL` **only until 2026-02-01**, then only
`GOV_PORTAL_API:ksef` — which is exactly the rule. The error came from my own inventory, which
**deliberately flattens all time periods**, including lapsed ones, and so presented an abandoned
channel as a declared one.

Still true and unaffected: KSeF is the only lawful issuing channel, and email is merely an agreed
means of delivery to buyers under art. 106gb ust. 4.

**PL-D5 — `archival: 10y / BOTH / SIGNED`: duration correct, everything else wrong. ✓✓**
The 10 years are accurate (art. 112aa) but **borne by KSeF**, with the taxpayer exempted. No
obligation to keep a PDF. The XML invoice **is not signed**: integrity comes from KSeF, and the
256-bit SHA-2 fingerprint appears in the UPO. **Residual obligation not modeled**: if the statute of
limitations runs past 10 years, invoices must be extracted **before** their automatic deletion.

**PL-D6 — `reporting: none`: the code is incomplete.**
Since the February 2026 filings, `JPK_V7M(3)` / `JPK_V7K(3)` require the **KSeF number of every sales
and purchase invoice**. This requires persisting the KSeF number **in both directions**, issuing and
receiving.

**PL-D7 — `numbering: GAPLESS_SELF`: over-constrained.**
The law requires "kolejny numer […] w ramach jednej lub więcej serii"; the ministry explicitly
tolerates out-of-order transmission **without a korygująca**, and KSeF only checks **uniqueness**. A
strict gapless requirement on the client side would force needless corrections. *("No hash chain" is
correct, on the other hand.)*

**PL-D8 — `requiredIdentifiers: LEGAL_ID + VAT`: over-constrained and an incomplete model.**
On the seller side, FA(3) only requires **NIP + Nazwa + Adres** — no KRS/REGON on the invoice. On the
buyer side, **four mutually exclusive cases** must be modeled: `NIP`, `KodUE`+`NrVatUE`,
`KodKraju`+`NrID`, or **`BrakID="1"`**. A misplaced identifier causes the invoice to **not be
delivered to the buyer, silently**.

**PL-D9 — whole gaps.** The three offline modes and their deadlines; the KSeF `Offline` certificate
and the two QR codes; rejection if `P_1` is in the future; the 10-year duplicate check; the *korekta
techniczna*; the wrong-buyer-NIP procedure (korekta zeroing it out **on the erroneous NIP**, then a
new invoice — correcting the NIP is explicitly forbidden); the per-invoice statuses (`200` success
only, `550` retryable, `440` duplicate).

### What the code gets right — Poland

`regimeBlocking: true` is **accurate**: no KSeF number, no invoice. `hashChain: false` is accurate.
And the fact that KSeF **does not validate arithmetic** confirms that a `CLEARANCE` waives no
application-level check — the profile does not claim otherwise.

---

---

## GERMANY

### Sources

`gesetze-im-internet.de` (UStG, UStDV, AO, ERechV); BMF — E-Rechnung FAQ **as of March 2026**,
BMF-Schreiben of **2025-10-15** (GZ III C 2 - S 7287-a/00019/007/243) introducing the new UStAE,
GoBD BMF-Schreiben of **2025-07-14**; KoSIT / xeinkauf.de for XRechnung **3.0.2**.

### B2B timeline

Trigger: **both parties established in Germany** (§ 14 Abs. 2 Satz 3). A simple German VAT
registration is not enough.

| Phase | Date | Content | Status |
| --- | --- | --- | --- |
| **Receiving** | **2025-01-01** | Every business established in DE must be able to receive. **No exception, no threshold** — Kleinunternehmer included | in force |
| Issuing tolerance | → **2026-12-31** | Paper, or another electronic format with the recipient's agreement (§ 27 Abs. 38 Nr. 1) | in force |
| **Issuing** | **2027-01-01** | Mandatory if prior-year `Gesamtumsatz` **> €800,000** | announced, in 4 months |
| SME tolerance | → **2027-12-31** | Prior-year `Gesamtumsatz` ≤ €800,000 (Nr. 2); EDI 94/820/EG with agreement, no revenue condition (Nr. 3) | in force |
| **General obligation** | **2028-01-01** | No exemption left | announced |

**No CTC regime, no clearance, no reporting is in force.** A `Meldesystem` is announced "zu gegebener
Zeit" [in due course], **with no date and no bill**; the JStG 2026 (government bill of 2026-05-19)
does not contain it.

### Established rules

| # | Rule | Source | Status |
| --- | --- | --- | --- |
| 1 | Archival **8 years** ✓✓ — "acht Jahre aufzubewahren" [to be kept for eight years]; reduction from 10 to 8 by the BEG IV | [§ 14b Abs. 1 UStG](https://www.gesetze-im-internet.de/ustg_1980/__14b.html) | in force 2025-01-01 |
| 2 | § 147 Abs. 3 AO: **8 years** for Buchungsbelege; **10 years** remains for ledgers, balance sheets, inventories | § 147 AO | in force |
| 3 | **Localization** ✓✓ — retention in Germany; elsewhere in the EU **only** with full remote access and download, **with the location reported to the Finanzamt**; **outside the EU ⇒ prior authorization required** (§ 146 Abs. 2b AO), penalty €2,500 – €250,000 | § 14b Abs. 2/4/5 UStG | in force |
| 4 | Integrity **mandatory but the means is free**: internal control with a reliable audit trail, **or** eIDAS-qualified signature/seal, **or** EDI — and it must hold **for the entire archival period** | § 14 Abs. 3 and § 14b Abs. 1 S. 2 UStG; UStAE 14.4 | in force |
| 5 | Format: **any** EN 16931 / dir. 2014/55/EU format, or a bilaterally agreed format allowing correct and complete extraction. ZUGFeRD ≥ 2.0.1 accepted (except MINIMUM and BASIC-WL profiles) | § 14 Abs. 1 S. 6 UStG; UStAE 14.1 | in force |
| 6 | In hybrid format, **the structured part prevails** in case of discrepancy with the image | UStAE 14.4 Abs. 3 | in force |
| 7 | Numbering: "eine fortlaufende Nummer …, die … **einmalig vergeben** wird" [a sequential number … assigned … uniquely]. Doctrine: "Eine **lückenlose Abfolge … ist nicht zwingend**" [A gapless sequence … is not mandatory]. Kleinbetragsrechnungen ≤ €250, Fahrausweise and Kleinunternehmer: **no number required** | § 14 Abs. 4 Nr. 4 UStG; UStAE 14.5 Abs. 10/11/14 | in force |
| 8 | Seller identifier: **Steuernummer OR USt-IdNr.** — alternative, not cumulative | § 14 Abs. 4 Nr. 2 UStG | in force |
| 9 | Correction via a **corrective document** specifically referencing the original, in the **same form**; reference path `BT-3 = 384` + `BG-3` (BR-DE-26). No correction required for § 17 variations (discount, rebate) | § 31 Abs. 5 UStDV; UStAE 14.11 | in force |
| 10 | Cancellation in case of `unberechtigter Steuerausweis`: **written request to, and agreement of, the Finanzamt** (§ 14c Abs. 2) | § 14c UStG | in force |
| 11 | Leitweg-ID: mandatory **in B2G only** (§ 5 Abs. 1 Nr. 1 ERechV); in B2B "wird grundsätzlich keine Leitweg-ID benötigt" [in principle no Leitweg-ID is needed], and a missing BT-10 is "umsatzsteuerlich unbeachtlich" [immaterial for VAT purposes] | BMF FAQ 6; BMF Rn. 35a | in force |

### Divergences from the code — Germany

**DE-D1 — `archival: 10 years`: the code is wrong. ✓✓**
It is **8 years** since 2025-01-01 (§ 14b Abs. 1 Satz 1, text verified verbatim: "acht Jahre"). Two
years of over-retention, with the GDPR consequences that implies.

**DE-D2 — `integrity: NONE`: the code is wrong.**
§ 14 Abs. 3 requires Echtheit der Herkunft, Unversehrtheit des Inhalts [authenticity of origin,
integrity of content] **and** Lesbarkeit [legibility], and § 14b Abs. 1 Satz 2 requires guaranteeing
them **for the whole archival period**. This is not "no requirement", it is "requirement, free
choice of means". Correct modeling: `AUDIT_TRAIL | QES | EDI` — never `NONE`.

**DE-D3 — `mandatoryReceiveSyntax: XRECHNUNG`: the code is wrong.**
Any EN 16931 format is accepted, as is a bilaterally agreed format. The profile would reject
perfectly lawful invoices (ZUGFeRD, Factur-X, foreign UBL/CII, EDIFACT). Aggravating factor: the
recipient "**hat kein Anrecht auf eine alternative Ausstellung**" [has no right to demand an
alternative issuing format] — they cannot require another format.

**DE-D4 — `numbering: GAPLESS_SELF`: the code is wrong.**
The legal criterion is **`einmalig`** (unique), not `lückenlos` (gapless). BMF doctrine states it
explicitly: "Eine lückenlose Abfolge der ausgestellten Rechnungsnummern ist nicht zwingend". Several
non-contiguous series are allowed. The profile thus imposes a constraint German law does not have.

**DE-D5 — `requiredIdentifiers: VAT` mandatory: the code is wrong.**
§ 14 Abs. 4 Nr. 2 offers the alternative **Steuernummer or USt-IdNr.** Requiring the latter blocks
domestic suppliers who do not have one.

**DE-D6 — `requiredIdentifiers: LEITWEG_ID`: the code is wrong in B2B.**
Correct in B2G, wrong in B2B. Must be conditioned on the recipient's nature.

**DE-D7 — `archivedForm: BOTH`: over-specified.**
The structured part alone suffices (GoBD Rz. 119/131); the PDF is only required if it carries
additional tax-relevant information. For outgoing invoices, no image copy is required if an
identical duplicate can be reproduced on request (Rz. 76).

**DE-D8 — `correctionModel: CREDIT_NOTE`: under-modeled, with a terminology trap.**
The German reference path is the **Rechnungsberichtigung** (`BT-3 = 384`), not the credit note. And
above all: under German law, **`Gutschrift` within the meaning of § 14 Abs. 2 Satz 5 means
self-billing**, a mention required under § 14 Abs. 4 Nr. 10. Using that term for a commercial credit
note is a documented risk under § 14c.

**DE-D9 — `cancellationAllowed: true` unconditional: the code is incomplete.**
In case of `unberechtigter Steuerausweis` (§ 14c Abs. 2), correction requires removing the tax risk,
**a separate written request to, and agreement of, the Finanzamt**. This state-authorization gate is
not modeled.

**DE-D10 — `channels: PEPPOL + EMAIL`: both too narrow and too broad.**
In B2B, the law prescribes **no** channel at all. In federal B2G on the other hand, § 4 Abs. 3 ERechV
requires the **portal (OZG-RE) with prior registration**: a direct email to the public buyer does not
satisfy the obligation.

**DE-D11 — gaps**: localization constraint (§ 14b Abs. 2); both-parties-established trigger; issuing
thresholds and exemptions (≤ €250 gross, Fahrausweise, Kleinunternehmer, B2C, § 4 Nr. 8–29) while
**receiving has none at all**; primacy of the structured part; the requirement that **all** mentions
appear in the structured part.

### What the code gets right — Germany

`regime: POST_AUDIT, non-blocking` and `reporting: none` are **accurate as of 2026-08-27**. This is
the only one of the six countries where the declared regime matches reality exactly. Fragile though:
issuing a non-E-Rechnung becomes an infringement as of 2027-01-01 above €800,000, then for everyone
as of 2028-01-01.

### Open questions — Germany

1. **Date of the Meldesystem**: `null`. No bill as of 2026-08-27. **The "2028" that circulates does
   not appear in any primary source consulted — do not code it.**
2. Interaction with ViDA: not addressed by a German primary source.
3. Statutory deadline for the Rechnungsberichtigung: `null` — neither § 31 Abs. 5 UStDV nor § 14 UStG
   sets a window.
4. Penalties for issuing a non-E-Rechnung after 2027-01-01: not established.
5. GoBD Rz. 135/136 (format-conversion conditions): not read verbatim — to verify before coding a
   conversion policy.

---

---

## ITALY

### Sources

D.Lgs. 127/2015 art. 1 and DPR 633/1972 artt. 21, 26, 39 via `normattiva.it`; **Provvedimento AdE
prot. 433608 of 2022-11-24** (whose point 15.1 "sostituisce integralmente il provvedimento del 30
aprile 2018" [fully replaces the provision of 30 April 2018]); **Allegato A — Specifiche tecniche
v1.9.1**, updated 2026-03-31, usable since **2026-05-15**; DM MEF 17/06/2014; Linee Guida AgID on the
electronic document, applicable since 2022-01-01; AdE prassi (Ris. 1/E 2013, Circ. 13/E 2018,
Circ. 14/E 2019, Circ. 20/E 2021, Risposta 447/2023, AdE Guide **December 2025**).

### Established rules

| # | Rule | Source | Status |
| --- | --- | --- | --- |
| 1 | Upward variations **are mandatory** ("devono essere osservate" [must be observed]) → **nota di debito TD05**; downward ones are **optional** ("ha diritto di" [has the right to]) → nota di credito TD04 | art. 26 c. 1 and 2 DPR 633/72 | in force |
| 2 | There is **no distinct corrective invoice** under Italian law: the `TipoDocumento` list has none | Provv. 433608 pt 6.1 | in force |
| 3 | One-year window **only** for a later agreement between parties and for correcting inaccuracies under art. 21 c. 7; for nullity, rescission, cancellation: **no one-year deadline** | art. 26 c. 3; Circ. 20/E "senza specifici limiti di tempo" [with no specific time limits] | in force |
| 4 | Real cutoff: the nota must be issued before the **filing deadline of the annual VAT return** for the year of the triggering event | Circ. 20/E §3 | in force |
| 5 | **Counterparty consent not required**: "Le richieste […] di variazioni […] **non sono gestite dal SdI**" [Requests … for variations … are not handled by the SdI] | Provv. 433608 pt 6.2 | in force |
| 6 | **No cancellation possible** after RC or MC: "Le ricevute […] attestano che la fattura è emessa" [The receipts … certify that the invoice has been issued]. Only path: the nota di variazione under art. 26 | Provv. 433608 pt 4.4; Risposta 447/2023 | in force |
| 7 | **Issue date = the `Data` field in `DatiGenerali`**, not the transmission date. Issuing deadline: **12 days** from the transaction | Provv. 433608 pt 4.1; art. 21 c. 4 DPR 633/72 | in force |
| 8 | A **scarto (NS) ⇒ the invoice was never issued**, notified **within 5 days** | Provv. 433608 pt 2.4 | in force |
| 9 | Resending after a scarto: **preferably the same date and number**; the uniqueness check 00404/00409 is lifted precisely because an NS was issued; only the **file name** must change | Circ. 13/E §1.6; Specifiche v1.9.1 App. 1 | prassi, reconfirmed in 2025 |
| 10 | B2B flow: **RC, NS, MC** only (+ MT to the recipient). **NE, DT and AT only exist in the B2G flow** DM 55/2013 | Specifiche v1.9.1 §1.1 | in force |
| 11 | Archival **10 years** (art. 2220 c.c.) **extended** "anche oltre il termine stabilito dall'articolo 2220" [even beyond the term set by article 2220] until controls are settled | art. 22 c. 2 DPR 600/73 via art. 39 c. 3 DPR 633/72 | in force |
| 12 | **Only the original XML** must be retained; the PDF is optional ("potrà portare in conservazione **anche** copie informatiche" [may also bring digital copies into retention]) | art. 39 c. 3 DPR 633/72; Circ. 13/E §3.2 | in force |
| 13 | What is mandatory is the signature/seal of the **archival package** + a **timestamp enforceable against third parties** — not the signature of the invoice, **optional in B2B** and mandatory in B2G | DM 17/06/2014 art. 3 c. 2; LG AgID §4.8; Provv. pt 2.6 | in force |
| 14 | **No EU constraint** on location: retention possible in any state bound by a mutual-assistance instrument, with guaranteed automated access; the location must be declared | art. 39 c. 3 DPR 633/72 | in force |
| 15 | Numbering: "numero progressivo che la identifichi in modo **univoco**" [a progressive number that identifies it **uniquely**]. The mention "in ordine progressivo per anno solare" [in progressive order per calendar year] was **removed** in 2013 | art. 21 c. 2 lett. b) DPR 633/72; Ris. 1/E 2013 | in force |
| 16 | `Natura` **mandatory as soon as `AliquotaIVA` = 0** (errors 00400/00429) and **forbidden** if the rate ≠ 0 (00401/00430) | Specifiche v1.9.1 | in force |

### Divergences from the code — Italy

**IT-D1 — `cancellationAllowed: true`: the code is wrong.** No cancellation exists after RC/MC; only
the nota di variazione under art. 26 exists. A cancellation flow would produce a state inconsistent
with the VAT register.

**IT-D2 — `numbering: GAPLESS_SELF`: the code is wrong.** The law only requires uniqueness, and
Ris. 1/E of 2013 accepts "qualsiasi tipologia di numerazione progressiva che garantisca
l'identificazione univoca" [any kind of progressive numbering that guarantees unique
identification]. A gap invalidates nothing.

**IT-D3 — `correctionModel: CREDIT_NOTE` alone: the code is incomplete.** It is missing the **nota di
debito TD05**, which covers upward variations — which are **mandatory**, unlike downward ones.

**IT-D4 — `reporting: none`: the code is wrong, and it is the most structural divergence.** Art. 1
c. 3-bis of D.Lgs. 127/2015 requires transmitting the data of transactions with **non-established**
parties, via the SdI and the ordinary tracciato since 2022-07-01 — outgoing "entro i termini di
emissione delle fatture" [within invoice-issuing deadlines], incoming "entro il quindicesimo giorno
del mese successivo" [by the 15th day of the following month]. On top of that, the quarterly
settlement of the imposta di bollo. **This is exactly the domestic → reporting shift described in
F-017.**

**IT-D5 — `archivedForm: BOTH` and `integrity: SIGNED`: the code conflates two levels.** Only the
XML must be retained. And the mandatory signature applies to the **archival package**, not the
invoice — which is only mandatorily signed in **B2G**. The profile does not distinguish B2B from
B2G.

**IT-D6 — `archival: 10 years`: incomplete.** The 10 years are extended until controls are settled.
A purge at day-10-years-plus-1 would destroy records still required to be kept.

**IT-D7 — `primarySyntaxes: PLAIN_PDF + FATTURAPA`: the code is wrong.** Domestically, "sono emesse
**esclusivamente** fatture elettroniche utilizzando il Sistema di Interscambio" [electronic invoices
are issued **exclusively** using the Interchange System], and any other method ⇒ "la fattura si
intende **non emessa**" [the invoice is deemed **not issued**]. PDF is only lawful in exemption
cases, or as a *copia di cortesia* with no tax value.

**IT-D8 — WITHDRAWN. False positive, same cause as PL-D4.**

*The Italian profile is correct.* It declares `EMAIL` **only until 2019-01-01**, then `SDI`. Still
true as a vocabulary point: the SdI channels are **PEC** (which is not an ordinary email), the AdE
web/app procedure, **SDICoop** and **SDIFTP**.

**IT-D9 — `requiredIdentifiers: IT_SDI + PEC` combined: the code is wrong.** Codice destinatario and
PEC are **alternatives**. Missing are the conventional values `0000000` (consumer, forfettario,
unknown channel) and **`XXXXXXX`** (non-established recipient — check 00313).

**IT-D10 — `immutableAfter: ISSUE then CLEARANCE`: wrong trigger.** Immutability begins on the
**RC or MC** response. Before the SdI's response, or after an NS, the document can be freely
recomposed — including with the same date and number. The profile **locks too early** and would
block resending after a scarto.

**IT-D11 — response policy: risk of phantom statuses.** If the profile models NE, DT or AT in B2B,
it expects messages that **will never arrive** — they only exist in the B2G flow.

**IT-D12 — major functional gap**: the post-scarto resend rule under 5 days, same date and number,
appears nowhere. Yet it is the nominal recovery path after a rejection.

### Internal contradiction found

The profile simultaneously declares `POST_AUDIT + CLEARANCE` and `reporting: none`. But the
"post-audit" leg of the Italian scheme **is** precisely the c. 3-bis reporting the profile denies.

---

---

## SPAIN

### Sources

BOE, consolidated texts (RD 1007/2023, RD 1619/2012, RD 238/2026, Orden HAC/1177/2024, LGT, LIVA,
Código de Comercio, Ley 25/2013); AEAT (`sede.agenciatributaria.gob.es`); `hacienda.gob.es` for the
draft ministerial order.

### Two regimes, two triggers of a different nature

This is Spain's particularity, and it is structural:

| Regime | Trigger | Pivot |
| --- | --- | --- |
| **Veri\*Factu** | **unilateral** — a **tax status of the issuer** (IS / IRPF economic activity / IRNR **with a permanent establishment** / income-attribution entity), tax domicile in common territory, **and not enrolled in the SII** | **seller** |
| **B2B mandate** (RD 238/2026) | **bilateral, dominated by the recipient** — the issuer must be required to issue under RD 1619/2012, **and** the recipient must have their registered office, a PE, or their domicile in Spain, **and the transaction must be addressed to them** | **buyer** |

The B2B mandate thus pivots on `buyerEstablishment == ES`, **not** on the seller's country. An
engine that turns it on based on the seller gets it wrong both ways: a false positive on ES → FR, a
false negative for a foreign seller subject to Spanish rules selling to a buyer established in Spain.

**Veri\*Factu covers outbound cross-border transactions**: the standard targets the issuing of
invoices "**cualquiera que sea el destinatario**" [whoever the recipient may be]. An invoice to a
foreign customer generates a registro de facturación just like a domestic invoice. An engine that
short-circuits on `buyerCountry != ES` is non-compliant.

### Timeline — three independent clocks

| Clock | Deadline | Status |
| --- | --- | --- |
| Veri\*Factu — IS taxpayers | **2027-01-01** | in force (postponed twice: RD 254/2025 then RD-ley 15/2025, validated 2025-12-11) |
| Veri\*Factu — remaining art. 3.1 obligated parties | **2027-07-01** | in force |
| Veri\*Factu — **software producers** | **9 months after the ministerial order takes effect** ✓✓ | **deadline has expired** |
| B2B mandate | 12 / 24 / 36 months **from the entry into force of an unpublished ministerial order** | **clock not started** |

The B2B mandate's ministerial order **is not published as of 2026-08-27**; it exists as a draft
submitted for public comment on 2026-04-17, proposing entry into force on 2026-10-01. **These dates
must not be coded as firm.**

### Divergences from the code — Spain

**ES-D1 — chaining is mandatory, the algorithm exists, and the chain is never formed.**

*Corrected version. The first draft said "`hashChain: false`: the code is wrong" and implied the
capability was absent. It is not, and the real defect is more precise.*

**The law first.** Chaining by the previous record's fingerprint is **mandatory in both modalities**
(RD 1007/2023 art. 8.2.b, 10.1.ñ, 11.2.e and 12). The art. 16.3 exception only lifts the **XAdES
signature**, never the hash. The profile's `hashChain: false` flag is therefore wrong as a
declaration.

**What the code actually does.** `reporting/generators.ts` implements the huella algorithm — the
canonical chain, the field set and order, casing, uppercase hexadecimal SHA-256 — built from the AEAT
technical documents it explicitly cites: "Detalle de las especificaciones técnicas para la generación
de la huella o hash de los registros de facturación" **v0.1.2 of 2024-08-27**, and the QR-code one
**v0.5.0 of 2025-12-10**. `generators.spec.ts` **reproduces the AEAT's two official worked
examples** — case 1, first record with no chain, and case 2, a record chaining the previous one —
hard-coding the authority's published SHA-256 values. All 39 tests pass.

> This is **L3-grade evidence** on this audit's own scale: a test checked against a vector published
> by the authority. My phase-0 inventory missed it, having probed the *format* providers and never
> the *reporting* generators.

**The defect, precisely.** The `previousHuella` parameter defaults to `''`, and **no caller ever
supplies it** — checked across the whole repository. `handlers.ts:185` even documents this
explicitly, and `generators.ts:695` carries a `TODO(seam)` saying that reading the previous record
backward is deliberately left to the I/O layer. Consequence: **every record is emitted with
`PrimerRegistro='S'`** — the system produces a chain of length one, repeated indefinitely, when the
whole evidentiary value of the scheme lies in the chaining.

**So what is missing is not a legal source, it is a query.** The `TODO(seam)` itself describes the
fix: read, per issuer, the huella of the last VERIFACTU record via `ReportingStore`, and pass it to
the generator. No further legal research is needed for this — which moves the F-018 sequence (see
`06-REMEDIATION.md`).

**ES-D12 — the QR URL is that of a verifiable system, which the product is not.** *(new)*

The AEAT document "Detalle de las especificaciones técnicas del código QR de la factura…"
**v0.5.0 of 2025-12-10**, obtained and read, distinguishes **two axes**, not one:

| | Test environment | Production |
| --- | --- | --- |
| **5.1** System issuing **verifiable** invoices | `prewww2.aeat.es/…/ValidarQR` | `www2.agenciatributaria.gob.es/…/ValidarQR` |
| **5.2** System issuing **non-verifiable** invoices | `prewww2.aeat.es/…/ValidarQRNoVerifactu` | `www2.agenciatributaria.gob.es/…/ValidarQRNoVerifactu` |

The **path** changes with the mode, not just the host with the environment. `generators.ts:656`
hard-codes `…/ValidarQR`, i.e. the URL of a **verifiable system**. But the product transmits nothing
continuously — the reporting handler logs `[MOCK]` (F-016) — it is therefore a **non-verifiable**
system, which should print `ValidarQRNoVerifactu`.

The code comment (`generators.ts:653-655`) describes `prewww2` as a simple pre-production host "to
switch via configuration". That is accurate about the environment — the PDF does describe it as
"Entorno de pruebas (Portal de Pruebas Externas)" [Test environment (External Test Portal)] — but it
**misses the second axis**: switching the host still leaves it on the verifiable-invoices path.

> This defect closes back onto indicator **1.e** of the responsible declaration (see
> `09-F018-ES-DECLARATION.md` §5): the printed QR tells the recipient the system operates in a mode
> it does not actually hold to. This is not one more divergence, it is the same inconsistency seen
> from the invoice's side.

**ES-D13 — the registro's timestamp is in UTC, not Madrid local time.** *(new — axis 2, conditional)*

`generators.ts` produces `FechaHoraHusoGenRegistro` with a fixed `+00:00` offset:

```ts
const fechaHoraHusoGenRegistro = `${new Date().toISOString().slice(0, 19)}+00:00`;
```

The field name says it — *huso* means time zone. The AEAT's worked examples use Madrid's local
offset (`+01:00` in winter, `+02:00` in summer). The value produced is **syntactically valid** — it
follows the specification's pattern, which is why the test vectors pass — but it does not declare
the Spanish time zone.

**Correcting an earlier phrasing of this divergence.** It claimed that "a check that recomputed the
huella from the locally expected timestamp would not recover the stored value". That is misleading: a
verifier recomputes the huella from the fields **of the submitted record**, not from a guessed
timestamp. The chain is therefore **self-consistent and verifiable** regardless of the offset
written — as the format constraint itself notes, since the offset is explicit, the instant is
unambiguous. The real risk is narrower, and it is twofold:

1. **Does the AEAT validate that the offset matches Spanish legal time?** Unknown. If so, every
   registro is rejected on submission — hence axis 2, **under this condition**.
2. **The convention is sealed into an append-only chain.** Nothing breaks cryptographically if the
   system switches to Madrid time later — each record hashes its own value — but the chain would then
   carry two successive time-zone conventions, which a check would read as an anomaly. This is what
   makes the question urgent now, not the day Spanish transmission starts working.

**Why this is not fixed.** The most defensible fix would be the *domicilio fiscal*'s time zone for
the emisor. **It is not available**: the production path (`invoices.helpers.ts:128-133`) builds
`supplier` with `legalName`, `countryCode`, `role` and `identifiers` — **with no address**.
`PartyTaxProfile.address` exists but is never populated by this constructor, so the generator only
has the **country**, not the region.

And the country is not enough: mainland Spain and the Balearics are on `Europe/Madrid`, the
**Canaries on `Atlantic/Canary`**, one hour behind. Coding `Europe/Madrid` on the sole basis of
`countryCode === 'ES'` would therefore be right for most taxpayers and **wrong by one hour** for
Canary Islanders — writing that wrong value into an immutable chain. The repository knows how to
convert (`company-lookup/providers/shared.ts:17`, `localDate(timeZone)` via `Intl.DateTimeFormat`);
what is missing is not the tool, it is **the input data**.

> `open_question` — **two distinct questions, and the first is enough to unblock.**
>
> 1. **Does the AEAT reject a `FechaHoraHusoGenRegistro` whose offset is not Spanish legal time, or
>    does it accept any explicit offset that names the right instant?** What would settle it: the
>    submission service's published validation rules (the AEAT's error-code list, which enumerates
>    format rejections), or a real round trip on `preportal.aeat.es` — blocked by **S2**, the access
>    prerequisites not being documented.
> 2. **If the time zone must be Spanish, which one for a Canary Islands taxpayer?** What would settle
>    it: art. 3.1's scope regarding the Canaries, to be handled alongside the nexus question (**D2**)
>    rather than separately.
>
> As long as the first stays open, **fix nothing**: an offset known to be UTC is worth more than a
> presumed-Spanish offset that is wrong by an hour for part of the taxpayers, carved into a chain
> that cannot be rewritten.

**ES-D2 — `reporting: SII + VERIFACTU`: the code is wrong if it stacks them.**
The two regimes are **mutually exclusive**: "El presente Reglamento **no se aplicará** a los
contribuyentes que lleven los libros registros en los términos […] del artículo 62 del Reglamento del
IVA" [This Regulation shall **not apply** to taxpayers who keep their record books under the terms
… of article 62 of the VAT Regulation] (art. 3.3). An `isSiiFiler` flag must arbitrate upstream; no
state exists where both are active.

**ES-D3 — `archival: 10 years`: mislabeled.**
RD 1619/2012 art. 19.1 refers to the LGT without writing a duration. The real floor is **6 years**
(Código de Comercio art. 30.1, via LGT art. 70.2, which requires the longer of the two), on top of a
4-year tax base. The 10 years only apply to bases and deductions pending (LGT art. 66 bis.2) — and
are **insufficient** for real estate, capital-goods adjustment running an extra nine years
(LIVA art. 107.Tres). 10 years is a prudent default, not a rule.

**ES-D4 — `archivedForm: BOTH`: incomplete on two opposable points.**
(a) The **original format** must be retained — native XML, associated data **and signature-verification
mechanisms** (art. 21.1); a PDF rendering is not enough. (b) Retention **outside Spain** is lawful but
subject to **prior notice to the AEAT** (art. 22.2), as is outsourcing outside the EU (art. 19.4).
The profile models neither of these two reporting obligations.

**ES-D5 — `numbering: GAPLESS_SELF`: not sourced, and incomplete.**
The text only requires "la numeración […] **dentro de cada serie** será correlativa" [numbering …
**within each series** must be sequential]. The ban on gaps is written nowhere → `open_question`.
More importantly, the profile ignores the **mandatorily separate series**: corrective invoices,
self-billing (**one series per issuing or receiving third party**), art. 84.Uno.2º.g) LIVA, DA 5ª and
art. 61 quinquies.2 RIVA, and **full vs. simplified once they coexist in the same calendar year**.

**ES-D6 / ES-D7 — `PLAIN_PDF + ES_FACTURAE`: wrong for the B2B mandate.**
RD 238/2026 art. 7.1 requires EN 16931 in one of four syntaxes — **CII, UBL, EDIFACT or Facturae** —
and operators must be able to **convert between all four**. **UBL is the reference syntax** of the
solución pública. PDF is only a **transitional accompaniment** during the first 12 months for
businesses above €8M. Facturae-only is a **B2G** rule (Ley 25/2013 / FACe), not B2B.

**ES-D8 — channels: incomplete on three obligations.**
Missing: **simultaneous filing of a faithful UBL copy** to the AEAT's universal repositorio by every
private platform; **mandatory interconnection** between platforms, within a month; and **reporting of
invoice states** — commercial acceptance or rejection, actual payment — within **four calendar days
excluding weekends and holidays**. Email will not satisfy the B2B mandate.

**ES-D9 — `cancellationAllowed`: ambiguous, and the risk is doing only half of it.**
No deletion exists. Cancellation takes **two distinct, cumulative forms**: an append-only, chained
**registro de anulación** on the Veri\*Factu side, **and** a 100% corrective invoice on the
recipient's side. A single `cancel` that produces only one of the two is non-compliant.

**ES-D10 — `correctionModel: CREDIT_NOTE`: right in principle, incomplete on the rules.**
Missing: the **double anchor** of the 4-year window (*devengo* **or** the occurrence of the
circumstance under art. 80 LIVA), the short windows (2 months in insolvency proceedings, 6 months for
uncollectible debts then 1 month to notify the AEAT, 1 month for an upward re-correction), the **two
representations** allowed — delta or post-correction absolute —, and the ban on correcting upward for
a non-business recipient outside art. 80.

**ES-D11 — no territorial ceiling.**
The profile models neither the exclusion of the **Basque Country and Navarre** (foral regimes,
excluded by tax domicile), nor the specifics of the Canaries, Ceuta and Melilla, nor the exclusion of
transactions carried out via a **permanent establishment abroad** (art. 4.2), nor the fact that a
taxpayer who is **not established but merely NIF-registered is outside the Veri\*Factu scope**.

### What the code gets right — Spain

`regimeBlocking: false` is **accurate**: Veri\*Factu is not a clearance, the AEAT does not validate
the invoice — art. 16 only establishes a presumption of compliance **of the system**, and art. 8.4 of
RD 1619/2012 a presumption of authenticity and integrity **of the invoice**. `immutableAfter: ISSUE`
is accurate, and even understated: immutability is required at the **record** level, append-only,
with a mandatory registro de eventos in non-VERI\*FACTU mode.

### Open questions — Spain

The two most blocking for an implementation: the **AEAT hash technical document** (confirmed
algorithm, concatenation order, separators, encoding) and the **QR** one (literal cotejo-service URL,
parameters, variant per modality). Orden HAC/1177/2024 formally refers to them — **do not implement
the hash or the QR URL without these documents**. Also open: the exact SII-liability criteria (yet it
is precisely the flag that arbitrates ES-D2), publication of the B2B mandate's ministerial order, and
the case of a non-established but registered supplier carrying out a transaction located in Spain
toward an established buyer.

---

---

## MEXICO

### Sources

CFF (art. 28, 29, 29-A, 30) via `sat.gob.mx`; **RMF 2026, DOF 2025-12-28**, reglas 2.7.1.34 and
2.7.1.35; Anexo 20 v4.0; and — the strongest verification in this whole audit — **the authority's own
schemas, vendored in the repository**: `backend/src/compliance/schemas/mx/cfdv40.xsd` and
`catCFDI.xsd`, plus `TimbreFiscalDigitalv11.xsd` retrieved online.

**Version in force as of 2026-08-27: CFDI 4.0.** No later version published or announced.

### Divergences from the code — Mexico

**MX-D1 — `numbering: AUTHORITY_RANGE`: the code is wrong. ✓✓ Verified against the repository's own schema.**

There is **no folio range assigned by the authority** under CFDI. Direct check against
`cfdv40.xsd`:

```
name="Serie" use="optional"
name="Folio" use="optional"
```

The Anexo 20 describes them as being "para **control interno del contribuyente**" [for the
taxpayer's internal control]. The tax identifier is the **`UUID`**, assigned **per document, by the
PAC, at the moment of timbrado** — the `TimbreFiscalDigital` even carries `RfcProvCertif`, "el RFC
del proveedor de certificación […] que genera el timbre fiscal digital" [the RFC of the
certification provider … that generates the digital tax stamp]. The "folio" of CFF art. 29 fr. IV
refers to this UUID, not a range. The range mechanism existed under the CFD/CBB regimes, **now
repealed**.

This is a costly divergence: `AUTHORITY_RANGE` implies pre-allocation, a consumable counter and
exhaustion handling — all of that machinery is **pointless** in Mexico, and will produce dead code at
best, an artificial issuing block at worst. The correct model is the one already needed for KSeF and
SdI: **free internal number + tax identifier returned by the clearance response**.

**MX-D2 — `requiredIdentifiers: RFC + CURP`: the code is wrong. ✓✓ Verified against the repository's own schema.**

`grep -c -i "curp" cfdv40.xsd` → **0**. CURP appears **nowhere** in the CFDI schema: not on
`Comprobante`, not on `Emisor`, not on `Receptor`. It only exists in certain complements, mainly
**Nómina 1.2**, for individuals.

Conversely, `Receptor` requires three fields the profile ignores:

```
Rfc -> required · Nombre -> required · DomicilioFiscalReceptor -> required
RegimenFiscalReceptor -> required · UsoCFDI -> required
```

And `Comprobante` carries `Exportacion` as `use="required"` — export is not out of scope, it is a
**parameterized** case of CFDI.

**MX-D3 — `archival.residency: MX`: the code is stricter than the sourced law.**

The primary sources require **availability at the domicilio fiscal**: "La documentación
comprobatoria […] deberá estar **disponible en el domicilio fiscal** del contribuyente" [Supporting
documentation … must be available at the taxpayer's tax domicile] (CFF art. 28 fr. III), and
retention "**a disposición de las autoridades**" [available to the authorities] (art. 30). **No
primary source stating a ban on storage outside Mexico was found.** The real requirement is an
**access residency**, not a physical data residency. The profile therefore invents a constraint here
— the exact mirror of FR-D4 and DE-D13, where it instead **omits** real ones.

**MX-D4 — `archival: 5 years`: duration correct, starting point wrong.**
CFF art. 30 counts the five years **from the filing of the relevant return**, not from the invoice's
issuance. And retention is **perpetual** for incorporation documents, capital movements, mergers,
spin-offs, dividend distributions and transfer-pricing records — and runs until a dispute-ending
ruling becomes **final**.

**MX-D5 — `cancellationAllowed: true`: a boolean cannot carry this rule.**
Cancellation is **bilateral by default** — recipient acceptance, **implied after three days**
(RMF 2026 regla 2.7.1.34) — except for hydrocarbons and fuel Carta Porte, where **express**
acceptance is required and silence therefore does not mean agreement. It requires a **motivo**
(`01`…`04`), with `01` requiring the UUID of the replacing CFDI. It is **blocked** while a linked
document is still *vigente*. It is bounded to **the fiscal year of issuance**. And twelve limitative
cases (regla 2.7.1.35) exempt it entirely from acceptance.

**MX-D6 — `correctionModel: CREDIT_NOTE`: incomplete.**
Missing is the **cancellation + substitution** path — `motivo 01` with the UUID of the substitute,
then a new CFDI carrying `TipoRelacion = "04"` ("Sustitución de los CFDI previos"). This is the
**normal** path for correcting an error in Mexico. The nota de crédito (`TipoDeComprobante = E` +
`TipoRelacion 01`) only covers adjusting a transaction that still stands.

### What the code gets right — Mexico

Blocking `CLEARANCE`, `PAC` channel, `CFDI` syntax, `immutableAfter: CLEARANCE`,
`archivedForm: AUTHORITATIVE_XML`, `integrity: SIGNED` and `reporting: none` are **all accurate**.
The `SelloSAT` seals the XML and any post-timbrado modification invalidates it. Along with Germany,
this is the profile with the best-grounded core.

### Territorial scope — unilateral trigger, bilateral lifecycle

The obligation to issue depends **exclusively on the issuer's status** (Mexican tax resident or
permanent establishment). The buyer's country **never** conditions applicability: it only changes
field contents (`Exportacion`, generic foreign RFC, `ResidenciaFiscal`, `NumRegIdTrib`, Comercio
Exterior complemento where relevant).

**Direct consequence for the `f6888eb2` fix**: the hard-block on an unresolved buyer country is
correct for VAT, but **must not be reused to decide whether a CFDI is owed**. In Mexico, an unresolved
buyer address must never disable issuance — at worst it should block on the `Exportacion` / generic
RFC choice.

The **lifecycle**, on the other hand, is bilateral and timed: it is a direct use case for the
event-sourced runtime — `COMMAND(cancel)` → `AWAIT_CALLBACK` + `ARM_TIMER(3 days)` →
`INBOUND_STATUS` or `TIMER_ELAPSED`. With two traps: the twelve exceptions must be evaluated **before**
arming the timer, and for hydrocarbons **the timer must never conclude**.

---

---

## TERRITORIAL SCOPE — the cross-border dimension

This section answers the question added to the questionnaire. **Only France could be completed**:
the other five agents were cut off by a service limit (see "Phase 2 status").

### France — the mandate is bilateral, and it is domestic

**[CGI art. 289 bis, I](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044051178/2026-08-27)**,
version in force as of 2026-02-21 (LOI no. 2026-103 of 2026-02-19, art. 123) — the obligation applies
when "**l'émetteur de la facture et son destinataire sont des assujettis qui sont établis ou ont leur
domicile ou leur résidence habituelle en France**" [the invoice's issuer and its recipient are
taxable persons established, domiciled or habitually resident in France].

Three consequences, all contrary to what the engine assumes:

1. The criterion is **establishment**, domicile or habitual residence. **French VAT registration is
   not a nexus criterion.**
2. The condition is **bilateral and cumulative**: it applies to **both parties**.
3. Cross-border is **outside the mandate**; art. 289 bis V further excludes exempt intra-Community
   supplies (art. 262 ter, 1° of I).

Confirmed by the authority, DSE v3.2 §2.3.1: the scheme targets "**transactions domestiques** entre
assujettis à la TVA **établis, domiciliés ou ayant leur résidence habituelle en France**" [domestic
transactions between VAT-liable persons established, domiciled or habitually resident in France].

### What replaces the mandate cross-border: e-reporting

[CGI art. 290](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000046195617/2026-08-27) and
art. 290 A, applicable to transactions carried out **as of 2026-09-01**, following the same two waves
as e-invoicing.

| Situation | E-invoicing (289 bis) | E-reporting |
| --- | :-: | --- |
| Both taxable persons established in France | **yes** | not applicable |
| Not established, but **VAT-registered** in France | **no** | **yes** — art. 290, II |
| Established in France, transaction **located abroad** | **no** | **yes** — art. 290, I-1° |

Format: **F10 flow**, XML, distinct from F1 (`tar.gz`, UBL 2.1 or CII D22B). Own statuses:
**300 Déposée / 301 Rejetée**. **Periodic** cadence tied to the VAT regime (ten-day, monthly or
bimonthly depending on the regime), not transactional. Correction via the **RE** flow, which "annule
et remplace l'ensemble des données agrégées" [cancels and replaces the whole set of aggregated data]
for the period — a *replace-period* model with nothing in common with e-invoicing's credit note or
corrective invoice.

### Why this makes F-017 worse

The French mandate's triggering fact is the **joint establishment of both parties**. Without knowing
the **recipient's** establishment status, the engine cannot choose between two disjoint regimes — two
formats, two clocks, two correction models:

- e-invoicing: F1, accredited platform, 200/210/212/213 lifecycle, 24 h;
- e-reporting: F10, periodic, correction by replacing the period.

A `country = FR` derived from the supplier alone will produce an e-invoicing flow for transactions
that actually fall under art. 290 — and will miss the art. 290 II e-reporting obligation for a
supplier not established but VAT-registered in France, which the engine will classify as outside
French scope.

### Italy — bilateral mandate, unilateral reporting, and registration triggers nothing

Art. 1 c. 3 of D.Lgs. 127/2015, consolidated text verified as of 2026-08-27: the obligation targets
transactions "effettuate **tra soggetti residenti o stabiliti nel territorio dello Stato**" [carried
out **between persons resident or established in the territory of the State**]. The same bilateral
condition is repeated **word for word** in c. 6 for the penalty ("la fattura si intende non emessa"
[the invoice is deemed not issued]). C. 3-bis, on the other hand, only requires resident-or-established
status **of the transmitting party**: "I soggetti passivi di cui al comma 3 **trasmettono** […] i dati
[…] verso e da soggetti non stabiliti" [The taxable persons referred to in paragraph 3 **transmit**
… the data … to and from non-established persons]. **Two triggers of a different nature within the
same article.**

**Registration triggers nothing — and this is explicit.** The word `identificati` was **explicitly
removed** from art. 1 c. 3; the 2018 provvedimento still carried it in its title, the 2022 one no
longer does. The AdE:

> "[…] tra i soggetti "stabiliti" **non possono essere inclusi i soggetti non residenti meramente
> identificati**" [among "established" persons, non-resident persons who are merely registered
> **cannot be included**] — Circolare 13/E of 2018-07-02, §1.2
>
> "[…] espungendo, dall'articolo 1, comma 3 […] il riferimento ai soggetti identificati (tramite
> identificazione diretta ovvero rappresentante fiscale), **i quali non sono tenuti alla
> fatturazione elettronica**" [… removing, from article 1, paragraph 3 … the reference to registered
> persons (via direct registration or a fiscal representative), **who are not subject to electronic
> invoicing**] — Circolare 14/E of 2019-06-17, §1.2

**Permanent establishment: a property of the transaction, not of the entity.** Art. 1 c. 3 does not
define "stabilito" and borrows the VAT concept from art. 7 c. 1 lett. d) of DPR 633/1972:

> "[…] ovvero una **stabile organizzazione** nel territorio dello Stato di soggetto domiciliato e
> residente all'estero, **limitatamente alle operazioni da essa rese o ricevute**" [… or a permanent
> establishment in the territory of the State of a person domiciled and resident abroad, **limited to
> the transactions rendered or received by it**]

Confirmed by AdE Risposta n. 374/2023, which ties the rule to art. 192 bis of the VAT directive and
the "intervention" test of art. 53 of regulation 282/2011 — specifying that "lo svolgimento di
**meri compiti di supporto amministrativo, quali la contabilità, la fatturazione** o il recupero
crediti, **non è sufficiente**" [carrying out **purely administrative support tasks, such as
bookkeeping, invoicing** or debt collection, **is not sufficient**]. The v1.9.1 technical
specifications draw the consequence: the `StabileOrganizzazione` block is only mandatory "nei soli
casi in cui […] effettua **la transazione oggetto del documento** tramite stabile organizzazione"
[in the only cases where … it carries out **the transaction the document concerns** through a
permanent establishment].

**Reporting c. 3-bis — verified.** Outbound **and** inbound scope ("effettuate e ricevute verso e
da"). Deadlines: outbound "entro i termini di emissione delle fatture" [within invoice-issuing
deadlines]; inbound "entro il quindicesimo giorno del mese successivo a quello di ricevimento del
documento **o di effettuazione dell'operazione**" [by the 15th day of the month following that of
the document's receipt **or of the transaction taking place**] — the second, alternative term is
often left out. Exclusion to wire in: territorially non-relevant purchases (art. 7 to 7-octies)
**≤ €5,000 per transaction**.

**Single channel since 2022-07-01**: the data goes through the SdI in the ordinary invoice format;
files using the old schema dated after 2022-06-30 "**verranno scartati**" [will be rejected]. The
standalone esterometro only survives for earlier triggering events.

**Technical discriminant**: there is **no dedicated `TipoDocumento`** for the c. 3-bis outbound
flow. The only marker is `CodiceDestinatario = XXXXXXX`, valid **if and only if** `IdPaese ≠ IT` —
otherwise rejection **00313**. `0000000` covers the distinct case of voluntary issuance to a party
identified via its Italian partita IVA. These are two disjoint branches, not a fallback. Inbound:
TD17 (foreign services), TD18 (intra-Community goods), TD19 (art. 17 c. 2), TD28 (San Marino).

### Germany — bilateral conjunctive trigger, and three distinct establishment tests

Sources: UStG "zuletzt geändert durch Art. 5 G v. 29.6.2026"; **consolidated UStAE, Stand
2026-04-09**; BMF-Schreiben of 2025-10-15; BMF FAQ E-Rechnung, Stand March 2026.

**§ 14 Abs. 2 Satz 2 Nr. 1**: the invoice is electronic "wenn der leistende Unternehmer **und** der
Leistungsempfänger im Inland […] ansässig sind" [if the supplying business **and** the recipient of
the supply are established in the domestic territory]. And the UStAE settles the opposite case
unambiguously:

> "Ist **mindestens einer** der am Umsatz beteiligten Unternehmer nicht im Inland […] ansässig,
> besteht **keine Pflicht** zur Ausstellung einer E-Rechnung" [If **at least one** of the businesses
> involved in the transaction is not established in the domestic territory …, **there is no
> obligation** to issue an E-Rechnung] — UStAE Abschnitt 14.1 Abs. 6 S. 3

The fallback regime is neither a ban nor an obligation: paper remains **always lawful**, and
electronic — E-Rechnung as well as PDF — is lawful **with the recipient's consent** (§ 14 Abs. 1
S. 5), consent that "bedarf **keiner besonderen Form**" [requires **no particular form**] and can be
**implied**, given via terms and conditions, or even given **after the fact** (UStAE 14.1 Abs. 7).

**The territory is not "Germany".** The test covers "im Inland **oder in einem der in § 1 Absatz 3
bezeichneten Gebiete**" [the domestic territory **or one of the areas referred to in § 1 paragraph
3**] — free ports, waters and mudflats. An engine testing `country == "DE"` is under-inclusive.

**A permanent establishment only counts if it participates** — § 14 Abs. 2 Satz 3:

> "[…] eine Betriebsstätte, **die an dem Umsatz beteiligt ist** […]" [… a permanent establishment
> **that is involved in the transaction** …]

And the doctrine spells out what "participating" excludes:

> "**Nicht als Nutzung** […] gelten **unterstützende Arbeiten** durch die Betriebsstätte wie
> **Buchhaltung, Rechnungsausstellung oder Einziehung von Forderungen**." [**Supporting work** by
> the permanent establishment, such as **bookkeeping, invoicing or debt collection**, **does not
> count as use**.] — UStAE 13b.11 Abs. 1 S. 5

With a **self-referential** rule worth knowing: putting the permanent establishment's VAT number on
the invoice **amounts to a presumption of participation** (UStAE 13b.11 Abs. 1 S. 6, referring to
art. 53 of regulation 282/2011). In other words, the VAT number chosen for the invoice decides the
obligation that applies to that same invoice.

**Registration appears in none of the four branches** of § 14 Abs. 2 S. 3. The BMF does not phrase it
that way but draws the operational consequence (FAQ Frage 3): a foreign taxable person registered
with no establishment "können auf diesen Umstand in ihrer Rechnung hinweisen, um zu begründen, warum
sie **keine E-Rechnung** stellen" [may point to this fact on their invoice to explain why they are
**not issuing an E-Rechnung**], and the recipient may rely on it.

#### Three distinct establishment tests within the UStG alone

This is the heaviest point for modeling, and it appears nowhere in the profile:

| Use | Basis | Definition |
| --- | --- | --- |
| **Issuing** trigger | § 14 Abs. 2 S. 3 | Sitz, Geschäftsleitung, **participating Betriebsstätte**, or absent a Sitz: Wohnsitz / gewöhnlicher Aufenthalt |
| **Receiving** obligation | UStAE 14.1 Abs. 5 S. 1; FAQ Frage 12 | **unilateral** — applies only to the established recipient |
| **Archival** location | § 14b Abs. 3 | **Wohnsitz** (no condition), Sitz, Geschäftsleitung, or **Zweigniederlassung** — not "participating Betriebsstätte" |

A single `isEstablishedDE` boolean therefore cannot serve all three.

#### § 14 Abs. 7 — art. 219 bis transposed, and it flips the problem

> "[…] so gelten **abweichend von den Absätzen 1 bis 6** für die Rechnungserteilung die
> **Vorschriften des Mitgliedstaats**, in dem der Unternehmer seinen Sitz, seine Geschäftsleitung,
> eine Betriebsstätte, von der aus der Umsatz ausgeführt wird […] hat." [… then, **by way of
> derogation from paragraphs 1 to 6**, invoicing is governed by the **rules of the Member State** in
> which the business has its seat, place of management, or a permanent establishment from which the
> transaction is carried out …]

When the supplier is not established in Germany and the customer is liable under § 13b — and
**unless** there is a self-billing agreement (S. 2) — it is no longer German law that governs
invoicing, but that of the **supplier's** state.

This is exactly the derogation in art. 219 bis of directive 2006/112/EC. It has an uncomfortable
consequence for the audit: in this specific case, the engine's "supplier-only" resolution gives the
**right** result. But it gives it without knowing the condition that authorizes it — so it would
apply it just as readily in cases where it is wrong. A rule that is right by accident is not a rule.

#### Zusammenfassende Meldung — what covers cross-border

§ 18a UStG, filed with the Bundeszentralamt für Steuern, **outbound only**. Scope: intra-Community
supplies and § 3a Abs. 2 services taxable in another member state where the customer is liable.
Out of scope: third-country exports, acquisitions, received services, B2C, Kleinunternehmer.
Deadline: **the 25th day** after the month (goods; quarterly option under €50,000) or after the
quarter (services). Penalty: Bußgeld up to **€5,000**, no Verspätungszuschlag.

**No invoice transmission is attached to it**: § 18a Abs. 7 limitatively lists each buyer's VAT
number, the **sum** of the bases per buyer, and nature indicators. No invoice number, no date, no
line, no document. It is a periodic per-customer aggregate.

The transactional `Meldesystem` remains `announced` with no text and no date: the JStG 2026
government bill does not contain it, and touches neither § 14 nor § 27 Abs. 38.

### Poland — a **unilateral** trigger, which invalidates a generalization

Sources: consolidated text of the ustawa o VAT (Dz.U. 2025 poz. 775), overlaid by the law of
2025-08-05 (Dz.U. 2025 poz. 1203); **Objaśnienia podatkowe MF of 2026-01-28** on the
`stałe miejsce prowadzenia działalności` (SMPD, fixed establishment) for KSeF purposes — a document
opposable under art. 14n § 4 pkt 1 of the Ordynacja podatkowa. Negative check performed: the later
amending acts (Dz.U. 2025 poz. 1811 and Dz.U. 2026 poz. 846) touch neither art. 106a, nor 106ga, nor
106gb.

Art. 106ga ust. 2 sets the nexus by **negative exclusion**, and its points 1 and 2 are both phrased
"**przez podatnika**" [by the taxpayer] — by the **issuing** taxable person:

> 1) "przez podatnika nieposiadającego siedziby działalności gospodarczej ani stałego miejsca
> prowadzenia działalności gospodarczej na terytorium kraju [by a taxpayer having neither a
> registered office nor a fixed establishment in the national territory];
> 2) przez podatnika nieposiadającego siedziby […] who has an SMPD in the national territory,
> **przy czym to stałe miejsce prowadzenia działalności nie uczestniczy w dostawie towarów lub
> świadczeniu usług**, dla których wystawiono fakturę" [provided that **this fixed establishment does
> not participate in the supply of goods or services** for which the invoice was issued]

The only point where the buyer appears is pkt 4, and it only covers their **status** (a non-business
private individual), never their location. The ministry states it explicitly:

> "Podatnicy z siedzibą na terytorium Polski, nabywający towary lub usługi od podatników z siedzibą
> za granicą, **dla celów stosowania KSeF nie są zobowiązani do dokonywania weryfikacji, czy taki
> zagraniczny podatnik posiada SMPD w Polsce**." [Taxpayers established in Poland who purchase goods
> or services from taxpayers established abroad **are not, for KSeF purposes, required to check
> whether that foreign taxpayer has an SMPD in Poland**.]

**Consequences:**

| Situation | KSeF issuing |
| --- | --- |
| Foreign taxpayer **registered** in Poland, no establishment | **no** — art. 106ga ust. 2 pkt 1; option open and **revocable transaction by transaction** |
| Foreign taxpayer with a Polish SMPD **participating** in the transaction | **yes** |
| Foreign taxpayer with a **passive** Polish SMPD | **no** |
| Polish taxpayer carrying out **intra-Community supply, export, intra-Community B2B service** | **yes** — "Faktury dokumentujące np. WDT, eksport towarów czy świadczenie usług na rzecz zagranicznych podatników są **obowiązkowo wystawiane w KSeF**" [Invoices documenting e.g. intra-Community supplies, goods exports or services to foreign taxpayers **must be issued in KSeF**] |

**Poland therefore does not exclude cross-border from the mandate** — unlike France and Italy. It
keeps it within the scope of **issuing**, and handles foreignness at the next, separate step:
**delivery**. Art. 106gb ust. 4 is a **six-branch disjunction** whose first branch is purely
geographic (`miejsce świadczenia ∉ PL`), requiring delivery "w sposób z nim uzgodniony" [in a manner
agreed with them] together with a mandatory **QR code** (art. 106gb ust. 5, specified by Dz.U. 2025
poz. 1815, standard ISO/IEC 18004:2024). For the foreign buyer, the document carrying the QR **is**
the invoice.

Side effect to model: **two receipt-date clocks** — the date the KSeF number is assigned for an
ordinary buyer, the date of actual receipt outside KSeF for any buyer falling under art. 106gb ust. 4.

The only truly cross-border exception: **self-billing** by an EU buyer with no Polish NIP
(rozporządzenie Dz.U. 2025 poz. 1740, § 2 pkt 5 and § 3).

### The generalization I am withdrawing

I had written that the verified jurisdictions all showed "the same pattern: a domestic mandate with a
bilateral trigger, cross-border pushed to a separate reporting obligation". **That is wrong.** Poland
is unilateral and keeps cross-border within the scope of issuing.

The correct finding is stronger, not weaker:

| Country | Trigger | Cross-border |
| --- | --- | --- |
| France | **bilateral** (art. 289 bis I) | outside the mandate → e-reporting art. 290 |
| Germany | **bilateral** (§ 14 Abs. 2 S. 3 UStG) | outside the mandate → ZM § 18a |
| Italy | resident or established (to be refined) | outside the mandate → c. 3-bis data reporting |
| **Poland** | **unilateral — seller only** | **within the mandate**, foreignness handled at the delivery channel |

**The nexus rule varies from country to country.** A single resolution strategy is therefore wrong
whichever choice is made: the engine's "supplier-only" resolution happens to be right for Poland and
wrong for France and Germany. This does not rehabilitate F-017, it makes it worse — it is not enough
to add the buyer's country, **the trigger itself must be a datum of the profile**, on the same
footing as the regime or archival.

### Spain — two regimes, two opposite triggers

Covered in the Spain section above. In summary: **Veri\*Factu** is **unilateral** and tied to an
**issuer's tax status**, regardless of the transaction — an invoice to a foreign customer generates a
registro just like a domestic invoice. The **B2B mandate** under RD 238/2026 is, on the contrary,
**bilateral and buyer-dominated**: it triggers "cuando el destinatario […] **tenga en España la sede
de su actividad económica, o tenga en España un establecimiento permanente**" [when the recipient …
**has in Spain the seat of its economic activity, or has a permanent establishment in Spain**]. A
resolution based on the seller gets it wrong **both ways**.

### Mexico — unilateral at issuance, bilateral in the lifecycle

Covered in the Mexico section above. The obligation to issue depends **exclusively on the issuer's
status**; the buyer's country never conditions applicability, it only changes field contents
(`Exportacion`, generic foreign RFC, `ResidenciaFiscal`). **Cancellation**, on the other hand, is
bilateral and timed — recipient acceptance, implied after three days.

---

---

## ViDA — verified against the primary source

Directive (EU) 2025/516, consolidated text on
[EUR-Lex, CELEX 32025L0516](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32025L0516),
consulted **2026-08-27**. Published in the OJ: **2025-03-25** (L series, 2025/516).

| Provision | Established content | Status |
| --- | --- | --- |
| **Art. 6(1)** | "Member States may apply the laws, regulations and administrative provisions regarding Article 1, points 2 and 3 **from 14 April 2025**" — i.e. the amendments to art. 218 and 232 of directive 2006/112/EC | **in force** |
| **Art. 6(4)** | Article **4**: adoption by 2029-06-30, application on **2029-07-01** | announced |
| **Art. 6(5)** | Article **5**: adoption by 2030-06-30, application on **2030-07-01** | announced |
| **Art. 6(5), 3rd subparagraph** | **Deferral to 2035-01-01** — an operative provision, see below | announced |
| **Art. 5 → new art. 218** | Requires an electronic invoice compliant with **the European standard** and its list of syntaxes under **directive 2014/55/EU**, with structured data per art. 262 and 271b | announced, 2030-07-01 |
| **Art. 5 → new art. 232** | An electronic invoice compliant with the European standard **does not require the recipient's acceptance**; other formats may remain subject to it under national law | announced, 2030-07-01 |
| **Art. 5(6) → art. 222** | Issuance "**no later than 10 days following the chargeable event**" | announced, 2030-07-01 |
| **Art. 7** | Entry into force "on the **twentieth day** following that of its publication" — published in the OJ on 2025-03-25, directive adopted in Brussels on **2025-03-11** | in force |

### The deferral to 2035: established, and it is an operative provision

*Correction. Two successive HTML renders of the CELEX page were truncated at the same spot, and I
had recorded the deferral as not established, noting that a recital is not an operative provision.
The Official Journal PDF, converted locally, gives the text. I had also mistakenly attributed the
2030-07-01 date to art. 6(4): that one covers **article 4** and 2029-07-01. It is art. 6(5) that
covers article 5.*

Third subparagraph of art. 6(5), verbatim:

> "By way of derogation from the second subparagraph of this paragraph, Member States **having a
> domestic digital real-time transaction-based reporting obligation in place on 1 January 2024** or
> having been granted an authorisation on the basis of Article 395 before 1 January 2024 allowing
> them to put such an obligation in place, or where such authorisation was not necessary, having
> adopted national legislation before 1 January 2024 providing for the introduction of such a
> domestic digital real-time transaction-based reporting obligation, **shall apply the measures
> regarding Article 5, point (5), related to Article 218, and the measures regarding Article 5,
> point (19), related to Articles 271a and 271b, by 1 January 2035**, in so far as **domestic**
> electronic invoicing and reporting are concerned."

Three alternative eligibility routes: an obligation **already in place** on 2024-01-01; an
**art. 395 authorization** obtained before that date; or, if authorization was not necessary,
**national legislation adopted** before that date providing for the introduction of such an
obligation.

The deferral is **bounded**: it only covers art. 218 and art. 271a/271b, and **only for domestic
invoicing and reporting**. Intra-Community remains at 2030-07-01. A review clause also lets the
Commission propose a further deferral if the interim report under art. 271c reveals gaps.

**Practical scope.** Spain (SII since July 2017), Italy (SdI) and Hungary clearly fall under the
first route; France and Poland, whose schemes were adopted before 2024, fall at least under the
third. A profile coding "EN 16931 mandatory on 2030-07-01" for these countries would therefore be
five years too strict for their domestic scope.

### Does Spain open one of the three routes? — analysis, and what remains open

The question deserves to be asked route by route rather than left as a block.

| Art. 6(5) route | Application to Spain | Verdict |
| --- | --- | --- |
| 1. Obligation **in place** on 2024-01-01 | **The factual predicate is met**: the SII has run since **July 2017**, it is mandatory, and it covers **invoice-by-invoice** records — hence transactional. Only the qualifier remains open: SII submission is **within four business days**. | **met, except for one qualifier** |
| 2. **Art. 395 authorization** obtained before 2024-01-01 | Spain does not appear in the Commission's "Articles 218 and 232" derogations, and never requested one. | **no** |
| 3. **National legislation adopted** before 2024-01-01 providing for the introduction of such an obligation | **RD 1007/2023 is dated 5 December 2023**, so before 2024-01-01, and it establishes Veri\*Factu — whose verifiable modality is defined by an "**automática, continua e instantánea**" [automatic, continuous and instantaneous] submission of records. | **appears to be met** |

**Route 3 is the strongest**, and it does not depend on how the SII is classified: the adoption date
is verifiable, and "automática, continua e instantánea" matches "real-time transaction-based" word
for word. If it is retained, **Spain's domestic horizon shifts from 2030-07-01 to 2035-01-01**, and
the whole ES section must be read against that deadline.

### `open_question` — phrased factually, to be searchable

What remains open is not "Spain's legal classification". It is **a question of fact, down to a
threshold**:

> **Does submission within four business days, invoice by invoice, qualify as "real-time
> transaction-based" within the meaning of the third subparagraph of art. 6(5)?**

Phrased this way, it becomes searchable, and three places could settle it:

1. **The directive's recitals** — recital 24 discusses pre-existing domestic systems; it has not been
   read line by line from this angle.
2. **A Commission position** — the review clause of art. 271c gives it authority to assess national
   schemes, which presupposes knowing which ones fall under the deferral.
3. **Another member state's practice** — Hungary (RTIR, near-instant) and Italy (SdI, continuous) are
   clearer cases. If one of them publicly claims the deferral, the threshold can be read by
   comparison.

Two things are however **established**: route 2 is **excluded**, and route 3 rests on a **verified
date**, RD 1007/2023 being dated 2023-12-05.

One route is enough: if route 3 is retained, route 1's fate becomes moot. The full enumeration is
covered so that no gap reads as an oversight.

**Immediate consequence, dated 2025-04-14**: a member state no longer needs a Council derogation
under art. 395 to impose domestic electronic invoicing without the recipient's acceptance. The option
now sits directly in the directive. This explains why neither France nor Spain had to request one for
their recent schemes.

### What remains open on ViDA

1. **EN 16931-1:2026**: the directive refers to "the European standard […] under directive
   2014/55/EU" **without naming a version**. Whether a 2026 version was published by CEN in March
   2026, and whether it is "frozen", **has not been verified** and does not appear in the directive's
   text. `open_question`.
2. Whether the Spanish SII (four-day submission) qualifies as "real-time" under the third
   subparagraph of art. 6(5) — the directive does not define the term.

---

# SIX-COUNTRY SUMMARY

Phase 2 is complete. Three cross-cutting findings, each verified across several jurisdictions.

## 1. Numbering is wrong in five countries out of six

| Country | What the profile declares | What the law requires |
| --- | --- | --- |
| France | `GAPLESS_SELF` | **accurate** — "chronological **and continuous** sequence" |
| Germany | `GAPLESS_SELF` | **wrong** — "**einmalig**" [unique]; "eine lückenlose Abfolge […] ist nicht zwingend" [a gapless sequence … is not mandatory] |
| Poland | `GAPLESS_SELF` | over-constrained — only **uniqueness** is checked |
| Italy | `GAPLESS_SELF` | **wrong** — "numero progressivo che la identifichi in modo **univoco**" [a progressive number that identifies it **uniquely**] |
| Spain | `GAPLESS_SELF` | not sourced — "correlativa **dentro de cada serie**" [sequential **within each series**], the ban on gaps is written nowhere; and **five cases of mandatorily separate series** are ignored |
| Mexico | `AUTHORITY_RANGE` | **wrong** — `Serie` and `Folio` are `optional`, the UUID comes from the PAC |

**Only one country out of six is correctly modeled.** And the comparison with **F-002** is cruel: the
product imposes a constraint that five of its six markets do not require — while failing to enforce
it where it actually is required.

## 2. Archival is poorly modeled in all six

| Country | Profile | Reality |
| --- | --- | --- |
| France | 10 years | **6 years** tax (LPF L102 B); the 10 years are commercial |
| Germany | 10 years | **8 years** since 2025-01-01 (§ 14b Abs. 1 S. 1) |
| Italy | 10 years | 10 years **extended** until controls are settled |
| Poland | 10 years, borne by the taxpayer | 10 years **borne by KSeF**, the taxpayer is **exempted** |
| Spain | 10 years | floor of **6 years**, up to ~14 years for real estate |
| Mexico | 5 years from issuance | 5 years **from the filing of the return**, perpetual for certain acts |

None of the six is right. And **data localization** is wrong in both directions: France (LPF
L102 C), Germany (§ 14b Abs. 2, prior authorization outside the EU) and Italy impose constraints the
profiles **omit**, while Mexico is **saddled** with a residency requirement the sourced law does not
require.

## 3. The unlawful channel — one country, not three

**Correcting an earlier draft of this summary.** I had written that `EMAIL` appeared in the FR, PL
and IT profiles and was unlawful in all three. That is true for **France only**.

The profiles are **time-based**, and two of the three already make the right split: Poland drops
email on **2026-02-01** for KSeF, Italy on **2019-01-01** for the SdI. Only France kept it in its
post-2026-09-01 period.

The error came from my own inventory, which deliberately flattens **all** periods — a defensible
choice for an audit, which needs to see lapsed rules, but one that makes the result unusable as-is for
judging the current state. Any reading of `profile.channels` in `inventory.json` carries this bias.

What remains, and is the real point: removing `EMAIL` from France strips it of **the only channel
that worked with no configuration**. PDP and Peppol require credentials, Chorus Pro has no transport
at all. An unconfigured France therefore now issues nothing at all — which is the correct outcome,
now visible rather than masked by a non-compliant channel.
