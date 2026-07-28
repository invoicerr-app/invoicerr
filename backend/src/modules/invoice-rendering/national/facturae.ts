/**
 * Facturae 3.2.2 (ES) builder.
 *
 * Extracted verbatim from InvoiceRenderingService (behaviour-preserving).
 */
import { getIdentifier } from '@/utils/entity-identifiers';
import type { InvoiceRenderData } from '../render-data';

/**
 * Facturae 3.2.2 XML (ES) — XSD-valid structure.
 *
 * Compliant with the official Facturaev3_2_2.xsd (targetNamespace
 * http://www.facturae.gob.es/formato/Versiones/Facturaev3_2_2.xml).
 * Schema vendored under backend/src/compliance/schemas/es/.
 *
 * Required fields covered: FileHeader (SchemaVersion, Modality, InvoiceIssuerType, Batch),
 * Parties (TaxIdentification with ResidenceTypeCode, LegalEntity with address),
 * Invoice (InvoiceHeader, InvoiceIssueData, TaxesOutputs, InvoiceTotals, Items).
 *
 * XAdES-BES signature block is NOT included here — the signing port adds it.
 */
export async function buildFacturae(data: InvoiceRenderData): Promise<string> {
  const NS = 'http://www.facturae.gob.es/formato/Versiones/Facturaev3_2_2.xml';
  const issueDate = (data.issuedAt ?? data.createdAt).toISOString().split('T')[0];
  const currency = data.company.currency || 'EUR';
  const vatId = getIdentifier(data.company, 'VAT') || '';
  const clientVatId = getIdentifier(data.client, 'VAT') || '';
  const invoiceNumber = (data.rawNumber || data.number?.toString() || 'DRAFT').substring(0, 20);

  // Totals
  const totalNet = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const totalVat = data.items.reduce((s, i) => s + (i.quantity * i.unitPrice * (i.vatRate || 0)) / 100, 0);
  const invoiceTotal = totalNet + totalVat;

  // Aggregate invoice-level taxes by VAT rate
  const taxByRate = new Map<number, number>();
  for (const item of data.items) {
    const rate = item.vatRate || 0;
    const base = item.quantity * item.unitPrice;
    taxByRate.set(rate, (taxByRate.get(rate) ?? 0) + base);
  }

  /** Escape XML special characters in element text content. */
  const esc = (s: string | null | undefined): string =>
    (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /**
   * Detect if country is Spain → AddressInSpain; otherwise → OverseasAddress.
   * Facturae AddressInSpain requires CountryCode="ESP" (ISO 3166-1 alpha-3).
   */
  const isSpain = (country: string | null | undefined): boolean =>
    /^(spain|españa|es|esp)$/i.test((country ?? '').trim());

  /** Map ISO-2 or common country names to ISO 3166-1 alpha-3 (best-effort). */
  const toAlpha3 = (country: string | null | undefined): string => {
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
  };

  /** Build the XML block for a party address (AddressInSpain or OverseasAddress). */
  const buildAddress = (
    address: string | null,
    city: string | null,
    postalCode: string | null,
    country: string | null,
  ): string => {
    const addr = esc(address || 'N/A').substring(0, 80);
    const town = esc(city || 'N/A').substring(0, 50);
    const province = esc(city || 'N/A').substring(0, 20);
    const countryCode = toAlpha3(country);

    if (isSpain(country)) {
      // PostCodeType: exactly 5 numeric digits
      const postCode = (postalCode ?? '').replace(/\D/g, '').padStart(5, '0').substring(0, 5);
      return `
            <AddressInSpain>
              <Address>${addr}</Address>
              <PostCode>${postCode}</PostCode>
              <Town>${town}</Town>
              <Province>${province}</Province>
              <CountryCode>${countryCode}</CountryCode>
            </AddressInSpain>`;
    }
    const postCodeAndTown = esc(`${postalCode ?? ''} ${city ?? ''}`.trim() || 'N/A').substring(0, 50);
    return `
            <OverseasAddress>
              <Address>${addr}</Address>
              <PostCodeAndTown>${postCodeAndTown}</PostCodeAndTown>
              <Province>${province}</Province>
              <CountryCode>${countryCode}</CountryCode>
            </OverseasAddress>`;
  };

  /** Build a Facturae party block (BusinessType: TaxIdentification + LegalEntity). */
  const buildParty = (
    name: string | null,
    vatIdStr: string,
    personType: 'J' | 'F',
    address: string | null,
    city: string | null,
    postalCode: string | null,
    country: string | null,
  ): string => {
    const corpName = esc(name || 'N/A').substring(0, 80);
    const addrXml = buildAddress(address, city, postalCode, country);
    return `
        <TaxIdentification>
          <PersonTypeCode>${personType}</PersonTypeCode>
          <ResidenceTypeCode>R</ResidenceTypeCode>
          <TaxIdentificationNumber>${esc(vatIdStr)}</TaxIdentificationNumber>
        </TaxIdentification>
        <LegalEntity>
          <CorporateName>${corpName}</CorporateName>${addrXml}
        </LegalEntity>`;
  };

  // Invoice-level TaxesOutputs (one Tax entry per unique VAT rate)
  const invoiceTaxesXml = Array.from(taxByRate.entries())
    .map(([rate, base]) => {
      const taxAmt = (base * rate) / 100;
      return `
        <Tax>
          <TaxTypeCode>01</TaxTypeCode>
          <TaxRate>${rate}</TaxRate>
          <TaxableBase><TotalAmount>${base}</TotalAmount></TaxableBase>
          <TaxAmount><TotalAmount>${taxAmt}</TotalAmount></TaxAmount>
        </Tax>`;
    })
    .join('');

  // Line items
  const itemsXml = data.items
    .map((item) => {
      const gross = item.quantity * item.unitPrice;
      const taxAmt = (gross * (item.vatRate || 0)) / 100;
      const desc = esc(item.name || 'Service').substring(0, 2500);
      return `
        <InvoiceLine>
          <ItemDescription>${desc}</ItemDescription>
          <Quantity>${item.quantity}</Quantity>
          <UnitPriceWithoutTax>${item.unitPrice}</UnitPriceWithoutTax>
          <TotalCost>${gross}</TotalCost>
          <GrossAmount>${gross}</GrossAmount>
          <TaxesOutputs>
            <Tax>
              <TaxTypeCode>01</TaxTypeCode>
              <TaxRate>${item.vatRate || 0}</TaxRate>
              <TaxableBase><TotalAmount>${gross}</TotalAmount></TaxableBase>
              <TaxAmount><TotalAmount>${taxAmt}</TotalAmount></TaxAmount>
            </Tax>
          </TaxesOutputs>
        </InvoiceLine>`;
    })
    .join('');

  const clientName =
    data.client.name || `${data.client.contactFirstname ?? ''} ${data.client.contactLastname ?? ''}`.trim();
  const personType: 'J' | 'F' = data.client.type === 'COMPANY' ? 'J' : 'F';

  // Facturae XSD has elementFormDefault="unqualified" — only the root element is
  // namespace-qualified (fe: prefix). All child elements are in no-namespace.
  return `<?xml version="1.0" encoding="UTF-8"?>
<fe:Facturae xmlns:fe="${NS}" xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
  <FileHeader>
    <SchemaVersion>3.2.2</SchemaVersion>
    <Modality>I</Modality>
    <InvoiceIssuerType>EM</InvoiceIssuerType>
    <Batch>
      <BatchIdentifier>${esc(`${vatId}-${invoiceNumber}`).substring(0, 70)}</BatchIdentifier>
      <InvoicesCount>1</InvoicesCount>
      <TotalInvoicesAmount><TotalAmount>${invoiceTotal}</TotalAmount></TotalInvoicesAmount>
      <TotalOutstandingAmount><TotalAmount>${invoiceTotal}</TotalAmount></TotalOutstandingAmount>
      <TotalExecutableAmount><TotalAmount>${invoiceTotal}</TotalAmount></TotalExecutableAmount>
      <InvoiceCurrencyCode>${currency}</InvoiceCurrencyCode>
    </Batch>
  </FileHeader>
  <Parties>
    <SellerParty>${buildParty(
      data.company.name,
      vatId,
      'J',
      data.company.address,
      data.company.city,
      data.company.postalCode,
      data.company.country,
    )}
    </SellerParty>
    <BuyerParty>${buildParty(
      clientName,
      clientVatId,
      personType,
      data.client.address,
      data.client.city,
      data.client.postalCode,
      data.client.country,
    )}
    </BuyerParty>
  </Parties>
  <Invoices>
    <Invoice>
      <InvoiceHeader>
        <InvoiceNumber>${esc(invoiceNumber)}</InvoiceNumber>
        <InvoiceDocumentType>FC</InvoiceDocumentType>
        <InvoiceClass>OO</InvoiceClass>
      </InvoiceHeader>
      <InvoiceIssueData>
        <IssueDate>${issueDate}</IssueDate>
        <InvoiceCurrencyCode>${currency}</InvoiceCurrencyCode>
        <TaxCurrencyCode>${currency}</TaxCurrencyCode>
        <LanguageName>es</LanguageName>
      </InvoiceIssueData>
      <TaxesOutputs>${invoiceTaxesXml}
      </TaxesOutputs>
      <InvoiceTotals>
        <TotalGrossAmount>${totalNet}</TotalGrossAmount>
        <TotalGrossAmountBeforeTaxes>${totalNet}</TotalGrossAmountBeforeTaxes>
        <TotalTaxOutputs>${totalVat}</TotalTaxOutputs>
        <TotalTaxesWithheld>0</TotalTaxesWithheld>
        <InvoiceTotal>${invoiceTotal}</InvoiceTotal>
        <TotalOutstandingAmount>${invoiceTotal}</TotalOutstandingAmount>
        <TotalExecutableAmount>${invoiceTotal}</TotalExecutableAmount>
      </InvoiceTotals>
      <Items>${itemsXml}
      </Items>
    </Invoice>
  </Invoices>
</fe:Facturae>`;
}
