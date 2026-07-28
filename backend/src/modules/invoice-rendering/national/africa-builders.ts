/**
 * Africa national e-invoice skeleton builders (live-deferred scaffolds).
 *
 * Pure functions: InvoiceRenderData in, national XML/JSON string out.
 * Extracted verbatim from InvoiceRenderingService (behaviour-preserving).
 */
import { getIdentifier } from '@/utils/entity-identifiers';
import type { InvoiceRenderData } from '../render-data';
import { sumNet, isoDate } from './xml-helpers';

/**
 * Nigeria FIRS MBS e-invoice.
 * Schema: FIRS MBS API payload (JSON-over-HTTPS).
 * TODO: compute IRN (SHA-256 of tin|invoiceNo|serviceId|date);
 *   sign with FIRS-certified certificate (XAdES/PKCS#7);
 *   embed QR code in invoice PDF; submit via /api/v1/invoice/submit.
 */
export function buildNgFirs(data: InvoiceRenderData): string {
  const issueDate = isoDate(data);
  const tin = getIdentifier(data.company, 'VAT') || '';
  const total = sumNet(data.items);
  const vat = total * 0.075; // Nigeria VAT 7.5%
  return `<!-- TODO: Nigeria FIRS MBS e-invoice — IRN (SHA-256) + QR + FIRS certificate signing -->
<FirsInvoice xmlns="urn:ng:firs:mbs:v1">
  <Header>
    <InvoiceNo>${data.rawNumber || 'DRAFT'}</InvoiceNo>
    <IssueDate>${issueDate}</IssueDate>
    <Currency>${data.company.currency || 'NGN'}</Currency>
    <ServiceId>TODO-FIRS-SERVICE-ID</ServiceId>
  </Header>
  <Supplier>
    <BusinessName>${data.company.name}</BusinessName>
    <TIN>${tin}</TIN>
    <Address>${data.company.address || 'TODO'}</Address>
  </Supplier>
  <Buyer>
    <Name>${data.client.name}</Name>
    <TIN>${getIdentifier(data.client, 'VAT') || '0000000000000'}</TIN>
    <Address>${data.client.address || 'TODO'}</Address>
  </Buyer>
  <Lines>${data.items
    .map(
      (item, i) => `
    <Line>
      <Seq>${i + 1}</Seq>
      <Description>${item.name}</Description>
      <Qty>${item.quantity}</Qty>
      <UnitPrice>${item.unitPrice.toFixed(2)}</UnitPrice>
      <TaxableAmt>${(item.quantity * item.unitPrice).toFixed(2)}</TaxableAmt>
      <VATRate>7.5</VATRate>
      <VATAmt>${(item.quantity * item.unitPrice * 0.075).toFixed(2)}</VATAmt>
      <TotalAmt>${(item.quantity * item.unitPrice * 1.075).toFixed(2)}</TotalAmt>
    </Line>`,
    )
    .join('')}
  </Lines>
  <Totals>
    <TaxableAmt>${total.toFixed(2)}</TaxableAmt>
    <TotalVAT>${vat.toFixed(2)}</TotalVAT>
    <TotalAmt>${(total + vat).toFixed(2)}</TotalAmt>
  </Totals>
  <IRN>TODO-SHA256-IRN</IRN>
  <QRCode>TODO-QR-CODE</QRCode>
</FirsInvoice>
<!-- TODO: IRN = SHA-256(tin|invoiceNo|serviceId|issueDate); submit to FIRS MBS /api/v1/invoice/submit -->`;
}

/**
 * Kenya KRA eTIMS (Electronic Tax Invoice Management System).
 * Schema: KRA eTIMS VSCU/OSCU API JSON payload.
 * TODO: register OSCU/VSCU device; obtain device serial; authenticate;
 *   submit via POST /trnsSales/saveTrns; embed rcptSign in QR.
 */
