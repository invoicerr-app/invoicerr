/**
 * Europe national (non-EN16931-core) e-invoice skeleton builders (live-deferred scaffolds).
 *
 * Pure functions: InvoiceRenderData in, national XML/JSON string out.
 * Extracted verbatim from InvoiceRenderingService (behaviour-preserving).
 */
import { getIdentifier } from '@/utils/entity-identifiers';
import type { InvoiceRenderData } from '../render-data';
import { sumNet, sumVat, isoDate } from './xml-helpers';

export function buildGrMydata(data: InvoiceRenderData): string {
  const issueDate = isoDate(data);
  const afm = getIdentifier(data.company, 'VAT') || '';
  const total = sumNet(data.items);
  const totalIVA = sumVat(data.items);
  return `<!-- TODO: Greece myDATA (AADE) — requires UBL/CII XML + Digital Signature + AADE submission -->
<myDATA:Invoice xmlns:myDATA="https://www.aade.gr/myDATA/invoice/v1.0">
  <myDATA:InvoiceHeader>
    <myDATA:series>AA</myDATA:series>
    <myDATA:number>${data.rawNumber || 'DRAFT'}</myDATA:number>
    <myDATA:issueDate>${issueDate}</myDATA:issueDate>
    <myDATA:invoiceType>11.1</myDATA:invoiceType>
    <myDATA:currencyCode>EUR</myDATA:currencyCode>
  </myDATA:InvoiceHeader>
  <myDATA:Issuer>
    <myDATA:vatNumber>${afm}</myDATA:vatNumber>
    <myDATA:name>${data.company.name}</myDATA:name>
  </myDATA:Issuer>
  <myDATA:Counterpart>
    <myDATA:vatNumber>${getIdentifier(data.client, 'VAT') || ''}</myDATA:vatNumber>
    <myDATA:name>${data.client.name}</myDATA:name>
  </myDATA:Counterpart>
  <myDATA:InvoiceDetails>${data.items
    .map(
      (item, i) => `<myDATA:InvoiceDetail>
    <myDATA:lineNumber>${i + 1}</myDATA:lineNumber>
    <myDATA:detailType>1</myDATA:detailType>
    <myDATA:quantity>${item.quantity}</myDATA:quantity>
    <myDATA:unitPrice>${item.unitPrice}</myDATA:unitPrice>
    <myDATA:vatCategory>${item.vatRate > 0 ? '1' : '7'}</myDATA:vatCategory>
    <myDATA:vatAmount>${((item.quantity * item.unitPrice * (item.vatRate || 0)) / 100).toFixed(2)}</myDATA:vatAmount>
  </myDATA:InvoiceDetail>`,
    )
    .join('')}</myDATA:InvoiceDetails>
  <myDATA:InvoiceSummary>
    <myDATA:totalNetValue>${total.toFixed(2)}</myDATA:totalNetValue>
    <myDATA:totalVatAmount>${totalIVA.toFixed(2)}</myDATA:totalVatAmount>
    <myDATA:totalWithVat>${(total + totalIVA).toFixed(2)}</myDATA:totalWithVat>
  </myDATA:InvoiceSummary>
</myDATA:Invoice>
<!-- TODO: Digital Signature (Qualif. Electronic Signature) + AADE Taxisnet submission + Mark (if >€150) -->`;
}

