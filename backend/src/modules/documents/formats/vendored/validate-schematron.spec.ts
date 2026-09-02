/**
 * The SIX identifier-checksum XPath functions registered in `validate-schematron.ts`'s own header
 * comment (2026-09-02, the B2G audit wave, `B2G_COVERAGE.md` at the repo root) — found MISSING while
 * proving `b2g-routing/data/be.json` end-to-end in Cypress: `PEPPOL-EN16931-UBL.sch` declares
 * `u:gln`/`u:mod11`/`u:mod97-0208`/`u:abn`/`u:TinVerification`/`u:checkSEOrgnr` as `xsl:function`s,
 * but only `u:slack` had ever been registered against fontoxpath — an unregistered one is a THROWN
 * `XPST0017`, not a clean pass/fail, the moment a rule referencing it is evaluated.
 *
 * Each test below drives the REAL `validateSchematron` against the REAL vendored
 * `PEPPOL-EN16931-UBL.sch` (never a re-implementation of the ruleset) with a minimal XML fragment
 * carrying ONE `cbc:EndpointID` under the scheme the function in question gates — proving three
 * things per function: (1) it never throws (the actual bug this task found and fixed), (2) a
 * genuinely valid identifier passes (the assert's own id absent from `errors`), (3) a genuinely
 * invalid one is caught (the assert's own id present) — never a function that "no longer crashes"
 * by accepting everything.
 *
 * Every "valid" fixture below is independently computed from the SAME algorithm the vendored .sch
 * itself specifies (see `validate-schematron.ts`'s own header for the byte-for-byte port), not
 * invented — `0417497106`/`5560360793`/`123456783` also happen to be well-known public demo
 * identifiers (a Belgian enterprise number, Volvo AB's Swedish org number, and a commonly-cited demo
 * Greek AFM respectively), an independent cross-check that the port matches the real algorithm, not
 * merely a self-consistent one.
 */
import { PEPPOL_BIS_UBL_SCH, validateSchematron } from './validate-schematron';

function xmlWithEndpoint(schemeID: string, value: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ubl-invoice:Invoice
    xmlns:ubl-invoice="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
    xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
    xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">
  <cbc:EndpointID schemeID="${schemeID}">${value}</cbc:EndpointID>
</ubl-invoice:Invoice>`;
}

function assertIds(xml: string): string[] {
  const result = validateSchematron(xml, PEPPOL_BIS_UBL_SCH);
  return [...result.errors, ...result.warnings].map((e) => e.id);
}

/** GR-R-009's own context (`cac:AccountingSupplierParty/cac:Party[$accountingSupplierCountry='GR'
 *  or ...]/cbc:EndpointID`) needs the supplier's OWN party block, not a bare top-level `EndpointID`
 *  the way the other five schemes' rules do — `$accountingSupplierCountry` is derived from the
 *  supplier's postal country code when no VAT-prefixed CompanyID is present (see the .sch's own
 *  `$accountingSupplierCountry` `<let>`). */
function xmlWithGreekSupplierEndpoint(value: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ubl-invoice:Invoice
    xmlns:ubl-invoice="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
    xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
    xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PostalAddress>
        <cac:Country>
          <cbc:IdentificationCode>GR</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      <cbc:EndpointID schemeID="9933">${value}</cbc:EndpointID>
    </cac:Party>
  </cac:AccountingSupplierParty>
</ubl-invoice:Invoice>`;
}

describe('validate-schematron.ts — the six newly-registered Peppol identifier-checksum functions', () => {
  it('u:gln (scheme 0088, PEPPOL-COMMON-R040) — never throws; valid GLN passes, invalid GLN is caught', () => {
    expect(() => assertIds(xmlWithEndpoint('0088', '5412345678908'))).not.toThrow();
    expect(assertIds(xmlWithEndpoint('0088', '5412345678908'))).not.toContain('PEPPOL-COMMON-R040');
    expect(assertIds(xmlWithEndpoint('0088', '5412345678909'))).toContain('PEPPOL-COMMON-R040');
  });

  it('u:mod11 (scheme 0192, PEPPOL-COMMON-R041) — never throws; valid NO org number passes, invalid is caught', () => {
    expect(() => assertIds(xmlWithEndpoint('0192', '123456785'))).not.toThrow();
    expect(assertIds(xmlWithEndpoint('0192', '123456785'))).not.toContain('PEPPOL-COMMON-R041');
    expect(assertIds(xmlWithEndpoint('0192', '123456786'))).toContain('PEPPOL-COMMON-R041');
  });

  it("u:mod97-0208 (scheme 0208, PEPPOL-COMMON-R043) — never throws; the BE B2G rule's own EAS, a real Belgian enterprise number passes, a mistyped one is caught", () => {
    expect(() => assertIds(xmlWithEndpoint('0208', '0417497106'))).not.toThrow();
    expect(assertIds(xmlWithEndpoint('0208', '0417497106'))).not.toContain('PEPPOL-COMMON-R043');
    expect(assertIds(xmlWithEndpoint('0208', '0417497107'))).toContain('PEPPOL-COMMON-R043');
  });

  it('u:abn (scheme 0151, PEPPOL-COMMON-R050) — never throws; a real Australian Business Number passes, an altered one is caught', () => {
    expect(() => assertIds(xmlWithEndpoint('0151', '51824753556'))).not.toThrow();
    expect(assertIds(xmlWithEndpoint('0151', '51824753556'))).not.toContain('PEPPOL-COMMON-R050');
    expect(assertIds(xmlWithEndpoint('0151', '51824753557'))).toContain('PEPPOL-COMMON-R050');
  });

  it("u:checkSEOrgnr (scheme 0007, PEPPOL-COMMON-R049) — never throws; the SE B2G rule's own EAS, Volvo AB's public Swedish org number passes, a mistyped one is caught", () => {
    expect(() => assertIds(xmlWithEndpoint('0007', '5560360793'))).not.toThrow();
    expect(assertIds(xmlWithEndpoint('0007', '5560360793'))).not.toContain('PEPPOL-COMMON-R049');
    expect(assertIds(xmlWithEndpoint('0007', '5560360794'))).toContain('PEPPOL-COMMON-R049');
  });

  it('u:TinVerification (scheme 9933, GR-R-009, Greek-supplier endpoint) — never throws; a valid Greek AFM passes, a mistyped one is caught', () => {
    expect(() => assertIds(xmlWithGreekSupplierEndpoint('123456783'))).not.toThrow();
    expect(assertIds(xmlWithGreekSupplierEndpoint('123456783'))).not.toContain('GR-R-009');
    expect(assertIds(xmlWithGreekSupplierEndpoint('123456780'))).toContain('GR-R-009');
  });
});