export function buildKeEtims(data: InvoiceRenderData): string {
  const issueDate = isoDate(data).replace(/-/g, '');
  const tin = getIdentifier(data.company, 'VAT') || '';
  const total = sumNet(data.items);
  const vat = total * 0.16; // Kenya VAT 16%
  return `<!-- TODO: Kenya KRA eTIMS — OSCU/VSCU device registration + saveTrns; embed rcptSign QR on receipt -->
<ETimsInvoice xmlns="urn:ke:kra:etims:v1">
  <Header>
    <InvoiceNo>${data.rawNumber || 'DRAFT'}</InvoiceNo>
    <InvoiceDate>${issueDate}</InvoiceDate>
    <InvoiceTypeCd>1</InvoiceTypeCd>
    <PaymentTypeCd>02</PaymentTypeCd>
  </Header>
  <Supplier>
    <TPIN>${tin}</TPIN>
    <Name>${data.company.name}</Name>
    <BranchId>00</BranchId>
  </Supplier>
  <Buyer>
    <CustPIN>${getIdentifier(data.client, 'VAT') || 'NON'}</CustPIN>
    <CustName>${data.client.name}</CustName>
  </Buyer>
  <Items>${data.items
    .map(
      (item, i) => `
    <Item>
      <Seq>${i + 1}</Seq>
      <Name>${item.name}</Name>
      <ClassCd>20101601</ClassCd>
      <TypeCd>2</TypeCd>
      <Qty>${item.quantity}</Qty>
      <UnitPrice>${item.unitPrice.toFixed(2)}</UnitPrice>
      <TaxablAmt>${(item.quantity * item.unitPrice).toFixed(2)}</TaxablAmt>
      <TaxTypeCd>A</TaxTypeCd>
      <TaxAmt>${(item.quantity * item.unitPrice * 0.16).toFixed(2)}</TaxAmt>
      <TotAmt>${(item.quantity * item.unitPrice * 1.16).toFixed(2)}</TotAmt>
    </Item>`,
    )
    .join('')}
  </Items>
  <Totals>
    <TaxblAmtA>${total.toFixed(2)}</TaxblAmtA>
    <TaxAmtA>${vat.toFixed(2)}</TaxAmtA>
    <TotTaxblAmt>${total.toFixed(2)}</TotTaxblAmt>
    <TotTaxAmt>${vat.toFixed(2)}</TotTaxAmt>
    <TotAmt>${(total + vat).toFixed(2)}</TotAmt>
  </Totals>
  <Receipt>
    <RcptNo>TODO-RECEIPT-NO</RcptNo>
    <RcptSign>TODO-RECEIPT-SIGNATURE</RcptSign>
    <IntrlData>TODO-INTERNAL-DATA</IntrlData>
    <QRCode>TODO-QR: {tpin}|{rcptNo}|{intrlData}|{rcptSign}</QRCode>
  </Receipt>
</ETimsInvoice>
<!-- TODO: device auth → saveTrns → rcptNo + rcptSign → QR = {tpin}|{rcptNo}|{intrlData}|{rcptSign} -->`;
}

/**
 * Ghana GRA E-VAT.
 * Schema: GRA E-VAT API payload.
 * TODO: submit via GRA E-VAT portal API; await QR/verification code.
 */
