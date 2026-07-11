/**
 * MENA national e-invoice skeleton builders (live-deferred scaffolds).
 *
 * Pure functions: InvoiceRenderData in, national XML/JSON string out.
 * Extracted verbatim from InvoiceRenderingService (behaviour-preserving).
 */
import { getIdentifier } from '@/utils/entity-identifiers';
import type { InvoiceRenderData } from '../render-data';
import { sumNet, sumVat, isoDate } from './xml-helpers';

export function buildTrEfatura(data: InvoiceRenderData): string {
  const issueDate = isoDate(data);
  const vknTckn = getIdentifier(data.company, 'VAT') || '';
  const total = sumNet(data.items);
  const totalIVA = sumVat(data.items);
  return `<!-- TODO: Turkey e-Fatura (GİB) — requires e-İmza + KEP -->
<Invoice>
  <Header><ID>${data.rawNumber || 'DRAFT'}</ID><IssueDate>${issueDate}</IssueDate><IssueTime>12:00:00</IssueTime><CurrencyCode>${data.company.currency || 'TRY'}</CurrencyCode></Header>
  <Sender><ID><VKN_TCKN>${vknTckn}</VKN_TCKN></ID><Name>${data.company.name}</Name></Sender>
  <Receiver><ID><VKN_TCKN>${getIdentifier(data.client, 'VAT') || ''}</VKN_TCKN></ID><Name>${data.client.name}</Name></Receiver>
  <Lines>${data.items.map((item, i) => `<Line><Order>${i + 1}</Order><ItemName>${item.name}</ItemName><Quantity>${item.quantity}</Quantity><UnitPrice>${item.unitPrice}</UnitPrice><Price>${(item.quantity * item.unitPrice).toFixed(2)}</Price></Line>`).join('')}</Lines>
  <Totals><SubTotal>${total.toFixed(2)}</SubTotal><Tax>${totalIVA.toFixed(2)}</Tax><GrandTotal>${(total + totalIVA).toFixed(2)}</GrandTotal></Totals>
</Invoice>
<!-- TODO: e-İmza (digital signature) + KEP submission to GİB -->`;
}

export function buildEgEta(data: InvoiceRenderData): string {
  const issueDate = isoDate(data);
  const tin = getIdentifier(data.company, 'VAT') || '';
  const total = sumNet(data.items);
  const totalIVA = sumVat(data.items);
  return `<!-- TODO: Egypt ETA (E-Invoicing) — requires UUID + QR Code -->
<Invoice>
  <Header><UUID>${data.rawNumber || 'DRAFT'}</UUID><IssueDate>${issueDate}</IssueDate></Header>
  <Seller><TIN>${tin}</TIN><Name>${data.company.name}</Name></Seller>
  <Buyer><TIN>${getIdentifier(data.client, 'VAT') || ''}</TIN><Name>${data.client.name}</Name></Buyer>
  <Lines>${data.items.map((item, i) => `<Line><Index>${i + 1}</Index><ItemName>${item.name}</ItemName><Quantity>${item.quantity}</Quantity><UnitPrice>${item.unitPrice}</UnitPrice></Line>`).join('')}</Lines>
  <Totals><SubTotal>${total.toFixed(2)}</SubTotal><TaxAmount>${totalIVA.toFixed(2)}</TaxAmount><GrandTotal>${(total + totalIVA).toFixed(2)}</GrandTotal></Totals>
</Invoice>
<!-- TODO: UUID + QR Code (ETA submission) -->`;
}

/**
 * Jordan JoFotara e-invoice (ISTD national platform, UBL-based).
 * TODO: embed mandatory ISTD namespace extensions; add QR/hash seam;
 *   register with ISTD and obtain merchant credential; POST to JoFotara API.
 */
