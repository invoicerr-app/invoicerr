/**
 * The ONE place a rendered document PDF is turned into a SIGNED PDF (PAdES-BES) — root TODO item 13.
 *
 * WHERE this is called from, and where it deliberately is NOT:
 *  - `documents.service.ts#renderInstancePdf` ("GET /documents/:id/pdf") calls this AFTER
 *    `renderDocumentInstance` produces the plain PDF.
 *  - `actions/send-document-email.ts#sendDocumentInstanceEmail` (the invoice's "email" transport AND
 *    the quote's own "send") calls this AFTER `renderDocumentInstance`, before attaching — so a
 *    signed company sends a signed PDF exactly the same way it downloads one.
 *  - `formats/facturx-provider.ts` does NOT call this: it also calls `renderDocumentInstance`
 *    directly, to get the RAW material `@e-invoice-eu/core` embeds a CII XML into to build a Factur-X
 *    PDF/A-3 — embedding a second payload into an already-signed PDF would invalidate that PAdES
 *    signature's own byte range, and the Factur-X PDF is a DIFFERENT artifact (served from
 *    `GET /documents/:id/formats/facturx`, deposited to PDP) than the one this wiring signs. This is
 *    deliberate, not an oversight: signing wraps the two "hand a human-readable PDF to someone"
 *    call sites, never the "build a machine-readable artifact from the same render" one.
 *
 * No certificate configured (`credentials.resolve()` → null, the default `NullSigningCredentials`
 * path) → the PDF returned is the EXACT input, unchanged — this is the "société sans certificat → PDF
 * strictement inchangé" invariant root TODO item 13 requires, and it needs no special-casing here:
 * `PadesSigningProvider.sign()` already returns `{ ...artifact }` verbatim in that case.
 *
 * A certificate IS configured but the crypto operation fails → this function does NOT catch that
 * error (see `providers.ts#PadesSigningProvider`'s own header for why that provider itself now
 * rethrows instead of swallowing) — it propagates out of `renderInstancePdf`/
 * `sendDocumentInstanceEmail` exactly the way a Puppeteer failure already does for those same two
 * call sites: a company that turned signing on gets a loud failure, never a document it believes is
 * signed but silently is not.
 */
import { SigningCredentialsPort } from './signing-credentials-port';
import { SigningProviderRegistry } from './registry';
import { SigningLogger, defaultSigningLogger } from './signing-logger';

/**
 * certRef convention (matches `SigningCertificatesService.resolve`'s own header): "{companyId}:PAdES"
 * resolves an algo-specific active cert first, falling back to a "*" (all-algorithms) cert for the
 * same company — never the other way around, so a company that scoped a cert to XAdES only (say, for
 * a future non-PDF flow) is never handed to PAdES by mistake.
 */
function certRefFor(companyId: string): string {
  return `${companyId}:PAdES`;
}

export interface SignRenderedPdfOptions {
  registry?: SigningProviderRegistry;
  log?: SigningLogger;
}

/**
 * Signs `pdf` PAdES-BES for `companyId` if — and only if — an active, applicable, non-expired
 * certificate is configured (`credentials.resolve()`). Returns the SAME bytes, untouched, otherwise.
 */
export async function signRenderedPdfIfConfigured(
  credentials: SigningCredentialsPort,
  companyId: string,
  pdf: Buffer,
  options: SignRenderedPdfOptions = {},
): Promise<Buffer> {
  const registry = options.registry ?? new SigningProviderRegistry(undefined, credentials);
  const log = options.log ?? defaultSigningLogger;

  const signed = await registry
    .get('PAdES')
    .sign({ mime: 'application/pdf', bytes: new Uint8Array(pdf), label: 'pdf' }, certRefFor(companyId), log);

  return Buffer.from(signed.bytes);
}