export function buildHuSzM(data: InvoiceRenderData): string {
  const issueDate = isoDate(data);
  const adoszam = getIdentifier(data.company, 'VAT') || '';
  const total = sumNet(data.items);
  const totalIVA = sumVat(data.items);
  return `<!-- TODO: Hungary Online Számla (NAV) — requires UBL 2.1 XML + API token + Real-time XML -->
<Invoice xmlns="urn:peppol.eu:xsd:en16931:2" xmlns:ext="urn:central:not:opentender:schema:xsd:ExtensionComponents-1">
  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionID>1</ext:ExtensionID>
      <ext:ExtensionAgencyID>10</ext:ExtensionAgencyID>
      <ext:ExtensionAgencyName>NAVA</ext:ExtensionAgencyName>
    </ext:UBLExtension>
  </ext:UBLExtensions>
  <ID>${data.rawNumber || 'DRAFT'}</ID>
  <IssueDate>${issueDate}</IssueDate>
  <InvoiceTypeCode>380</InvoiceTypeCode>
  <DocumentCurrencyCode>HUF</DocumentCurrencyCode>
  <AccountingSupplierParty>
    <Party>
      <EndpointID schemeID="2.1">${adoszam}</EndpointID>
      <PartyName><Name>${data.company.name}</Name></PartyName>
    </Party>
  </AccountingSupplierParty>
  <AccountingCustomerParty>
    <Party>
      <EndpointID schemeID="2.1">${getIdentifier(data.client, 'VAT') || ''}</EndpointID>
      <PartyName><Name>${data.client.name}</Name></PartyName>
    </Party>
  </AccountingCustomerParty>
  <LegalMonetaryTotal>
    <TaxExclusiveAmount currencyID="HUF">${total.toFixed(2)}</TaxExclusiveAmount>
    <TaxInclusiveAmount currencyID="HUF">${(total + totalIVA).toFixed(2)}</TaxInclusiveAmount>
  </LegalMonetaryTotal>
  ${data.items
    .map(
      (item, i) => `<InvoiceLine>
    <ID>${i + 1}</ID>
    <InvoicedQuantity>${item.quantity}</InvoicedQuantity>
    <LineExtensionAmount currencyID="HUF">${(item.quantity * item.unitPrice).toFixed(2)}</LineExtensionAmount>
    <Item>
      <Name>${item.name}</Name>
      <ClassifiedTaxCategory><ID>${item.vatRate > 0 ? 'AAA' : 'AAM'}</ID><Percent>${item.vatRate || 0}</Percent></ClassifiedTaxCategory>
    </Item>
    <Price><PriceAmount currencyID="HUF">${item.unitPrice}</PriceAmount></Price>
  </InvoiceLine>`,
    )
    .join('\n  ')}
</Invoice>
<!-- TODO: API token registration (NAV) + Real-time XML submission + Transaction ID -->`;
}

/**
 * Ukraine DPS tax-invoice (податкова накладна) for ЄРПН registration.
 * TODO: build full DPS XML per ДПС schema; apply qualified e-signature (КЕП);
 *   submit to ЄРПН via cabinet.tax.gov.ua API; handle blocking/unblocking.
 */
export function buildUaTaxinvoice(data: InvoiceRenderData): string {
  const issueDate = isoDate(data);
  const ipn = getIdentifier(data.company, 'VAT') || '';
  const total = sumNet(data.items);
  const totalPdv = sumVat(data.items);
  return `<!-- TODO: Ukraine DPS Податкова Накладна — ДПС XML schema; КЕП qualified signature; ЄРПН registration -->
<DECLAR xmlns="http://www.dps.gov.ua/pdv/pn/pn_schema_v1" version="1">
  <DECLARHEAD>
    <HType>1</HType>
    <HNUM>${data.rawNumber || 'DRAFT'}</HNUM>
    <HDATE>${issueDate}</HDATE>
    <HPERIOD>${issueDate.substring(0, 7)}</HPERIOD>
    <HCNT>${data.company.name}</HCNT>
    <HTIN>${ipn}</HTIN>
  </DECLARHEAD>
  <DECLARBODY>
    <BODY_R01C01>${data.client.name}</BODY_R01C01>
    <BODY_R01C02>${getIdentifier(data.client, 'VAT') || ''}</BODY_R01C02>
    <ITEMS>${data.items
      .map(
        (item, i) => `
      <ITEM>
        <NUM>${i + 1}</NUM>
        <DESCRIPTION>${item.name}</DESCRIPTION>
        <QTY>${item.quantity}</QTY>
        <PRICE>${item.unitPrice.toFixed(2)}</PRICE>
        <AMOUNT>${(item.quantity * item.unitPrice).toFixed(2)}</AMOUNT>
        <PDV_RATE>${item.vatRate || 20}</PDV_RATE>
        <PDV_AMOUNT>${((item.quantity * item.unitPrice * (item.vatRate || 20)) / 100).toFixed(2)}</PDV_AMOUNT>
      </ITEM>`,
      )
      .join('')}
    </ITEMS>
    <TOT_SUM>${total.toFixed(2)}</TOT_SUM>
    <TOT_PDV>${totalPdv.toFixed(2)}</TOT_PDV>
    <TOT_TOTAL>${(total + totalPdv).toFixed(2)}</TOT_TOTAL>
  </DECLARBODY>
</DECLAR>
<!-- TODO: КЕП (qualified e-signature via КНЕДП); submit to DPS API; poll ЄРПН status -->`;
}

