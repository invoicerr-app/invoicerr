/**
 * Facturae 3.2.2 (ES) format provider — Spain's B2G channel, FACe (`transports/face-transport.ts`),
 * the payload it deposits. REPRISED from `invoice-rendering/national/facturae.ts` at git tag
 * `avant-refonte-documents`, ADAPTED to the current generic document model the SAME way
 * `fa3-provider.ts`/`fatturapa-provider.ts` already are (see either file's own header for the shared
 * reasoning): amounts come from `totals/compute-totals.ts` (via `national-lines.ts`), NEVER
 * recalculated by hand the way the old `InvoiceRenderData`-based builder did (`item.quantity *
 * item.unitPrice`, no discount concept at all — this branch's descriptor now HAS one,
 * `discountPercent`, so reusing the old arithmetic verbatim would silently drop it). The
 * address/party-block shape (AddressInSpain vs OverseasAddress, the alpha-3 country map, the
 * TaxIdentification/LegalEntity nesting) is REPRISED near-verbatim — that part of the repère's own
 * builder had no arithmetic to lose.
 *
 * NOT wired through `structural-check.ts`/`validate-schematron.ts` (the EN 16931 gate) — Facturae is
 * a SPANISH NATIONAL schema with its own official XSD, vendored byte-for-byte from the repère
 * (`formats/vendored/es/Facturaev3_2_2.xsd` + its `xmldsig-core-schema.xsd` import — see
 * `validate-xsd.ts`'s own header for why every sibling `.xsd` in the same directory is preloaded so
 * `xsd:import` resolves), judged by THAT XSD alone — the same "a national format's own XSD is its
 * judge" reasoning `fa3-provider.ts`/`fatturapa-provider.ts` already establish.
 *
 * ## THE XAdES SIGNATURE — root TODO item 13's first real consumer
 *
 * FACe requires a SIGNED Facturae, not merely a well-formed one (the vendored XSD's own root
 * `<xs:element ref="ds:Signature" minOccurs="0">` documentation says as much: "must be completed in
 * order for an electronic invoice to be considered legally valid before third parties" — see
 * `formats/vendored/es/Facturaev3_2_2.xsd` itself). Root TODO item 13 built a real, tested XAdES
 * provider (`signing/providers.ts#XadesSigningProvider`) that, until this task, had NO caller outside
 * its own spec (`registry.ts`'s own header: "nothing in this codebase calls `registry.get('XAdES' |
 * 'CAdES')` outside their own specs"). This file is that first real caller:
 *
 *  1. Build the UNSIGNED Facturae XML (amounts/parties/lines as above) and validate it against the
 *     vendored XSD (the `ds:Signature` element is `minOccurs="0"`, so an unsigned document is
 *     already schema-valid on its own — this is what a plain `download-xml` for a non-FACe use gets).
 *  2. If a `companyId` was handed to `build()` (every real caller passes one — see
 *     `format-provider.ts`'s own header on why this is the ONE optional 5th parameter, and
 *     `documents.service.ts#downloadDocumentFormat`, which already threads it through to every
 *     provider unconditionally), resolve that company's signing credentials
 *     (`SigningCredentialsPort`, the SAME `SigningCertificatesService` port `sign-instance-pdf.ts`
 *     already uses) under the SAME certRef convention that file established: `"{companyId}:XAdES"`,
 *     falling back to a company-wide `"*"` cert — see `SigningCertificatesService.resolve`'s own
 *     header for that resolution order.
 *  3. **No certificate resolved → REFUSE, naming the gap** (never a silently-unsigned "success"
 *     dressed up as FACe-ready). This is a DELIBERATE departure from `XadesSigningProvider.sign()`'s
 *     own graceful contract (no cert → pass the artifact through unsigned, with a warn log): that
 *     contract is right for a provider with no fixed legal consumer, but wrong for the ONE format
 *     whose target platform is documented, in its OWN vendored schema, as requiring a signature to be
 *     considered valid. The refusal message points at the certificates screen
 *     (`modules/company/signing-certificates/`) by name, the same way `chorus-pro-transport.ts`'s own
 *     preflight refusal names "Company settings → Channels" for a missing credential.
 *  4. A certificate WAS resolved but the sign operation itself failed (a corrupt PFX, a library
 *     error) → ALSO refuse, loudly — never fall back to the unsigned bytes. `XadesSigningProvider`
 *     itself still swallows a mid-sign failure into "unsigned" (see that file's own header: XAdES/
 *     CAdES keep the repère's graceful-swallow contract because neither had a live caller before
 *     this task) — this file distinguishes the two cases itself by checking `signed.signature` is
 *     actually populated, the SAME two-distinct-failure-mode reasoning `PadesSigningProvider`'s own
 *     header already documents for `sign-instance-pdf.ts` ("no cert" is not an error; "cert present
 *     but signing failed" always is). Re-validated after signing (`signature.spec.ts`'s own "re-signs
 *     and xadesjs re-verifies" case) rather than trusted blindly: the SAME XSD validates the SIGNED
 *     document too (the vendored schema accepts `ds:Signature` as the LAST child of the `Facturae`
 *     root, exactly where an enveloped `SignedXml.Sign` call appends it), so signing failure can
 *     never silently also break schema validity.
 *
 * A document built for a NON-FACe purpose (a plain `download-xml`, or a Spanish B2B client that
 * never routes through FACe) is unaffected: `AdministrativeCentres` (below) and the signature are
 * both additive — omitted/unsigned Facturae stays exactly as valid as it always was, per the same
 * `minOccurs="0"` the schema itself declares for both.
 *
 * ## THE DIR3 TRIAD — órgano gestor / unidad tramitadora / oficina contable
 *
 * FACe routes a deposited invoice inside the receiving public body by three DIR3 codes, carried
 * generically as document fields (`data.dir3OrganoGestor`/`dir3UnidadTramitadora`/
 * `dir3OficinaContable` — see `b2g-routing/data/es.json`'s own `requiredDocumentFields`, the SAME
 * generic mechanism Germany's single Leitweg-ID field already proves for one field, extended here to
 * three). When present, they are emitted as the BuyerParty's `<AdministrativeCentres>` block — three
 * `<AdministrativeCentre>` entries, `RoleTypeCode` "02"/"03"/"01" respectively. That mapping is
 * SOURCED, not guessed (`transports/face/face-client.ts`'s own header cites both corroborating
 * sources — the vendored XSD's own `RoleTypeCodeType` documentation and
 * `josemmo/Facturae-PHP`'s `FacturaeCentre.php` constants). The block is entirely OMITTED when none
 * of the three fields is set — never emitted half-populated with empty `<CentreCode>` text (which
 * would fail `TextMax10Type`'s own minimum-length-1 constraint).
 */