export function buildGhEvat(data: InvoiceRenderData): string {
  const issueDate = isoDate(data);
  const tin = getIdentifier(data.company, 'VAT') || '';
  const total = sumNet(data.items);
  const vat = total * 0.125; // Ghana VAT 12.5% (+ NHIL 2.5% + GETFUND 2.5%)
  return `<!-- TODO: Ghana GRA E-VAT — submit via GRA E-VAT portal API; await verification code + QR -->
<EvatInvoice xmlns="urn:gh:gra:evat:v1">
  <Header>
    <InvoiceNo>${data.rawNumber || 'DRAFT'}</InvoiceNo>
    <IssueDate>${issueDate}</IssueDate>
    <Currency>${data.company.currency || 'GHS'}</Currency>
  </Header>
  <Seller>
    <TIN>${tin}</TIN>
    <Name>${data.company.name}</Name>
    <Address>${data.company.address || 'TODO'}</Address>
  </Seller>
  <Buyer>
    <TIN>${getIdentifier(data.client, 'VAT') || 'NON'}</TIN>
    <Name>${data.client.name}</Name>
  </Buyer>
  <Lines>${data.items
    .map(
      (item, i) => `
    <Line>
      <Seq>${i + 1}</Seq>
      <Description>${item.name}</Description>
      <Qty>${item.quantity}</Qty>
      <UnitPrice>${item.unitPrice.toFixed(2)}</UnitPrice>
      <NetAmt>${(item.quantity * item.unitPrice).toFixed(2)}</NetAmt>
      <VATAmt>${(item.quantity * item.unitPrice * 0.125).toFixed(2)}</VATAmt>
      <TotalAmt>${(item.quantity * item.unitPrice * 1.125).toFixed(2)}</TotalAmt>
    </Line>`,
    )
    .join('')}
  </Lines>
  <Totals>
    <NetAmt>${total.toFixed(2)}</NetAmt>
    <VATAmt>${vat.toFixed(2)}</VATAmt>
    <TotalAmt>${(total + vat).toFixed(2)}</TotalAmt>
  </Totals>
  <VerificationCode>TODO-GRA-VERIFICATION-CODE</VerificationCode>
  <QRCode>TODO-QR</QRCode>
</EvatInvoice>
<!-- TODO: submit to GRA E-VAT API; embed verification code + QR on invoice -->`;
}

/**
 * Rwanda RRA EBM (Electronic Billing Machine).
 * Schema: RRA EBM API payload.
 * TODO: device registration with RRA; POST to EBM API; await EBM signature.
 */
export function buildRwEbm(data: InvoiceRenderData): string {
  const issueDate = isoDate(data);
  const tin = getIdentifier(data.company, 'VAT') || '';
  const total = sumNet(data.items);
  const vat = total * 0.18; // Rwanda VAT 18%
  return `<!-- TODO: Rwanda RRA EBM — EBM device registration; POST to RRA EBM API; embed EBM signature -->
<EbmInvoice xmlns="urn:rw:rra:ebm:v1">
  <Header>
    <InvoiceNo>${data.rawNumber || 'DRAFT'}</InvoiceNo>
    <IssueDate>${issueDate}</IssueDate>
    <Currency>${data.company.currency || 'RWF'}</Currency>
    <DeviceSerial>TODO-EBM-DEVICE-SERIAL</DeviceSerial>
  </Header>
  <Seller>
    <TIN>${tin}</TIN>
    <Name>${data.company.name}</Name>
  </Seller>
  <Buyer>
    <TIN>${getIdentifier(data.client, 'VAT') || 'NON'}</TIN>
    <Name>${data.client.name}</Name>
  </Buyer>
  <Lines>${data.items
    .map(
      (item, i) => `
    <Line>
      <Seq>${i + 1}</Seq>
      <Description>${item.name}</Description>
      <Qty>${item.quantity}</Qty>
      <UnitPrice>${item.unitPrice.toFixed(2)}</UnitPrice>
      <TaxableAmt>${(item.quantity * item.unitPrice).toFixed(2)}</TaxableAmt>
      <VATRate>18</VATRate>
      <VATAmt>${(item.quantity * item.unitPrice * 0.18).toFixed(2)}</VATAmt>
      <TotalAmt>${(item.quantity * item.unitPrice * 1.18).toFixed(2)}</TotalAmt>
    </Line>`,
    )
    .join('')}
  </Lines>
  <Totals>
    <TaxableAmt>${total.toFixed(2)}</TaxableAmt>
    <VATAmt>${vat.toFixed(2)}</VATAmt>
    <TotalAmt>${(total + vat).toFixed(2)}</TotalAmt>
  </Totals>
  <EbmSignature>TODO-EBM-DEVICE-SIGNATURE</EbmSignature>
  <QRCode>TODO-QR</QRCode>
</EbmInvoice>
<!-- TODO: register EBM device; POST to RRA EBM API; embed EBM signature + QR on invoice -->`;
}

/**
 * Tanzania TRA VFD (Virtual Fiscal Device).
 * Schema: TRA VFD receipt payload.
 * TODO: register VFD with TRA (GCN assignment); POST receipts; embed verification code + QR.
 */