/**
 * Montenegro fiscalization XML (IKOF/JIKR).
 * TODO: implement Porezna Uprava fiscalization spec; generate IKOF (issuer code);
 *   POST to PU CIS fiscalization endpoint (real-time); receive JIKR.
 */
export function buildMeFiscal(data: InvoiceRenderData): string {
  const issueDate = isoDate(data);
  const pib = getIdentifier(data.company, 'VAT') || '';
  const total = sumNet(data.items);
  const totalPdv = sumVat(data.items);
  return `<!-- TODO: Montenegro Fiscalization (Porezna Uprava) — IKOF generation; POST to CIS; receive JIKR -->
<FiscalInvoice xmlns="urn:me:pu:fiscalization:v3">
  <Header>
    <InvoiceNumber>${data.rawNumber || 'DRAFT'}</InvoiceNumber>
    <IssueDateTime>${issueDate}T12:00:00+02:00</IssueDateTime>
    <InvoiceType>CASH</InvoiceType>
    <Currency>${data.company.currency || 'EUR'}</Currency>
    <IKOF>TODO-IKOF-ISSUER-CODE-OF-INVOICE</IKOF>
  </Header>
  <Seller>
    <PIB>${pib}</PIB>
    <Name>${data.company.name}</Name>
    <Address>${data.company.address || 'TODO'}</Address>
    <City>${data.company.city || ''}</City>
  </Seller>
  <Buyer>
    <PIB>${getIdentifier(data.client, 'VAT') || ''}</PIB>
    <Name>${data.client.name}</Name>
  </Buyer>
  <Items>${data.items
    .map(
      (item, i) => `
    <Item>
      <Number>${i + 1}</Number>
      <Name>${item.name}</Name>
      <Quantity>${item.quantity}</Quantity>
      <UnitPrice>${item.unitPrice.toFixed(2)}</UnitPrice>
      <VatRate>${item.vatRate || 21}</VatRate>
      <GrossAmount>${(item.quantity * item.unitPrice * (1 + (item.vatRate || 21) / 100)).toFixed(2)}</GrossAmount>
    </Item>`,
    )
    .join('')}
  </Items>
  <Totals>
    <TotalBeforeVAT>${total.toFixed(2)}</TotalBeforeVAT>
    <TotalVAT>${totalPdv.toFixed(2)}</TotalVAT>
    <TotalWithVAT>${(total + totalPdv).toFixed(2)}</TotalWithVAT>
  </Totals>
  <JIKR>TODO-JIKR-FROM-CIS</JIKR>
  <QRCode>TODO-QR</QRCode>
</FiscalInvoice>
<!-- TODO: IKOF (RSA signature of invoice data); POST to PU CIS; embed received JIKR + QR code -->`;
}

/**
 * Croatia e-Račun (UBL 2.1 / EN 16931 + CIUS-HR) for Fiskalizacija 2.0 / CIS.
 * TODO: apply CIUS-HR customization (ProfileID, extension namespace);
 *   fiscalize via HTTPS to CIS (ws.eracun.hr); sign with FINA qualified certificate.
 */