export function buildJoJofotara(data: InvoiceRenderData): string {
  const issueDate = isoDate(data);
  const tin = getIdentifier(data.company, 'VAT') || '';
  const total = sumNet(data.items);
  const totalVat = sumVat(data.items);
  return `<!-- TODO: Jordan JoFotara (ISTD) — UBL 2.1 + ISTD extensions; QR seam; merchant registration -->
<ubl:Invoice xmlns:ubl="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
             xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
             xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
             xmlns:istd="urn:jo:istd:jofotara:extensions:1">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:istd.gov.jo:jofotara:1.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:jo:istd:einvoice:1.0</cbc:ProfileID>
  <cbc:ID>${data.rawNumber || 'DRAFT'}</cbc:ID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  <cbc:InvoiceTypeCode>388</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${data.company.currency || 'JOD'}</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${tin}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity><cbc:RegistrationName>${data.company.name}</cbc:RegistrationName></cac:PartyLegalEntity>
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
    <cbc:TaxAmount currencyID="${data.company.currency || 'JOD'}">${totalVat.toFixed(3)}</cbc:TaxAmount>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="${data.company.currency || 'JOD'}">${total.toFixed(3)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${data.company.currency || 'JOD'}">${(total + totalVat).toFixed(3)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${data.company.currency || 'JOD'}">${(total + totalVat).toFixed(3)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  ${data.items
    .map(
      (item, i) => `<cac:InvoiceLine>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">${item.quantity}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${data.company.currency || 'JOD'}">${(item.quantity * item.unitPrice).toFixed(3)}</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name>${item.name}</cbc:Name></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="${data.company.currency || 'JOD'}">${item.unitPrice.toFixed(3)}</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>`,
    )
    .join('\n  ')}
  <istd:QRCode>TODO-JOFOTARA-QR</istd:QRCode>
</ubl:Invoice>
<!-- TODO: ISTD JoFotara merchant registration; POST to national platform; embed QR code -->`;
}

/**
 * Tunisia TEIF (Titre Electronique d'Imputation Fiscale) / El Fatoora via TTN (TradeNet).
 * TODO: build full TEIF XML per DGI/TTN schema; embed seller MF + buyer info;
 *   sign with qualified certificate; POST to TTN El Fatoora gateway.
 */
export function buildTnTeif(data: InvoiceRenderData): string {
  const issueDate = isoDate(data);
  const mf = getIdentifier(data.company, 'VAT') || '';
  const total = sumNet(data.items);
  const totalTva = sumVat(data.items);
  return `<!-- TODO: Tunisia TEIF (El Fatoora/TTN) — DGI TEIF schema; qualified signature; POST to TTN gateway -->
<TEIF xmlns="urn:tn:dgi:teif:v1" xmlns:ttn="urn:tn:tradenet:elfattoura:1">
  <Entete>
    <NumeroFacture>${data.rawNumber || 'DRAFT'}</NumeroFacture>
    <DateEmission>${issueDate}</DateEmission>
    <TypeDocument>FV</TypeDocument>
    <Devise>${data.company.currency || 'TND'}</Devise>
  </Entete>
  <Vendeur>
    <MatriculeFiscal>${mf}</MatriculeFiscal>
    <RaisonSociale>${data.company.name}</RaisonSociale>
    <Adresse>${data.company.address || 'TODO'}</Adresse>
    <Ville>${data.company.city || ''}</Ville>
    <CodePostal>${data.company.postalCode || ''}</CodePostal>
  </Vendeur>
  <Acheteur>
    <MatriculeFiscal>${getIdentifier(data.client, 'VAT') || ''}</MatriculeFiscal>
    <RaisonSociale>${data.client.name}</RaisonSociale>
    <Adresse>${data.client.address || 'TODO'}</Adresse>
  </Acheteur>
  <Lignes>${data.items
    .map(
      (item, i) => `
    <Ligne>
      <Numero>${i + 1}</Numero>
      <Designation>${item.name}</Designation>
      <Quantite>${item.quantity}</Quantite>
      <PrixUnitaireHT>${item.unitPrice.toFixed(3)}</PrixUnitaireHT>
      <MontantHT>${(item.quantity * item.unitPrice).toFixed(3)}</MontantHT>
      <TauxTVA>${item.vatRate || 19}</TauxTVA>
      <MontantTVA>${((item.quantity * item.unitPrice * (item.vatRate || 19)) / 100).toFixed(3)}</MontantTVA>
      <MontantTTC>${(item.quantity * item.unitPrice * (1 + (item.vatRate || 19) / 100)).toFixed(3)}</MontantTTC>
    </Ligne>`,
    )
    .join('')}
  </Lignes>
  <Totaux>
    <TotalHT>${total.toFixed(3)}</TotalHT>
    <TotalTVA>${totalTva.toFixed(3)}</TotalTVA>
    <TotalTTC>${(total + totalTva).toFixed(3)}</TotalTTC>
  </Totaux>
  <Signature>TODO-QUALIFIED-SIGNATURE-SEAM</Signature>
</TEIF>
<!-- TODO: DGI TEIF schema validation; qualified certificate signing; POST to TTN El Fatoora API -->`;
}