export function buildTzVfd(data: InvoiceRenderData): string {
  const issueDate = isoDate(data);
  const tin = getIdentifier(data.company, 'VAT') || '';
  const total = sumNet(data.items);
  const vat = total * 0.18; // Tanzania VAT 18%
  return `<!-- TODO: Tanzania TRA VFD — GCN device registration; POST to TRA VFD API; embed verification code + QR -->
<VfdReceipt xmlns="urn:tz:tra:vfd:v1">
  <Header>
    <ReceiptNo>${data.rawNumber || 'DRAFT'}</ReceiptNo>
    <IssueDate>${issueDate}</IssueDate>
    <Currency>${data.company.currency || 'TZS'}</Currency>
    <GCN>TODO-GLOBAL-CERTIFICATION-NUMBER</GCN>
  </Header>
  <Seller>
    <TIN>${tin}</TIN>
    <Name>${data.company.name}</Name>
  </Seller>
  <Buyer>
    <TIN>${getIdentifier(data.client, 'VAT') || 'NON'}</TIN>
    <Name>${data.client.name}</Name>
  </Buyer>
  <Lines>${data.items
    .map(
      (item, i) => `
    <Line>
      <Seq>${i + 1}</Seq>
      <Description>${item.name}</Description>
      <Qty>${item.quantity}</Qty>
      <UnitPrice>${item.unitPrice.toFixed(2)}</UnitPrice>
      <NetAmt>${(item.quantity * item.unitPrice).toFixed(2)}</NetAmt>
      <TaxCode>A</TaxCode>
      <TaxAmt>${(item.quantity * item.unitPrice * 0.18).toFixed(2)}</TaxAmt>
      <TotalAmt>${(item.quantity * item.unitPrice * 1.18).toFixed(2)}</TotalAmt>
    </Line>`,
    )
    .join('')}
  </Lines>
  <Totals>
    <NetAmt>${total.toFixed(2)}</NetAmt>
    <TaxAmt>${vat.toFixed(2)}</TaxAmt>
    <TotalAmt>${(total + vat).toFixed(2)}</TotalAmt>
  </Totals>
  <VerificationCode>TODO-VFD-VERIFICATION-CODE</VerificationCode>
  <QRCode>TODO-QR</QRCode>
</VfdReceipt>
<!-- TODO: GCN registration; POST to TRA VFD; embed verification code + QR on receipt -->`;
}

/**
 * Uganda URA EFRIS (Electronic Fiscal Receipting and Invoicing System).
 * Schema: URA EFRIS API payload.
 * TODO: register EFRIS device with URA (TPIN + device no); POST /business/saveInvoice;
 *   embed FDN (Fiscal Document Number) + QR on invoice.
 */
export function buildUgEfris(data: InvoiceRenderData): string {
  const issueDate = isoDate(data);
  const tin = getIdentifier(data.company, 'VAT') || '';
  const total = sumNet(data.items);
  const vat = total * 0.18; // Uganda VAT 18%
  return `<!-- TODO: Uganda URA EFRIS — device registration; POST /business/saveInvoice; embed FDN + QR -->
<EfrisInvoice xmlns="urn:ug:ura:efris:v3">
  <Header>
    <InvoiceNo>${data.rawNumber || 'DRAFT'}</InvoiceNo>
    <IssueDate>${issueDate}</IssueDate>
    <Currency>${data.company.currency || 'UGX'}</Currency>
    <InvoiceTypeCd>1</InvoiceTypeCd>
  </Header>
  <Supplier>
    <TPIN>${tin}</TPIN>
    <Name>${data.company.name}</Name>
    <Address>${data.company.address || 'TODO'}</Address>
  </Supplier>
  <Buyer>
    <TPIN>${getIdentifier(data.client, 'VAT') || 'NON'}</TPIN>
    <Name>${data.client.name}</Name>
  </Buyer>
  <Lines>${data.items
    .map(
      (item, i) => `
    <Line>
      <Seq>${i + 1}</Seq>
      <Description>${item.name}</Description>
      <Qty>${item.quantity}</Qty>
      <UnitPrice>${item.unitPrice.toFixed(2)}</UnitPrice>
      <TaxableAmt>${(item.quantity * item.unitPrice).toFixed(2)}</TaxableAmt>
      <VATRate>18</VATRate>
      <VATAmt>${(item.quantity * item.unitPrice * 0.18).toFixed(2)}</VATAmt>
      <TotalAmt>${(item.quantity * item.unitPrice * 1.18).toFixed(2)}</TotalAmt>
    </Line>`,
    )
    .join('')}
  </Lines>
  <Totals>
    <NetAmt>${total.toFixed(2)}</NetAmt>
    <VATAmt>${vat.toFixed(2)}</VATAmt>
    <TotalAmt>${(total + vat).toFixed(2)}</TotalAmt>
  </Totals>
  <FDN>TODO-FISCAL-DOCUMENT-NUMBER</FDN>
  <QRCode>TODO-QR</QRCode>
</EfrisInvoice>
<!-- TODO: URA EFRIS device + TPIN; POST /business/saveInvoice; embed FDN + QR -->`;
}