import { getIdentifier } from '@/utils/entity-identifiers';
import { fromMinor } from '@/utils/financial';

import { DocumentInstanceResult } from '../../actions/action-registry';
import { DocumentTypeDescriptor } from '../../descriptors/types';
import { computeDocumentTotals } from '../../totals/compute-totals';
import { SigningCredentialsPort } from '../../signing/signing-credentials-port';
import { SigningProviderRegistry } from '../../signing/registry';
import { defaultSigningLogger, SigningLogger } from '../../signing/signing-logger';
import { toDateOnly } from '../shared-build';
import { DocumentFormatBuildResult, DocumentFormatParty, DocumentFormatProvider } from '../format-provider';
import { validateXsd } from '../vendored/validate-xsd';
import { extractNationalLines } from './national-lines';

const FACTURAE_NS = 'http://www.facturae.gob.es/formato/Versiones/Facturaev3_2_2.xml';
const FACTURAE_XSD = 'es/Facturaev3_2_2.xsd';

/** Same certRef convention `sign-instance-pdf.ts#certRefFor` established for PAdES — algo-specific
 *  first, falling back to a company-wide "*" cert (`SigningCertificatesService.resolve`'s own
 *  header). A DIFFERENT algo suffix ("XAdES" vs "PAdES") so a company that scoped a cert to ONE of
 *  the two is never handed to the other by mistake — same reasoning that file's own header gives. */
function certRefFor(companyId: string): string {
  return `${companyId}:XAdES`;
}

/** Thrown when FACe's own signature requirement cannot be met — see this file's own header, point 3
 *  and 4. Named so a caller (`face-transport.ts`) can surface it as a preflight-shaped refusal rather
 *  than a bare 500, without string-matching a message. */
export class FacturaeSigningRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FacturaeSigningRequiredError';
  }
}

/**
 * Detect if country is Spain → AddressInSpain; otherwise → OverseasAddress. Facturae AddressInSpain
 * requires CountryCode="ESP" (ISO 3166-1 alpha-3). REPRISED verbatim from the repère.
 */
