/**
 * facturae-provider.ts — the format FACe (`transports/face-transport.ts`) deposits. Proves:
 *  1. A VALID document passes the REAL vendored `Facturaev3_2_2.xsd`, and computed amounts trace from
 *     `compute-totals.ts` to the right fields (never recomputed here) — same discipline
 *     `fatturapa-provider.spec.ts`/`fa3-provider.spec.ts` already hold for their own national XSDs.
 *  2. A mandatory field stripped makes the SAME schema reject it.
 *  3. WITHOUT a certificate configured → the format REFUSES, naming the gap — never a silently
 *     unsigned "success" (this task's own first real XAdES consumer, root TODO item 13).
 *  4. WITH a forged test certificate → the XML is genuinely signed AND `xadesjs`'s own `Verify()`
 *     re-validates that signature — the actual proof, not just "a `signature` field is present".
 *  5. The DIR3 triad (`dir3OrganoGestor`/`dir3UnidadTramitadora`/`dir3OficinaContable`) becomes an
 *     `<AdministrativeCentres>` block on `BuyerParty` when present, and is entirely omitted otherwise.
 */
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import * as forge from 'node-forge';
import { setNodeDependencies } from 'xadesjs';
import { Application as XmldsigApp, Parse as XmlParse } from 'xmldsigjs';
import { SignedXml } from 'xadesjs';

import { buildInvoiceDescriptor } from '../../descriptors/invoice.descriptor';
import { DocumentTypeDescriptor } from '../../descriptors/types';
import { SigningCredentialsMaterial, SigningCredentialsPort } from '../../signing/signing-credentials-port';
import { DocumentFormatParty } from '../format-provider';
import { validateXsd } from '../vendored/validate-xsd';
import { buildFacturaeFormatProvider, FacturaeSigningRequiredError } from './facturae-provider';

// ---------------------------------------------------------------------------
// Same one-time WebCrypto/DOM engine setup `signing/providers.spec.ts` and `sign-instance-pdf.spec.ts`
// already establish — needed here too since this spec verifies the signature directly via xadesjs.
// ---------------------------------------------------------------------------
beforeAll(() => {
  const xmlDomDeps = { DOMParser, XMLSerializer } as Parameters<typeof setNodeDependencies>[0];
  setNodeDependencies(xmlDomDeps);
  const path = require('node:path') as typeof import('path');
  const xmldsigDir = path.dirname(require.resolve('xmldsigjs'));
  const xmlCoreInXmldsig = require(require.resolve('xml-core', { paths: [xmldsigDir] })) as {
    setNodeDependencies: typeof setNodeDependencies;
  };
  xmlCoreInXmldsig.setNodeDependencies(xmlDomDeps);
  XmldsigApp.setEngine('native', globalThis.crypto as Crypto);
});