/**
 * Zambia ZRA Smart Invoice.
 * Schema: ZRA Smart Invoice VSDC API payload.
 * TODO: register VSDC with ZRA (TPIN + device serial); POST /saveinvoice;
 *   embed verification code + QR on invoice.
 */
export function buildZmSmartInvoice(data: InvoiceRenderData): string {
  const issueDate = isoDate(data);
  const tin = getIdentifier(data.company, 'VAT') || '';
  const total = sumNet(data.items);
  const vat = total * 0.16; // Zambia VAT 16%
  return `<!-- TODO: Zambia ZRA Smart Invoice — VSDC registration; POST /saveinvoice; embed verification code + QR -->
<SmartInvoice xmlns="urn:zm:zra:smartinvoice:v1">
  <Header>
    <InvoiceNo>${data.rawNumber || 'DRAFT'}</InvoiceNo>
    <IssueDate>${issueDate}</IssueDate>
    <Currency>${data.company.currency || 'ZMW'}</Currency>
    <DeviceSerial>TODO-VSDC-DEVICE-SERIAL</DeviceSerial>
  </Header>
  <Seller>
    <TPIN>${tin}</TPIN>
    <Name>${data.company.name}</Name>
    <BranchId>000</BranchId>
  </Seller>
  <Buyer>
    <TPIN>${getIdentifier(data.client, 'VAT') || 'NON'}</TPIN>
    <Name>${data.client.name}</Name>
  </Buyer>
  <Lines>${data.items
    .map(
      (item, i) => `
    <Line>
      <Seq>${i + 1}</Seq>
      <Description>${item.name}</Description>
      <Qty>${item.quantity}</Qty>
      <UnitPrice>${item.unitPrice.toFixed(2)}</UnitPrice>
      <TaxableAmt>${(item.quantity * item.unitPrice).toFixed(2)}</TaxableAmt>
      <TaxCode>A</TaxCode>
      <TaxAmt>${(item.quantity * item.unitPrice * 0.16).toFixed(2)}</TaxAmt>
      <TotalAmt>${(item.quantity * item.unitPrice * 1.16).toFixed(2)}</TotalAmt>
    </Line>`,
    )
    .join('')}
  </Lines>
  <Totals>
    <NetAmt>${total.toFixed(2)}</NetAmt>
    <TaxAmt>${vat.toFixed(2)}</TaxAmt>
    <TotalAmt>${(total + vat).toFixed(2)}</TotalAmt>
  </Totals>
  <SmartInvoiceNo>TODO-SMART-INVOICE-NO</SmartInvoiceNo>
  <VerificationCode>TODO-VERIFICATION-CODE</VerificationCode>
  <QRCode>TODO-QR</QRCode>
</SmartInvoice>
<!-- TODO: ZRA VSDC registration; POST /saveinvoice; embed SmartInvoiceNo + QR -->`;
}

