export type IdentifierScheme = 'LEGAL_ID' | 'VAT' | 'RFC';

export interface Scenario {
  id: string;
  expectsAuthorityNumbering?: boolean;
  /** Set when the scenario's ONLY transmission channel is unreachable in CI (no credentials)
   *  and has no EMAIL fallback, so its compliance doc legitimately lands on
   *  TRANSMISSION_FAILED. assertCompliance() skips the failure-status denylist for these
   *  scenarios — the test still proves format conformance, just not creds-gated transmission. */
  noCiTransmission?: boolean;
  company: {
    name: string;
    country: string;
    legalId: string;
    currency: string;
    currencyLabel: string;
    identifierScheme?: IdentifierScheme;
    /** Additional VAT identifier, independent of `identifierScheme` (e.g. an FR seller whose
     *  onboarding-required identifier is the SIRET/LEGAL_ID but who also needs an intra-EU VAT
     *  number to invoice a cross-border EU B2B buyer — EN16931 BR-S-02/BR-AE-02). Filled on the
     *  company settings page only (not the onboarding dialog, which only asks for
     *  `identifierScheme`). */
    vat?: string;
  };
  client: {
    name: string;
    email: string;
    country: string;
    type: 'COMPANY' | 'INDIVIDUAL';
    vat?: string;
    address: string;
    postalCode: string;
    city: string;
    currency: string;
    contactFirstname?: string;
    contactLastname?: string;
  };
  item: {
    name: string;
    quantity: number;
    unitPrice: number;
    vatRate: number;
    type: 'SERVICE' | 'PRODUCT' | 'HOUR' | 'DAY';
  };
}