function isSpain(country: string | null | undefined): boolean {
  return /^(spain|españa|es|esp)$/i.test((country ?? '').trim());
}

/** Map ISO-2 or common country names to ISO 3166-1 alpha-3 (best-effort) — REPRISED verbatim. */
function toAlpha3(country: string | null | undefined): string {
  const c = (country ?? '').trim().toUpperCase();
  const map: Record<string, string> = {
    SPAIN: 'ESP',
    ESPAÑA: 'ESP',
    ES: 'ESP',
    ESP: 'ESP',
    FRANCE: 'FRA',
    FRANCIA: 'FRA',
    FR: 'FRA',
    FRA: 'FRA',
    GERMANY: 'DEU',
    DE: 'DEU',
    DEU: 'DEU',
    ITALY: 'ITA',
    IT: 'ITA',
    ITA: 'ITA',
    PORTUGAL: 'PRT',
    PT: 'PRT',
    PRT: 'PRT',
    'UNITED KINGDOM': 'GBR',
    UK: 'GBR',
    GB: 'GBR',
    GBR: 'GBR',
    'UNITED STATES': 'USA',
    US: 'USA',
    USA: 'USA',
    MEXICO: 'MEX',
    MX: 'MEX',
    MEX: 'MEX',
    POLAND: 'POL',
    PL: 'POL',
    POL: 'POL',
  };
  return map[c] ?? 'ESP'; // default to ESP for unknown countries
}

function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Build the XML block for a party address (AddressInSpain or OverseasAddress) — REPRISED verbatim. */
function buildAddress(party: DocumentFormatParty): string {
  const addr = esc(party.address || 'N/A').substring(0, 80);
  const town = esc(party.city || 'N/A').substring(0, 50);
  const province = esc(party.city || 'N/A').substring(0, 20);
  const countryCode = toAlpha3(party.country);

  if (isSpain(party.country)) {
    // PostCodeType: exactly 5 numeric digits
    const postCode = (party.postalCode ?? '').replace(/\D/g, '').padStart(5, '0').substring(0, 5);
    return (
      `<AddressInSpain><Address>${addr}</Address><PostCode>${postCode}</PostCode>` +
      `<Town>${town}</Town><Province>${province}</Province><CountryCode>${countryCode}</CountryCode>` +
      `</AddressInSpain>`
    );
  }
  const postCodeAndTown = esc(`${party.postalCode ?? ''} ${party.city ?? ''}`.trim() || 'N/A').substring(
    0,
    50,
  );
  return (
    `<OverseasAddress><Address>${addr}</Address><PostCodeAndTown>${postCodeAndTown}</PostCodeAndTown>` +
    `<Province>${province}</Province><CountryCode>${countryCode}</CountryCode></OverseasAddress>`
  );
}

/** Build a Facturae party block (BusinessType: TaxIdentification [+ AdministrativeCentres] +
 *  LegalEntity) — REPRISED, with the DIR3 block inserted where the XSD's own `BusinessType`
 *  sequence requires it: AFTER `TaxIdentification`, BEFORE the `LegalEntity`/`Individual` choice
 *  (see `formats/vendored/es/Facturaev3_2_2.xsd`'s own `BusinessType` — `PartyIdentification` then
 *  `AdministrativeCentres` both sit between the two, both `minOccurs="0"`). */
function buildParty(
  party: DocumentFormatParty,
  vatId: string,
  personType: 'J' | 'F',
  administrativeCentresXml: string,
): string {
  const corpName = esc(party.name || 'N/A').substring(0, 80);
  const addrXml = buildAddress(party);
  return (
    `<TaxIdentification><PersonTypeCode>${personType}</PersonTypeCode>` +
    `<ResidenceTypeCode>R</ResidenceTypeCode>` +
    `<TaxIdentificationNumber>${esc(vatId)}</TaxIdentificationNumber></TaxIdentification>` +
    administrativeCentresXml +
    `<LegalEntity><CorporateName>${corpName}</CorporateName>${addrXml}</LegalEntity>`
  );
}

/** DIR3 field → (CentreCode source, RoleTypeCode) — see this file's own header, "THE DIR3 TRIAD",
 *  for the sourcing of the RoleTypeCode mapping. Field keys match `b2g-routing/data/es.json`'s own
 *  `requiredDocumentFields`. */