/**
 * Zimbabwe ZIMRA FDMS (Fiscal Day Management System).
 * Schema: ZIMRA FDMS API payload.
 * TODO: register fiscal device with ZIMRA (BPNO); POST /submitDocument;
 *   embed verification QR on invoice.
 */
export function buildZwFdms(data: InvoiceRenderData): string {
  const issueDate = isoDate(data);
  const tin = getIdentifier(data.company, 'VAT') || '';
  const total = sumNet(data.items);
  const vat = total * 0.15; // Zimbabwe VAT 15%
  return `<!-- TODO: Zimbabwe ZIMRA FDMS — fiscal device registration (BPNO); POST /submitDocument; embed QR -->
<FdmsDocument xmlns="urn:zw:zimra:fdms:v1">
  <Header>
    <DocumentNo>${data.rawNumber || 'DRAFT'}</DocumentNo>
    <IssueDate>${issueDate}</IssueDate>
    <Currency>${data.company.currency || 'USD'}</Currency>
    <BPNO>TODO-BUSINESS-PARTNER-NO</BPNO>
    <DeviceSerial>TODO-FISCAL-DEVICE-SERIAL</DeviceSerial>
  </Header>
  <Seller>
    <BPNO>${tin}</BPNO>
    <Name>${data.company.name}</Name>
  </Seller>
  <Buyer>
    <BPNO>${getIdentifier(data.client, 'VAT') || 'NON'}</BPNO>
    <Name>${data.client.name}</Name>
  </Buyer>
  <Lines>${data.items
    .map(
      (item, i) => `
    <Line>
      <Seq>${i + 1}</Seq>
      <Description>${item.name}</Description>
      <Qty>${item.quantity}</Qty>
      <UnitPrice>${item.unitPrice.toFixed(2)}</UnitPrice>
      <NetAmt>${(item.quantity * item.unitPrice).toFixed(2)}</NetAmt>
      <TaxCode>A</TaxCode>
      <TaxAmt>${(item.quantity * item.unitPrice * 0.15).toFixed(2)}</TaxAmt>
      <TotalAmt>${(item.quantity * item.unitPrice * 1.15).toFixed(2)}</TotalAmt>
    </Line>`,
    )
    .join('')}
  </Lines>
  <Totals>
    <NetAmt>${total.toFixed(2)}</NetAmt>
    <TaxAmt>${vat.toFixed(2)}</TaxAmt>
    <TotalAmt>${(total + vat).toFixed(2)}</TotalAmt>
  </Totals>
  <VerificationQR>TODO-ZIMRA-VERIFICATION-QR</VerificationQR>
</FdmsDocument>
<!-- TODO: BPNO device registration; POST /submitDocument; embed ZIMRA verification QR -->`;
}

/**
 * Côte d'Ivoire DGI FNE (Facture Normalisée Electronique).
 * Schema: DGI SIGF FNE e-invoice payload (XML).
 * TODO: register with DGI SIGF (NCC assignment); POST to FNE API;
 *   embed DGI sticker/QR on invoice.
 */
