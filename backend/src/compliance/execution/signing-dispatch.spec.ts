/**
 * F-5 regression tests — signature algorithm dispatched PER ARTIFACT by its DocumentSyntax, not one
 * algo blindly applied to the whole plan. Before the fix, executor.chooseSignAlgo(plan) picked a
 * single XAdES-or-none verdict for the plan and applied it to every artifact:
 *   - IT (FATTURAPA) got enveloped XAdES instead of the CAdES .p7m SdI actually expects.
 *   - PL (FA_VAT) got signed with XAdES whenever the gate (blocking || archival SIGNED) was true,
 *     even though KSeF authenticates by token/seals server-side and a <Signature> element breaks
 *     the schemat_FA2.xsd the authority validates against.
 *
 * Real signing providers + a real in-memory RSA test certificate are used throughout (no mocking of
 * the signing layer itself) so `signature.algo` on the returned SignedArtifact is proof of what the
 * executor actually dispatched, not of a complacent mock's say-so. Only the FORMAT layer is stubbed
 * (a well-formed but minimal artifact per syntax) — the same pattern already used by
 * execution/executor-e2e.spec.ts for exercising the executor without live external format renderers.
 */
import * as forge from 'node-forge';
import { PartyRole, SupplyType, DocumentSyntax } from '../types';
import { PartyTaxProfile, TransactionContext } from '../canonical/canonical-document';
import { primaryObligation, resolve } from '../engine/compliance-engine';
import { NumberingRegistry } from '../lifecycle/numbering';
import { FormatProviderRegistry } from '../providers/format/registry';
import { FormatProvider } from '../providers/format/format-provider';
import { SigningProviderRegistry } from '../providers/signing/registry';
import {
  SigningCredentialsMaterial,
  SigningCredentialsPort,
} from '../providers/signing/signing-credentials-port';
import { ComplianceExecutor } from './executor';
import { RecordingComplianceLogger } from './logger';

// ─────────────────────────── in-memory test certificate ───────────────────────────
// Mirrors providers/signing/providers.spec.ts's generateTestCert(): RSA-2048 self-signed, generated
// once for the whole file (key generation is the expensive part). No p12 bundle — PAdES artifacts in
// these tests are expected to fall through unsigned (not asserted on), only CAdES/XAdES dispatch is.