export function buildHrEracun(data: InvoiceRenderData): string {
  const issueDate = isoDate(data);
  const oib = getIdentifier(data.company, 'VAT') || '';
  const total = sumNet(data.items);
  const totalPdv = sumVat(data.items);
  return `<!-- TODO: Croatia e-Račun (CIUS-HR / Fiskalizacija 2.0) — FINA cert signing; POST to CIS -->
<ubl:Invoice xmlns:ubl="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
             xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
             xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
             xmlns:hr="urn:fina.hr:eracun:extensions:1">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fina.hr:eracun:1.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fina.hr:eracun:2.0</cbc:ProfileID>
  <cbc:ID>${data.rawNumber || 'DRAFT'}</cbc:ID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${data.company.currency || 'EUR'}</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${oib}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${data.company.name}</cbc:RegistrationName>
        <cbc:CompanyID>${oib.replace(/^HR/, '')}</cbc:CompanyID><!-- OIB (11 digits) -->
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${getIdentifier(data.client, 'VAT') || ''}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity><cbc:RegistrationName>${data.client.name}</cbc:RegistrationName></cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${data.company.currency || 'EUR'}">${totalPdv.toFixed(2)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${data.company.currency || 'EUR'}">${total.toFixed(2)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${data.company.currency || 'EUR'}">${totalPdv.toFixed(2)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>25</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="${data.company.currency || 'EUR'}">${total.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${data.company.currency || 'EUR'}">${(total + totalPdv).toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${data.company.currency || 'EUR'}">${(total + totalPdv).toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  ${data.items
    .map(
      (item, i) => `<cac:InvoiceLine>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">${item.quantity}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${data.company.currency || 'EUR'}">${(item.quantity * item.unitPrice).toFixed(2)}</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name>${item.name}</cbc:Name></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="${data.company.currency || 'EUR'}">${item.unitPrice.toFixed(2)}</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>`,
    )
    .join('\n  ')}
  <hr:FiskalizacijaData>
    <hr:ZKI>TODO-ZKI-PROTECTION-CODE</hr:ZKI>
    <hr:JIR>TODO-JIR-FROM-CIS</hr:JIR>
    <hr:QRCode>TODO-QR</hr:QRCode>
  </hr:FiskalizacijaData>
</ubl:Invoice>
<!-- TODO: ZKI (zaštitni kod ispis — MD5 of seller data); POST to ws.eracun.hr CIS; embed JIR + QR -->`;
}

/**
 * Albania CIS fiscalization (UBL-based, NIPT identifier).
 * TODO: implement Albanian NIC (NSLF/NIVF) fiscalization spec;
 *   POST to Albanian CIS; receive NIVF (unique identification number);
 *   embed NSLF + QR on printout.
 */
export function buildAlFiscalization(data: InvoiceRenderData): string {
  const issueDate = isoDate(data);
  const nipt = getIdentifier(data.company, 'VAT') || '';
  const total = sumNet(data.items);
  const totalTvsh = sumVat(data.items);
  return `<!-- TODO: Albania CIS Fiscalization — NIC schema; NSLF computation; POST to CIS; embed NIVF + QR -->
<FiscalInvoice xmlns="urn:al:tatime:cis:fiscalization:v1">
  <Header>
    <IIC>${data.rawNumber || 'DRAFT'}</IIC><!-- Issuer Invoice Code (NSLF) -->
    <IssueDateTime>${issueDate}T12:00:00+02:00</IssueDateTime>
    <InvoiceType>CASH</InvoiceType>
    <Currency>${data.company.currency || 'ALL'}</Currency>
    <NSLF>TODO-NSLF-SELLER-SELF-CONTROL-CODE</NSLF>
  </Header>
  <Seller>
    <NIPT>${nipt}</NIPT>
    <Name>${data.company.name}</Name>
    <Address>${data.company.address || 'TODO'}</Address>
    <City>${data.company.city || ''}</City>
  </Seller>
  <Buyer>
    <NIPT>${getIdentifier(data.client, 'VAT') || ''}</NIPT>
    <Name>${data.client.name}</Name>
  </Buyer>
  <Items>${data.items
    .map(
      (item, i) => `
    <Item>
      <Number>${i + 1}</Number>
      <Name>${item.name}</Name>
      <Quantity>${item.quantity}</Quantity>
      <UnitPrice>${item.unitPrice.toFixed(2)}</UnitPrice>
      <VatRate>${item.vatRate || 20}</VatRate>
      <VatAmount>${((item.quantity * item.unitPrice * (item.vatRate || 20)) / 100).toFixed(2)}</VatAmount>
      <TotalWithVat>${(item.quantity * item.unitPrice * (1 + (item.vatRate || 20) / 100)).toFixed(2)}</TotalWithVat>
    </Item>`,
    )
    .join('')}
  </Items>
  <Totals>
    <TotalWithoutVAT>${total.toFixed(2)}</TotalWithoutVAT>
    <TotalVAT>${totalTvsh.toFixed(2)}</TotalVAT>
    <TotalWithVAT>${(total + totalTvsh).toFixed(2)}</TotalWithVAT>
  </Totals>
  <NIVF>TODO-NIVF-FROM-CIS</NIVF><!-- Numri i Identifikimit të Veçantë të Faturës -->
  <QRCode>TODO-QR</QRCode>
</FiscalInvoice>
<!-- TODO: NSLF (RSA-2048 signature of key fields); POST to Albanian CIS; embed NIVF + QR code -->`;
}