export function buildCiFne(data: InvoiceRenderData): string {
  const issueDate = isoDate(data);
  const ncc = getIdentifier(data.company, 'VAT') || '';
  const total = sumNet(data.items);
  const vat = total * 0.18; // Côte d'Ivoire TVA 18%
  return `<!-- TODO: Côte d'Ivoire DGI FNE — NCC registration; POST to SIGF FNE API; embed DGI sticker/QR -->
<FactureNormalisee xmlns="urn:ci:dgi:fne:v1">
  <Entete>
    <NumFacture>${data.rawNumber || 'DRAFT'}</NumFacture>
    <DateEmission>${issueDate}</DateEmission>
    <Devise>${data.company.currency || 'XOF'}</Devise>
  </Entete>
  <Vendeur>
    <NCC>${ncc}</NCC>
    <RaisonSociale>${data.company.name}</RaisonSociale>
    <Adresse>${data.company.address || 'TODO'}</Adresse>
  </Vendeur>
  <Acheteur>
    <NCC>${getIdentifier(data.client, 'VAT') || 'NON'}</NCC>
    <RaisonSociale>${data.client.name}</RaisonSociale>
  </Acheteur>
  <Lignes>${data.items
    .map(
      (item, i) => `
    <Ligne>
      <No>${i + 1}</No>
      <Designation>${item.name}</Designation>
      <Quantite>${item.quantity}</Quantite>
      <PrixUnitaire>${item.unitPrice.toFixed(2)}</PrixUnitaire>
      <MontantHT>${(item.quantity * item.unitPrice).toFixed(2)}</MontantHT>
      <TauxTVA>18</TauxTVA>
      <MontantTVA>${(item.quantity * item.unitPrice * 0.18).toFixed(2)}</MontantTVA>
      <MontantTTC>${(item.quantity * item.unitPrice * 1.18).toFixed(2)}</MontantTTC>
    </Ligne>`,
    )
    .join('')}
  </Lignes>
  <Totaux>
    <TotalHT>${total.toFixed(2)}</TotalHT>
    <TotalTVA>${vat.toFixed(2)}</TotalTVA>
    <TotalTTC>${(total + vat).toFixed(2)}</TotalTTC>
  </Totaux>
  <QRSticker>TODO-DGI-QR-STICKER</QRSticker>
</FactureNormalisee>
<!-- TODO: NCC registration with DGI SIGF; POST facture; embed QR sticker -->`;
}

/**
 * Benin DGI MECeF / SeMeF (Machine Electronique de Contrôle et de Facturation).
 * Schema: DGI SeMeF e-invoice payload.
 * TODO: IFU registration with DGI; POST to SeMeF API;
 *   embed MECeF code + QR on invoice.
 */
export function buildBjMecef(data: InvoiceRenderData): string {
  const issueDate = isoDate(data);
  const ifu = getIdentifier(data.company, 'VAT') || '';
  const total = sumNet(data.items);
  const vat = total * 0.18; // Benin TVA 18%
  return `<!-- TODO: Benin DGI MECeF/SeMeF — IFU registration; POST to SeMeF API; embed MECeF code + QR -->
<FactureMecef xmlns="urn:bj:dgi:mecef:v1">
  <Entete>
    <NumFacture>${data.rawNumber || 'DRAFT'}</NumFacture>
    <DateEmission>${issueDate}</DateEmission>
    <Devise>${data.company.currency || 'XOF'}</Devise>
    <IFU>${ifu}</IFU>
  </Entete>
  <Vendeur>
    <IFU>${ifu}</IFU>
    <RaisonSociale>${data.company.name}</RaisonSociale>
    <Adresse>${data.company.address || 'TODO'}</Adresse>
  </Vendeur>
  <Acheteur>
    <IFU>${getIdentifier(data.client, 'VAT') || 'NON'}</IFU>
    <RaisonSociale>${data.client.name}</RaisonSociale>
  </Acheteur>
  <Lignes>${data.items
    .map(
      (item, i) => `
    <Ligne>
      <No>${i + 1}</No>
      <Designation>${item.name}</Designation>
      <Quantite>${item.quantity}</Quantite>
      <PrixUnitaire>${item.unitPrice.toFixed(2)}</PrixUnitaire>
      <MontantHT>${(item.quantity * item.unitPrice).toFixed(2)}</MontantHT>
      <TauxTVA>18</TauxTVA>
      <MontantTVA>${(item.quantity * item.unitPrice * 0.18).toFixed(2)}</MontantTVA>
      <MontantTTC>${(item.quantity * item.unitPrice * 1.18).toFixed(2)}</MontantTTC>
    </Ligne>`,
    )
    .join('')}
  </Lignes>
  <Totaux>
    <TotalHT>${total.toFixed(2)}</TotalHT>
    <TotalTVA>${vat.toFixed(2)}</TotalTVA>
    <TotalTTC>${(total + vat).toFixed(2)}</TotalTTC>
  </Totaux>
  <CodeMecef>TODO-MECEF-CODE</CodeMecef>
  <QRCode>TODO-QR</QRCode>
</FactureMecef>
<!-- TODO: IFU registration with DGI; POST to SeMeF /factures/enregistrer; embed MECeF code + QR -->`;
}