const DIR3_FIELDS: { field: string; roleTypeCode: '01' | '02' | '03' }[] = [
  // Órgano Gestor — the managing body / recipient (ROLE_GESTOR / ROLE_RECEPTOR = "02").
  { field: 'dir3OrganoGestor', roleTypeCode: '02' },
  // Unidad Tramitadora — the processing unit / payer (ROLE_TRAMITADOR / ROLE_PAGADOR = "03").
  { field: 'dir3UnidadTramitadora', roleTypeCode: '03' },
  // Oficina Contable — the accounting office (ROLE_CONTABLE / ROLE_FISCAL = "01").
  { field: 'dir3OficinaContable', roleTypeCode: '01' },
];

/** Builds `<AdministrativeCentres>` from whichever DIR3 fields are actually set on `data` — empty
 *  string (the whole block omitted) when none are, never a half-populated block with blank
 *  `<CentreCode>` text (see this file's own header). `AdministrativeCentreType`'s own `xs:choice`
 *  between `AddressInSpain`/`OverseasAddress` is MANDATORY (unlike `CentreCode`/`RoleTypeCode`,
 *  which are `minOccurs="0"`) — this catalog carries no PER-CENTRE address (DIR3 codes name a unit,
 *  not a postal address), so each centre reuses the BUYER's own address, the only address this
 *  provider actually has for "where this public body is" — never fabricated data. */
function buildAdministrativeCentres(data: Record<string, unknown>, buyer: DocumentFormatParty): string {
  const buyerAddressXml = buildAddress(buyer);
  const centres = DIR3_FIELDS.map(({ field, roleTypeCode }) => {
    const raw = data[field];
    const code = typeof raw === 'string' ? raw.trim() : '';
    if (!code) return null;
    return (
      `<AdministrativeCentre><CentreCode>${esc(code).substring(0, 10)}</CentreCode>` +
      `<RoleTypeCode>${roleTypeCode}</RoleTypeCode>${buyerAddressXml}</AdministrativeCentre>`
    );
  }).filter((x): x is string => x !== null);
  if (centres.length === 0) return '';
  return `<AdministrativeCentres>${centres.join('')}</AdministrativeCentres>`;
}

/** Builds the plain, UNSIGNED Facturae 3.2.2 XML — everything except the signature, split out so
 *  `build()` below can validate it against the XSD BEFORE ever attempting to sign it (a document
 *  that is not even schema-valid unsigned has no business being signed at all). */
