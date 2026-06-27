# Dépendances par format de facture

> Quelle bibliothèque / quel outil pour **générer** et **valider** chaque format câblé dans
> `COMPLIANCE_BUILD_ORDER.md`. Établi par recherche (état mi-2026). Distingue : **lib TS in-process**
> (intégrable directement) · **custom** (on construit le XML depuis le XSD) · **service externe**
> (PAC/portail = canal, pas format). Voir aussi `einvoice-cii-validation-gotcha` (mémoire).

## Pourquoi on change de lib EN 16931
`@fin.cx/einvoice` (5.x/6.x) **n'émet jamais** `cac:Contact` (BR-DE-11/12 : tél/email vendeur) ni
`cbc:EndpointID` (BR-DE-13 : endpoint acheteur), et son `fromXml` CII a un faux négatif `FX-STRUCT-1`.
Prouvé empiriquement. → remplacer la famille EN 16931 par **`@e-invoice-eu/core`** (vraie impl EN16931,
JSON natif TS, maintenue). À confirmer par spike : qu'elle ferme bien BR-DE-11..14.

## Tableau

| Format (syntaxe) | Pays / usage | Génération (candidat) | Type | Signature | Validation autoritaire |
|---|---|---|---|---|---|
| **EN16931 UBL/CII, Factur-X, ZUGFeRD, XRechnung, Peppol BIS** | FR base, DE, BE, IE, SI, LV, SK, RO, RS, AE, SG… | **`@e-invoice-eu/core`** (reco) · alts : `node-zugferd` (beta 0.1), `@stackforge-eu/factur-x`, `@fin.cx/einvoice` (actuel, limité) | TS in-process | PAdES (Factur-X PDF) | **Mustang** / **KoSIT** (Java CLI) · EC ITB (online) |
| **FatturaPA** | 🇮🇹 IT, SM | **`@digitalia/fatturapa`** (XML↔JSON + validation) · alt `fattura-elettronica` | TS in-process | XAdES (`xadesjs`) | XSD SdI + Schematron |
| **CFDI 4.0** | 🇲🇽 MX | **`@nodecfdi/*`** + `@alexotano/cfdi-sat` ou `virtualxml-cfdi` | TS in-process | sello CSD | **PAC externe** (timbrado → SAT) |
| **Facturae 3.2.2** | 🇪🇸 ES | ⚠️ pas de lib JS dédiée → XML custom + `xadesjs` (réf Java `facturae-java`) | custom + TS sign | **XAdES-EPES** | validateur FACe / XSD |
| **FA_VAT (FA(2)/FA(3))** | 🇵🇱 PL / KSeF | ⚠️ pas de lib JS → XML custom (XSD MF) | custom | scellé KSeF (API) | XSD MF + API KSeF |
| **KSA UBL 2.1 + QR** | 🇸🇦 SA / ZATCA | ⚠️ SDK officiel Java/.NET → UBL custom + QR | custom | crypto ZATCA | API FATOORA |
| **National XML (DTE/NF-e/FE…)** | LATAM (CL/BR/AR/EC/PE…), TR, etc. | ⚠️ par pays, peu de libs JS (ex `facturacionelectronicapy-xmlgen` PY) → XML custom | custom | par autorité | OSE/PAC/portail |
| **myDATA / Online Számla** | 🇬🇷 GR, 🇭🇺 HU | pas un format lib → XML custom + **API REST gouv** | custom + API | token | API gouv |

## Validation (transversal — L2/L3 déjà scaffolés)

| Outil | Couvre | Type |
|---|---|---|
| **Mustang CLI** (`Mustang-CLI-x.jar`) | Factur-X/ZUGFeRD + XRechnung | Java sidecar (offline) |
| **KoSIT** + config XRechnung | EN16931 UBL+CII, CIUS XRechnung | Java sidecar (offline, **référence**) |
| **EC ITB** `itb.ec.europa.eu/invoice` | EN16931 UBL/CII | REST online |
| **saxon-js + Schematron EN16931** (`ConnectingEurope/eInvoicing-EN16931`) | EN16931 | pur JS (offline) |

## Lecture / risques
- **In-process TS** (intégrable direct) : EN16931 (e-invoice-eu), FatturaPA, CFDI.
- **custom** : Facturae, FA_VAT, KSA, LATAM, GR/HU → XML construit nous-mêmes (XSD + sérialiseur). Gros du travail.
- **services externes obligatoires** : CFDI (PAC), KSeF, ZATCA, OSE LATAM = **canaux** (BLOC C), pas des libs.
- `node-zugferd` = beta 0.1, ne pas en faire un socle. `@e-invoice-eu/core` = le pari sérieux.

Sources : [@e-invoice-eu](https://github.com/gflohr/e-invoice-eu) · [node-zugferd](https://github.com/jslno/node-zugferd) ·
[@digitalia/fatturapa](https://www.npmjs.com/package/@digitalia/fatturapa) · [NodeCfdi](https://github.com/nodecfdi) ·
[xadesjs](https://www.npmjs.com/package/xadesjs) · [Mustang](https://www.mustangproject.org/commandline/) ·
[KoSIT](https://github.com/itplr-kosit/validator-configuration-xrechnung)