function generateTestCert(): SigningCredentialsMaterial {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
  const attrs = [
    { name: 'commonName', value: 'Invoicerr Test Signing Cert (F-5)' },
    { name: 'countryName', value: 'FR' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const certPem = forge.pki.certificateToPem(cert);
  const privateKeyPem = forge.pki.privateKeyInfoToPem(
    forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(keys.privateKey)),
  );
  const certDer = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary');
  return { certDer, privateKeyPem, certPem };
}

const TEST_CERT = generateTestCert();

class AlwaysResolveTestCredentials implements SigningCredentialsPort {
  async resolve(): Promise<SigningCredentialsMaterial | null> {
    return TEST_CERT;
  }
}

// ─────────────────────────── canonical-document helpers ───────────────────────────

function party(country: string, role: PartyRole): PartyTaxProfile {
  return {
    legalName: `${country} Co`,
    countryCode: country,
    role,
    identifiers: role === 'B2B' ? [{ scheme: 'VAT', value: `${country}1`, validated: true }] : [],
  };
}

function tx(
  supplier: string,
  buyer: string,
  role: PartyRole,
  supply: SupplyType,
  date: string,
): TransactionContext {
  return {
    supplier: party(supplier, 'B2B'),
    buyer: party(buyer, role),
    lines: [{ id: 'l1', description: 'x', quantity: 1, unitNetMinor: 10000, supplyType: supply }],
    issueDate: new Date(date),
    currency: 'EUR',
  };
}

// ─────────────────────────── stub format providers (well-formed minimal bytes) ───────────────────────────

function stubFormatProvider(syntax: DocumentSyntax, xml: string): FormatProvider {
  return {
    id: `stub-${syntax}`,
    supports: (s) => s === syntax,
    build: async (artifact) => ({
      role: artifact.role,
      syntax,
      mime: 'application/xml',
      bytes: new TextEncoder().encode(xml),
    }),
    validate: async () => ({ valid: true, errors: [], warnings: [] }),
  };
}

const FATTURAPA_XML = '<?xml version="1.0"?><FatturaElettronica><Id>1</Id></FatturaElettronica>';
const FA_VAT_XML = '<?xml version="1.0"?><Faktura><Id>1</Id></Faktura>';
const FACTURAE_XML = '<?xml version="1.0"?><Facturae><Id>1</Id></Facturae>';
const PLAIN_PDF_BYTES = '%PDF-1.4 (not a real pdf, PAdES dispatch not asserted on in this file)';

function executorFor(formatProviders: FormatProvider[]) {
  const log = new RecordingComplianceLogger();
  const formats = new FormatProviderRegistry(formatProviders);
  const signing = new SigningProviderRegistry(undefined, new AlwaysResolveTestCredentials());
  const executor = new ComplianceExecutor({
    formats,
    signing,
    numbering: new NumberingRegistry(),
    logger: log,
  });
  return { executor, log };
}

describe('F-5 — signature algorithm dispatched per artifact syntax (not one algo for the whole plan)', () => {
  it('IT (FATTURAPA, blocking clearance): authoritative artifact is signed CAdES, never XAdES', async () => {
    const { executor } = executorFor([
      stubFormatProvider('FATTURAPA', FATTURAPA_XML),
      stubFormatProvider('PLAIN_PDF', PLAIN_PDF_BYTES),
    ]);
    const ctx = tx('IT', 'IT', 'B2B', 'GOODS', '2027-01-15');
    const plan = resolve(ctx);
    expect(primaryObligation(plan).blocking).toBe(true); // sanity: the signing gate is open

    const result = await executor.execute(ctx, plan);
    const fatturaPa = result.signed.find((a) => a.syntax === 'FATTURAPA');
    expect(fatturaPa?.signature?.algo).toBe('CAdES');
    expect(fatturaPa?.mime).toBe('application/pkcs7-mime'); // .p7m, what SdI expects
  });

  it('PL (FA_VAT, post-2026 KSeF clearance): FA_VAT artifact is NEVER signed, even though the gate is open', async () => {
    const { executor } = executorFor([
      stubFormatProvider('FA_VAT', FA_VAT_XML),
      stubFormatProvider('PLAIN_PDF', PLAIN_PDF_BYTES),
    ]);
    const ctx = tx('PL', 'PL', 'B2B', 'GOODS', '2027-01-15'); // post-2026-02-01 KSeF era
    const plan = resolve(ctx);
    expect(primaryObligation(plan).blocking).toBe(true);
    expect(plan.archival.integrity).toBe('SIGNED'); // gate says "signed" — FA_VAT overrides it anyway

    const result = await executor.execute(ctx, plan);
    const faVat = result.signed.find((a) => a.syntax === 'FA_VAT');
    expect(faVat?.signature).toBeUndefined();
    // The bytes are untouched by any signer (no <Signature> injected — schemat_FA2.xsd stays valid).
    expect(new TextDecoder().decode(faVat!.bytes)).toBe(FA_VAT_XML);
  });

  it('ES (ES_FACTURAE, signed archive): authoritative artifact is signed XAdES', async () => {
    const { executor } = executorFor([
      stubFormatProvider('ES_FACTURAE', FACTURAE_XML),
      stubFormatProvider('PLAIN_PDF', PLAIN_PDF_BYTES),
    ]);
    const ctx = tx('ES', 'ES', 'B2B', 'GOODS', '2027-01-15');
    const plan = resolve(ctx);
    expect(primaryObligation(plan).blocking).toBe(false); // ES gate comes from archival.integrity, not blocking
    expect(plan.archival.integrity).toBe('SIGNED');

    const result = await executor.execute(ctx, plan);
    const facturae = result.signed.find((a) => a.syntax === 'ES_FACTURAE');
    expect(facturae?.signature?.algo).toBe('XAdES');
  });

  it('FR (EN16931_CII, non-blocking + hash-chain archive): stays unsigned (no regression)', async () => {
    const { executor } = executorFor([
      stubFormatProvider('EN16931_CII', '<?xml version="1.0"?><CrossIndustryInvoice/>'),
      stubFormatProvider('FACTURX', PLAIN_PDF_BYTES),
    ]);
    const ctx = tx('FR', 'FR', 'B2B', 'SERVICES', '2027-01-15');
    const plan = resolve(ctx);
    expect(primaryObligation(plan).blocking).toBe(false);
    expect(plan.archival.integrity).toBe('HASH_CHAIN'); // gate stays closed

    const result = await executor.execute(ctx, plan);
    expect(result.signed.every((a) => !a.signature)).toBe(true);
  });
});