function buildUnsignedXml(
  descriptor: DocumentTypeDescriptor,
  document: Pick<DocumentInstanceResult, 'id' | 'data' | 'displayNumber' | 'status'>,
  company: DocumentFormatParty,
  client: DocumentFormatParty,
): string {
  const data = (document.data ?? {}) as Record<string, unknown>;
  const totals = computeDocumentTotals(descriptor, data);
  const lines = extractNationalLines(data, totals);
  const currency = totals.currency || 'EUR';

  const issueDate = toDateOnly(data.issueDate);
  const invoiceNumber = (document.displayNumber ?? 'DRAFT').substring(0, 20);

  const vatId = getIdentifier(company, 'VAT') || '';
  const clientVatId = getIdentifier(client, 'VAT') || '';
  // The repère read `data.client.type` (Prisma's own COMPANY/INDIVIDUAL) to pick 'J'/'F'.
  // `DocumentFormatParty` (`party-snapshot.ts`) deliberately carries no such business-entity concept
  // (see that file's own header — "a provider never has to know whether it is looking at a seller …
  // or a buyer"), and this format's one real consumer (FACe, `transports/face-transport.ts`) only
  // ever routes to a PUBLIC ADMINISTRATION — always a legal person — so 'J' is not a guess for the
  // buyer here, it is what the recipient always structurally is. A future non-B2G Spanish B2B/B2C
  // use of this same provider (`download-xml`, an individual buyer) would need `PersonTypeCode`
  // threaded through `DocumentFormatParty` properly rather than reintroducing the heuristic.
  const clientPersonType: 'J' | 'F' = 'J';

  const totalNet = fromMinor(totals.netMinor, currency);
  const totalVat = fromMinor(totals.vatMinor, currency);
  const invoiceTotal = fromMinor(totals.grossMinor, currency);

  // Invoice-level TaxesOutputs — one Tax entry per unique VAT rate, from totals.vatBreakdown, never
  // recomputed here (see this file's own header).
  const invoiceTaxesXml = totals.vatBreakdown
    .map((entry) => {
      const base = fromMinor(entry.baseMinor, currency);
      const taxAmt = fromMinor(entry.vatMinor, currency);
      return (
        `<Tax><TaxTypeCode>01</TaxTypeCode><TaxRate>${entry.ratePercent}</TaxRate>` +
        `<TaxableBase><TotalAmount>${base}</TotalAmount></TaxableBase>` +
        `<TaxAmount><TotalAmount>${taxAmt}</TotalAmount></TaxAmount></Tax>`
      );
    })
    .join('');

  const itemsXml = lines
    .map((line) => {
      const net = fromMinor(line.netMinor, currency);
      const taxAmt = fromMinor(line.vatMinor, currency);
      const rate = line.vatRatePercent ?? 0;
      const desc = esc(line.description || 'Service').substring(0, 2500);
      return (
        `<InvoiceLine><ItemDescription>${desc}</ItemDescription>` +
        `<Quantity>${line.quantity}</Quantity><UnitPriceWithoutTax>${line.unitPrice}</UnitPriceWithoutTax>` +
        `<TotalCost>${net}</TotalCost><GrossAmount>${net}</GrossAmount>` +
        `<TaxesOutputs><Tax><TaxTypeCode>01</TaxTypeCode><TaxRate>${rate}</TaxRate>` +
        `<TaxableBase><TotalAmount>${net}</TotalAmount></TaxableBase>` +
        `<TaxAmount><TotalAmount>${taxAmt}</TotalAmount></TaxAmount></Tax></TaxesOutputs></InvoiceLine>`
      );
    })
    .join('');

  const administrativeCentresXml = buildAdministrativeCentres(data, client);

  // Facturae XSD has elementFormDefault="unqualified" — only the root element is namespace-qualified
  // (fe: prefix). All child elements are in no-namespace. REPRISED verbatim from the repère.
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<fe:Facturae xmlns:fe="${FACTURAE_NS}" xmlns:ds="http://www.w3.org/2000/09/xmldsig#">` +
    `<FileHeader><SchemaVersion>3.2.2</SchemaVersion><Modality>I</Modality>` +
    `<InvoiceIssuerType>EM</InvoiceIssuerType><Batch>` +
    `<BatchIdentifier>${esc(`${vatId}-${invoiceNumber}`).substring(0, 70)}</BatchIdentifier>` +
    `<InvoicesCount>1</InvoicesCount>` +
    `<TotalInvoicesAmount><TotalAmount>${invoiceTotal}</TotalAmount></TotalInvoicesAmount>` +
    `<TotalOutstandingAmount><TotalAmount>${invoiceTotal}</TotalAmount></TotalOutstandingAmount>` +
    `<TotalExecutableAmount><TotalAmount>${invoiceTotal}</TotalAmount></TotalExecutableAmount>` +
    `<InvoiceCurrencyCode>${currency}</InvoiceCurrencyCode></Batch></FileHeader>` +
    `<Parties><SellerParty>${buildParty(company, vatId, 'J', '')}</SellerParty>` +
    `<BuyerParty>${buildParty(client, clientVatId, clientPersonType, administrativeCentresXml)}</BuyerParty>` +
    `</Parties>` +
    `<Invoices><Invoice><InvoiceHeader><InvoiceNumber>${esc(invoiceNumber)}</InvoiceNumber>` +
    `<InvoiceDocumentType>FC</InvoiceDocumentType><InvoiceClass>OO</InvoiceClass></InvoiceHeader>` +
    `<InvoiceIssueData><IssueDate>${issueDate}</IssueDate>` +
    `<InvoiceCurrencyCode>${currency}</InvoiceCurrencyCode>` +
    `<TaxCurrencyCode>${currency}</TaxCurrencyCode><LanguageName>es</LanguageName></InvoiceIssueData>` +
    `<TaxesOutputs>${invoiceTaxesXml}</TaxesOutputs>` +
    `<InvoiceTotals><TotalGrossAmount>${totalNet}</TotalGrossAmount>` +
    `<TotalGrossAmountBeforeTaxes>${totalNet}</TotalGrossAmountBeforeTaxes>` +
    `<TotalTaxOutputs>${totalVat}</TotalTaxOutputs><TotalTaxesWithheld>0</TotalTaxesWithheld>` +
    `<InvoiceTotal>${invoiceTotal}</InvoiceTotal>` +
    `<TotalOutstandingAmount>${invoiceTotal}</TotalOutstandingAmount>` +
    `<TotalExecutableAmount>${invoiceTotal}</TotalExecutableAmount></InvoiceTotals>` +
    `<Items>${itemsXml}</Items></Invoice></Invoices></fe:Facturae>`
  );
}

export interface FacturaeFormatProviderDeps {
  /** Root TODO item 13's own port (`SigningCertificatesService` in production) — see this file's
   *  own header, "THE XAdES SIGNATURE", for the resolution/refusal contract built on top of it. */
  signingCredentials: SigningCredentialsPort;
  /** Overridable for tests only — defaults to a real `SigningProviderRegistry` wired to
   *  `signingCredentials`, the same construction `sign-instance-pdf.ts` uses for PAdES. */
  signingRegistry?: SigningProviderRegistry;
  log?: SigningLogger;
}

export function buildFacturaeFormatProvider(deps: FacturaeFormatProviderDeps): DocumentFormatProvider {
  const registry = deps.signingRegistry ?? new SigningProviderRegistry(undefined, deps.signingCredentials);
  const log = deps.log ?? defaultSigningLogger;

  async function build(
    descriptor: DocumentTypeDescriptor,
    document: Pick<DocumentInstanceResult, 'id' | 'data' | 'displayNumber' | 'status'>,
    company: DocumentFormatParty,
    client: DocumentFormatParty,
    companyId?: string,
  ): Promise<DocumentFormatBuildResult> {
    const unsignedXml = buildUnsignedXml(descriptor, document, company, client);
    const unsignedResult = await validateXsd(unsignedXml, FACTURAE_XSD);
    if (!unsignedResult.valid) {
      // Not even schema-valid unsigned — refused the same way every sibling national provider
      // refuses (validation.valid: false), never attempted for signing at all.
      return {
        bytes: new TextEncoder().encode(unsignedXml),
        validation: { valid: false, errors: unsignedResult.errors },
      };
    }

    if (!companyId) {
      // No company context at all (should not happen for a real caller — see this file's own
      // header) — cannot even ATTEMPT to resolve a certificate, so refuse naming exactly that,
      // rather than silently shipping an unsigned Facturae that looks FACe-ready but is not.
      throw new FacturaeSigningRequiredError(
        'Cannot build a Facturae document without a company context — FACe requires a Facturae ' +
          'signed with XAdES, and no signing certificate can be resolved without knowing which ' +
          "company's certificate to use.",
      );
    }

    const certRef = certRefFor(companyId);
    const signed = await registry
      .get('XAdES')
      .sign(
        { mime: 'application/xml', bytes: new TextEncoder().encode(unsignedXml), label: 'facturae' },
        certRef,
        log,
      );

    if (!signed.signature) {
      // Covers BOTH of this file's own refusal cases (header, points 3 and 4): no certificate was
      // resolved at all, OR one was resolved but the XAdES sign operation itself failed —
      // `XadesSigningProvider.sign()` returns the SAME shape (no `signature` field) either way, and
      // both are refused here rather than shipped as a silently-unsigned "success". See MUTATION
      // GUARD #1 in `facturae-provider.spec.ts`: skipping this check is exactly the bug it exists
      // to catch.
      throw new FacturaeSigningRequiredError(
        `no active XAdES-applicable signing certificate is configured for this company (or signing ` +
          `it failed) — FACe requires a Facturae document signed with XAdES, never an unsigned one. ` +
          `Add or fix a certificate at Company settings → Signing certificates (applicability ` +
          `"XAdES" or "*") before sending.`,
      );
    }

    // Re-validate the SIGNED document against the SAME XSD — the vendored schema accepts
    // `ds:Signature` as the root's last child (see this file's own header), so a signature that
    // somehow broke the document's own structure is caught here, not discovered later at FACe.
    const signedXmlStr = Buffer.from(signed.bytes).toString('utf-8');
    const signedResult = await validateXsd(signedXmlStr, FACTURAE_XSD);
    return { bytes: signed.bytes, validation: { valid: signedResult.valid, errors: signedResult.errors } };
  }

  return {
    id: 'facturae',
    syntax: 'ES_FACTURAE',
    mime: 'application/xml',
    build,
  };
}