// 5-COUNTRY PRUNE (2026-09-10) — SCENARIO MAPPING.
// The product now keeps FR/PL/IT/PT/DE only. Four of the six scenarios named a removed country (BE,
// ES, MX, and the US on both sides of "mx-us"/"us-us") and are re-pointed onto kept-country pairs,
// preserving each replaced scenario's own SHAPE and role in the matrix rather than redesigning it:
//   fr-be → fr-pl : same role — intra-EU B2B SERVICE, reverse-charge (0%), seller's own EU VAT
//                   required (EN16931 BR-S-02/BR-AE-02). Belgium → Poland.
//   es-pt → pt-de : same role — cross-border B2B SERVICE at the SELLER's own domestic standard
//                   rate (not reverse-charged — mirrors de-fr's own "standard-rated cross-border"
//                   shape). Seller swaps from Spain to Portugal (23%, was Spain's 21%); buyer
//                   swaps from Portugal to Germany.
//   mx-us → it-pt : same role — cross-border B2B GOODS at the seller's own standard rate. Mexico's
//                   own RFC identifier scheme, MXN currency and `expectsAuthorityNumbering` (CFDI's
//                   authority-stamped folio) have NO equivalent among the kept countries — none of
//                   FR/PL/IT/PT/DE's own channels (PDP/KSeF/SdI) overwrite the invoice's own display
//                   number the way Mexico's SAT does, so `expectsAuthorityNumbering` is dropped
//                   rather than asserted on a trait the prune never verified. Italy → Portugal.
//                   `noCiTransmission: true` carries over from it-it, same reason (SdI has no EMAIL
//                   fallback and no CI credentials).
//   us-us → pl-de : same role — a B2C scenario with an INDIVIDUAL client — but US's own domestic,
//                   no-VAT sales-tax shape has no kept-country equivalent, so this becomes a
//                   cross-border EU B2C distance sale instead (Poland → a German individual),
//                   exercising the OSS destination-VAT path (tax-engine.ts#ossDestinationVat) that
//                   none of the other five scenarios reaches: the line's `vatRate` (19%) is the
//                   DESTINATION country's own standard rate, not the seller's.
// de-fr and it-it are unaffected — both already resolve to kept countries.
//
// NOTE (2026-09-10): `e2e/cypress/e2e/scenarios/full-lifecycle.cy.ts`, the spec this fixture file
// feeds, is NOT present in this branch's working tree — removed by an earlier, unrelated commit
// ("refactor!: suppression des documents légaux et du moteur de conformité"), predating and
// independent of the 5-country prune. This mapping is prepared and internally consistent, but
// `.github/workflows/scenarios.yml`'s "Business Scenarios" job cannot actually run until that spec
// exists again — flagged here rather than silently left inconsistent.
export const SCENARIOS: Record<string, Scenario> = {
  'fr-pl': {
    id: 'fr-pl',
    // Intra-EU B2B service (Art. 44/196 Directive 2006/112/EC): FR seller → PL buyer, both
    // VAT-registered. Correct treatment is reverse charge (0% VAT, buyer self-accounts in
    // Poland) — NOT French/Polish standard-rated VAT, which the seller has no place charging
    // for a supply whose place of supply is the buyer's country. The FR seller's own
    // intra-community VAT number (`vat`, distinct from the SIRET `legalId`/`identifierScheme`
    // used at onboarding) is required by EN16931 (BR-S-02/BR-AE-02) to identify the seller for
    // tax purposes on ANY cross-border invoice, standard-rated or reverse-charge alike.
    company: { name: 'Studio Lyon SARL', country: 'France', legalId: '73282932000074', vat: 'FR44732829320', currency: 'EUR', currencyLabel: 'Euro (€)', identifierScheme: 'LEGAL_ID' },
    client: { name: 'Warszawa Consulting Sp. z o.o.', email: 'client-fr-pl@mailpit.test', country: 'Poland', type: 'COMPANY', vat: 'PL5260001246', address: 'ul. Marszałkowska 1', postalCode: '00-624', city: 'Warsaw', currency: 'EUR' },
    item: { name: 'Consulting', quantity: 5, unitPrice: 200, vatRate: 0, type: 'SERVICE' },
  },
  'de-fr': {
    id: 'de-fr',
    // Standard-rated (20%, category "S") cross-border DE→FR B2B supply. EN16931 BR-S-02/BR-CO-26
    // require a Seller VAT identifier (BT-31, cac:PartyTaxScheme/cbc:CompanyID) whenever a
    // taxed/standard VAT category is used — a bare commercial-register id (cac:PartyLegalEntity/
    // cbc:CompanyID) does NOT satisfy that. `identifierScheme: 'VAT'` routes `legalId` through the
    // existing onboarding-vat-input/company-vat-input fields (see fillCompanyIdentifier() and the
    // onboarding step in full-lifecycle.cy.ts) so the seller carries a real USt-IdNr end-to-end.
    // DE136695976 is a checksum-valid German VAT (ISO 7064 Mod 11,10 — the exact algorithm in
    // backend/src/compliance/canonical/identifier-validator.ts's validateDeVat(); this value is
    // SAP SE's long-published, publicly known USt-IdNr, not an invented number).
    company: { name: 'Berlin Tech GmbH', country: 'Germany', legalId: 'DE136695976', currency: 'EUR', currencyLabel: 'Euro (€)', identifierScheme: 'VAT' },
    client: { name: 'Paris Media SAS', email: 'client-de-fr@mailpit.test', country: 'France', type: 'COMPANY', vat: 'FR12345678901', address: '15 Rue de Rivoli', postalCode: '75001', city: 'Paris', currency: 'EUR' },
    item: { name: 'Software License', quantity: 1, unitPrice: 1200, vatRate: 20, type: 'PRODUCT' },
  },
  'it-it': {
    id: 'it-it',
    // SdI is Italy's ONLY transmission channel — there is no EMAIL fallback for IT, and CI has
    // no SdI credentials — so the compliance doc legitimately lands on TRANSMISSION_FAILED. This
    // scenario still proves the rendered FatturaPA is a VALID format; it does not (and cannot, in
    // CI) prove creds-gated transmission. See assertCompliance()'s strictStatus gate.
    noCiTransmission: true,
    company: { name: 'Milano Servizi SRL', country: 'Italy', legalId: '12345678901', currency: 'EUR', currencyLabel: 'Euro (€)', identifierScheme: 'VAT' },
    client: { name: 'Comune di Roma', email: 'client-it-it@mailpit.test', country: 'Italy', type: 'COMPANY', vat: 'IT98765432109', address: 'Via del Corso', postalCode: '00186', city: 'Rome', currency: 'EUR' },
    item: { name: 'Servizi IT', quantity: 10, unitPrice: 90, vatRate: 22, type: 'SERVICE' },
  },
  'pt-de': {
    id: 'pt-de',
    // Cross-border B2B service at the SELLER's own standard rate (23%, Portugal's own — was
    // Spain's 21%) — mirrors de-fr's own "standard-rated cross-border" shape rather than fr-pl's
    // reverse-charge one, same as the es-pt scenario this replaces.
    company: { name: 'Porto Digital Lda', country: 'Portugal', legalId: '509442661', vat: 'PT509442661', currency: 'EUR', currencyLabel: 'Euro (€)', identifierScheme: 'VAT' },
    client: { name: 'Hamburg Handel GmbH', email: 'client-pt-de@mailpit.test', country: 'Germany', type: 'COMPANY', vat: 'DE812000006', address: 'Mönckebergstraße 1', postalCode: '20095', city: 'Hamburg', currency: 'EUR' },
    item: { name: 'Web design', quantity: 3, unitPrice: 500, vatRate: 23, type: 'SERVICE' },
  },
  'it-pt': {
    id: 'it-pt',
    // SdI is Italy's ONLY transmission channel — same "no EMAIL fallback, no CI credentials"
    // situation it-it already documents, so this ALSO legitimately lands on TRANSMISSION_FAILED.
    // Mexico's own RFC identifier scheme, MXN currency, and `expectsAuthorityNumbering` (the CFDI's
    // authority-stamped folio) have no equivalent among the kept countries and are dropped, not
    // reassigned to Italy/Portugal on a guess — see this file's own header.
    noCiTransmission: true,
    company: { name: 'Torino Componenti SRL', country: 'Italy', legalId: '11223344554', currency: 'EUR', currencyLabel: 'Euro (€)', identifierScheme: 'VAT' },
    client: { name: 'Porto Import Lda', email: 'client-it-pt@mailpit.test', country: 'Portugal', type: 'COMPANY', vat: 'PT501442600', address: 'Rua de Santa Catarina', postalCode: '4000-009', city: 'Porto', currency: 'EUR' },
    item: { name: 'Componenti', quantity: 20, unitPrice: 35, vatRate: 22, type: 'PRODUCT' },
  },
  'pl-de': {
    id: 'pl-de',
    // B2C — a Polish seller and a German INDIVIDUAL buyer, preserving us-us's own "individual
    // client" angle but as a genuine cross-border EU distance sale: the OSS destination-VAT path
    // (tax-engine.ts#ossDestinationVat), which none of the other four scenarios reaches. `vatRate`
    // is the DESTINATION country's own standard rate (Germany, 19%), not the seller's — the real
    // tax resolution at issuance recomputes this from tax-systems/data/de.json regardless of what
    // was typed here.
    company: { name: 'Kraków Usługi Sp. z o.o.', country: 'Poland', legalId: 'PL7010018991', currency: 'EUR', currencyLabel: 'Euro (€)', identifierScheme: 'VAT' },
    client: { name: 'Klaus Mueller', email: 'client-pl-de@mailpit.test', country: 'Germany', type: 'INDIVIDUAL', contactFirstname: 'Klaus', contactLastname: 'Mueller', address: 'Leopoldstraße 10', postalCode: '80802', city: 'Munich', currency: 'EUR' },
    item: { name: 'Widget', quantity: 2, unitPrice: 150, vatRate: 19, type: 'PRODUCT' },
  },
};