function generateTestCert(): SigningCredentialsMaterial {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
  const attrs = [
    { name: 'commonName', value: 'Invoicerr Test Signing Cert (ES)' },
    { name: 'countryName', value: 'ES' },
    { name: 'organizationName', value: 'Invoicerr Tests' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const certPem = forge.pki.certificateToPem(cert);
  const privateKeyPem = forge.pki.privateKeyInfoToPem(
    forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(keys.privateKey)),
  );
  const certDer = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary');
  return { certDer, privateKeyPem, certPem };
}

function fixedCredentials(material: SigningCredentialsMaterial | null): SigningCredentialsPort {
  return { resolve: async () => material };
}

const descriptor: DocumentTypeDescriptor = buildInvoiceDescriptor();

const SELLER: DocumentFormatParty = {
  name: 'Consultoría Ibérica SL',
  address: 'Calle Mayor 10',
  city: 'Madrid',
  postalCode: '28013',
  country: 'Spain',
  partyIdentifiers: [{ scheme: 'VAT', value: 'ESB12345674' }],
};

const BUYER: DocumentFormatParty = {
  name: 'Ayuntamiento de Testville',
  address: 'Plaza Mayor 1',
  city: 'Testville',
  postalCode: '28001',
  country: 'Spain',
  partyIdentifiers: [{ scheme: 'VAT', value: 'ESQ2817001J' }],
};

const DIR3 = {
  dir3OrganoGestor: 'L01280796',
  dir3UnidadTramitadora: 'L01280796',
  dir3OficinaContable: 'L01280796',
};

/**
 * Fixture "chiffrée à la main" :
 *  - Ligne unique : 2 × 500,00 € @ 21% TVA, sans remise → net 1000,00 ; TVA 210,00 ; TTC 1210,00.
 */
const VALID_DATA = {
  client: 'client-1',
  issueDate: '2026-09-15',
  dueDate: '2026-10-15',
  currency: 'EUR',
  lines: [
    { description: 'Servicio de consultoría', quantity: 2, unit: 'unit', unitPrice: 500, vatRate: '21' },
  ],
  ...DIR3,
};

function document(data: unknown, displayNumber = 'FRA-2026-0001') {
  return { id: 'doc-1', data, displayNumber, status: 'sending' };
}

function extractTag(xml: string, tag: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m?.[1];
}

describe('facturae-provider — Facturae 3.2.2 gated by the REAL vendored Facturaev3_2_2.xsd', () => {
  it('declares itself correctly for the format registry / FACe transport', () => {
    const provider = buildFacturaeFormatProvider({ signingCredentials: fixedCredentials(null) });
    expect(provider.id).toBe('facturae');
    expect(provider.syntax).toBe('ES_FACTURAE');
    expect(provider.mime).toBe('application/xml');
  });

  describe('WITHOUT a certificate — the format REFUSES, naming the gap (never a silent unsigned success)', () => {
    it('MUTATION GUARD #1 — no companyId at all → throws FacturaeSigningRequiredError, never returns unsigned bytes as valid', async () => {
      const provider = buildFacturaeFormatProvider({ signingCredentials: fixedCredentials(null) });
      await expect(
        provider.build(descriptor, document(VALID_DATA), SELLER, BUYER /* no companyId */),
      ).rejects.toThrow(FacturaeSigningRequiredError);
    });

    it('MUTATION GUARD #1 — companyId given but no active certificate resolves → throws, naming "Signing certificates"', async () => {
      const provider = buildFacturaeFormatProvider({ signingCredentials: fixedCredentials(null) });
      await expect(
        provider.build(descriptor, document(VALID_DATA), SELLER, BUYER, 'company-1'),
      ).rejects.toThrow(/no active XAdES-applicable signing certificate/);
      await expect(
        provider.build(descriptor, document(VALID_DATA), SELLER, BUYER, 'company-1'),
      ).rejects.toThrow(/Signing certificates/);
    });
  });

  describe('WITH a forged test certificate — the XAdES provider signs, and the signature is RE-VERIFIED', () => {
    it('signs the Facturae XML — ds:Signature is present, xadesjs Verify() confirms it, and the SIGNED document still passes the real XSD', async () => {
      const material = generateTestCert();
      const provider = buildFacturaeFormatProvider({ signingCredentials: fixedCredentials(material) });
      const result = await provider.build(descriptor, document(VALID_DATA), SELLER, BUYER, 'company-1');

      expect(result.validation.valid).toBe(true);
      expect(result.validation.errors).toEqual([]);

      const xml = Buffer.from(result.bytes).toString('utf-8');
      expect(xml).toContain('<ds:Signature');
      expect(xml).toContain('SignatureValue');

      // The actual proof — xadesjs re-validates the signature itself, not merely "a field is set".
      const signedDoc = XmlParse(xml);
      const signatureElements = signedDoc.getElementsByTagNameNS(
        'http://www.w3.org/2000/09/xmldsig#',
        'Signature',
      );
      expect(signatureElements.length).toBeGreaterThan(0);
      const verifier = new SignedXml(signedDoc);
      verifier.LoadXml(signatureElements[0] as Element);
      const isValid = await verifier.Verify();
      expect(isValid).toBe(true);

      // Re-validate against the SAME vendored XSD, on the SIGNED bytes — the schema's own root
      // `ds:Signature` slot (minOccurs="0") accepts it as the last child.
      const xsdResult = await validateXsd(xml, 'es/Facturaev3_2_2.xsd');
      expect(xsdResult.valid).toBe(true);
    }, 30000);

    it('a VALID document: computed amounts (net/VAT/total) reach the right fields, never recomputed here', async () => {
      const material = generateTestCert();
      const provider = buildFacturaeFormatProvider({ signingCredentials: fixedCredentials(material) });
      const result = await provider.build(descriptor, document(VALID_DATA), SELLER, BUYER, 'company-1');
      const xml = Buffer.from(result.bytes).toString('utf-8');

      expect(xml).toContain('<ItemDescription>Servicio de consultoría</ItemDescription>');
      expect(extractTag(xml, 'InvoiceTotal')).toBe('1210');
      expect(extractTag(xml, 'TotalTaxOutputs')).toBe('210');
      expect(extractTag(xml, 'TotalGrossAmount')).toBe('1000');
    }, 30000);

    it('the DIR3 triad becomes an AdministrativeCentres block on BuyerParty with the sourced RoleTypeCodes', async () => {
      const material = generateTestCert();
      const provider = buildFacturaeFormatProvider({ signingCredentials: fixedCredentials(material) });
      const result = await provider.build(descriptor, document(VALID_DATA), SELLER, BUYER, 'company-1');
      const xml = Buffer.from(result.bytes).toString('utf-8');

      expect(xml).toContain('<AdministrativeCentres>');
      expect(xml).toContain(
        `<CentreCode>${DIR3.dir3OrganoGestor}</CentreCode><RoleTypeCode>02</RoleTypeCode>`,
      );
      expect(xml).toContain(
        `<CentreCode>${DIR3.dir3UnidadTramitadora}</CentreCode><RoleTypeCode>03</RoleTypeCode>`,
      );
      expect(xml).toContain(
        `<CentreCode>${DIR3.dir3OficinaContable}</CentreCode><RoleTypeCode>01</RoleTypeCode>`,
      );
    }, 30000);

    it('no DIR3 fields on the document → AdministrativeCentres is entirely OMITTED (a plain B2B/non-FACe Facturae)', async () => {
      const material = generateTestCert();
      const provider = buildFacturaeFormatProvider({ signingCredentials: fixedCredentials(material) });
      const {
        dir3OrganoGestor: _a,
        dir3UnidadTramitadora: _b,
        dir3OficinaContable: _c,
        ...rest
      } = VALID_DATA;
      const result = await provider.build(descriptor, document(rest), SELLER, BUYER, 'company-1');
      const xml = Buffer.from(result.bytes).toString('utf-8');

      expect(xml).not.toContain('AdministrativeCentres');
      expect(result.validation.valid).toBe(true);
    }, 30000);
  });

  describe('a mandatory field missing — the SAME real XSD rejects it (no signing even attempted)', () => {
    it('buyer with NO VAT identifier → TaxIdentificationNumber is empty, the vendored XSD says so, and build() never throws (validation.valid: false, like every sibling provider)', async () => {
      const buyerNoVat: DocumentFormatParty = { ...BUYER, partyIdentifiers: [] };
      // No credentials port needed — the XSD gate runs BEFORE signing is ever attempted, and this
      // document fails it, so build() resolves (never throws) with validation.valid: false.
      const provider = buildFacturaeFormatProvider({ signingCredentials: fixedCredentials(null) });
      const result = await provider.build(descriptor, document(VALID_DATA), SELLER, buyerNoVat, 'company-1');

      expect(result.validation.valid).toBe(false);
      expect(result.validation.errors.length).toBeGreaterThan(0);
      expect(result.validation.errors.join(' ')).toMatch(/TaxIdentificationNumber|minLength|length/i);
    });
  });
});
