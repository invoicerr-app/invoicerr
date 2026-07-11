/**
 * Asia national e-invoice skeleton builders (live-deferred scaffolds).
 *
 * Pure functions: InvoiceRenderData in, national XML/JSON string out.
 * Extracted verbatim from InvoiceRenderingService (behaviour-preserving).
 */
import { getIdentifier } from '@/utils/entity-identifiers';
import type { InvoiceRenderData } from '../render-data';
import { sumNet, sumVat, isoDate } from './xml-helpers';

export function buildCnEfapiao(data: InvoiceRenderData): string {
  const issueDate = isoDate(data);
  const nsrsbh = getIdentifier(data.company, 'VAT') || '';
  const total = sumNet(data.items);
  const totalIVA = sumVat(data.items);
  return `<!-- TODO: China e-Fapiao (Golden Tax IV / STA) — requires Tax Control Device -->
<Fapiao>
  <Header><FapiaoNo>${data.rawNumber || 'DRAFT'}</FapiaoNo><IssueDate>${issueDate}</IssueDate><FapiaoType>Normal</FapiaoType></Header>
  <Seller><NSRSBH>${nsrsbh}</NSRSBH><Name>${data.company.name}</Name></Seller>
  <Buyer><NSRSBH>${getIdentifier(data.client, 'VAT') || ''}</NSRSBH><Name>${data.client.name}</Name></Buyer>
  <Items>${data.items.map((item, i) => `<Item><SerialNo>${i + 1}</SerialNo><Name>${item.name}</Name><Quantity>${item.quantity}</Quantity><UnitPrice>${item.unitPrice}</UnitPrice></Item>`).join('')}</Items>
  <Totals><TotalAmount>${total.toFixed(2)}</TotalAmount><TaxAmount>${totalIVA.toFixed(2)}</TaxAmount><GrandTotal>${(total + totalIVA).toFixed(2)}</GrandTotal></Totals>
</Fapiao>
<!-- TODO: Tax Control Device (Golden Tax IV) + CRC code -->`;
}

export function buildInIrp(data: InvoiceRenderData): string {
  const issueDate = isoDate(data);
  const gstin = getIdentifier(data.company, 'VAT') || '';
  const total = sumNet(data.items);
  const totalIVA = sumVat(data.items);
  return `<!-- TODO: India IRP (GST e-Invoice via NIC/GSTN) — requires IRN + Signed QR -->
<Invoice>
  <TradeParty><GSTIN>${gstin}</GSTIN><LegalName>${data.company.name}</LegalName></TradeParty>
  <DocumentHeader><DocNo>${data.rawNumber || 'DRAFT'}</DocNo><DocDate>${issueDate}</DocDate><DocType>INV</DocType></DocumentHeader>
  <DocumentDetails><TotalPreTaxValue>${total.toFixed(2)}</TotalPreTaxValue><TotalTaxValue>${totalIVA.toFixed(2)}</TotalTaxValue><TotalInvoiceValue>${(total + totalIVA).toFixed(2)}</TotalInvoiceValue></DocumentDetails>
  <ItemList>${data.items.map((item, i) => `<Item><SlNo>${i + 1}</SlNo><PrDescription>${item.name}</PrDescription><PrdQty>${item.quantity}</PrdQty><PrdUnitPrice>${item.unitPrice}</PrdUnitPrice></Item>`).join('')}</ItemList>
</Invoice>
<!-- TODO: IRN (Invoice Reference Number) + Signed QR Code via IRP -->`;
}

/**
 * Indonesia e-Faktur (Faktur Pajak Elektronik) — DGT Coretax.
 * Schema: DGT e-Faktur XML (SPT PPN Lampiran A1/A2).
 * TODO: pre-assign NSFP (Nomor Seri Faktur Pajak) from DGT;
 *   compute PPN (11%); sign with NPWP certificate; submit to Coretax API.
 */
export function buildIdEfaktur(data: InvoiceRenderData): string {
  const issueDate = isoDate(data);
  const npwp = getIdentifier(data.company, 'VAT') || '';
  const total = sumNet(data.items);
  const ppn = total * 0.11; // PPN 11%
  return `<!-- TODO: Indonesia e-Faktur (DGT Coretax) — requires NSFP pre-assignment + digital signature -->
<FakturPajak xmlns="urn:dgip:efaktur:v1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <TanggalFaktur>${issueDate}</TanggalFaktur>
  <JenisFaktur>01</JenisFaktur>
  <KodeFaktur>TODO-NSFP-16-DIGIT</KodeFaktur>
  <Penjual>
    <NPWP>${npwp}</NPWP>
    <Nama>${data.company.name}</Nama>
    <Alamat>${data.company.address || 'TODO'}</Alamat>
  </Penjual>
  <Pembeli>
    <NPWP>${getIdentifier(data.client, 'VAT') || '000000000000000'}</NPWP>
    <Nama>${data.client.name}</Nama>
    <Alamat>${data.client.address || 'TODO'}</Alamat>
  </Pembeli>
  <BarangJasa>${data.items
    .map(
      (item, i) => `
    <Item>
      <No>${i + 1}</No>
      <NamaBarangJasa>${item.name}</NamaBarangJasa>
      <Jumlah>${item.quantity}</Jumlah>
      <HargaSatuan>${item.unitPrice.toFixed(2)}</HargaSatuan>
      <DPP>${(item.quantity * item.unitPrice).toFixed(2)}</DPP>
      <PPN>${(item.quantity * item.unitPrice * 0.11).toFixed(2)}</PPN>
    </Item>`,
    )
    .join('')}
  </BarangJasa>
  <Jumlah>
    <DPP>${total.toFixed(2)}</DPP>
    <PPN>${ppn.toFixed(2)}</PPN>
    <Total>${(total + ppn).toFixed(2)}</Total>
  </Jumlah>
</FakturPajak>
<!-- TODO: NSFP + kodeOtorisasi (Coretax API) + e-Meterai (if > IDR 5M) -->`;
}

/**
 * Taiwan eGUI / unified invoice (統一發票) — MoF MIG XML.
 * Schema: MoF 電子發票整合服務平台 MIG (Message Implementation Guide) v3.2.
 * TODO: allocate invoice-number track from MoF; include InvoiceNumber (A1234567890 format);
 *   random number; QR code (left + right concatenation); upload to MoF.
 */
export function buildTwEgui(data: InvoiceRenderData): string {
  const issueDate = isoDate(data);
  const taxId = getIdentifier(data.company, 'VAT') || ''; // 統一編號 (8 digits)
  const total = sumNet(data.items);
  const tax = sumVat(data.items, 5);
  return `<!-- TODO: Taiwan eGUI (MoF 電子發票) — requires invoice-number track + random number + QR code -->
<Invoice xmlns="urn:tw:gov:mof:einvoice:v1">
  <Main>
    <InvoiceNumber>TODO-TW-INVOICE-NO</InvoiceNumber>
    <InvoiceDate>${issueDate.replace(/-/g, '')}</InvoiceDate>
    <InvoiceTime>120000</InvoiceTime>
    <RandomNumber>TODO-4-DIGIT</RandomNumber>
    <SalesAmount>${total.toFixed(0)}</SalesAmount>
    <TaxType>1</TaxType>
    <TaxRate>5</TaxRate>
    <TaxAmount>${tax.toFixed(0)}</TaxAmount>
    <TotalAmount>${(total + tax).toFixed(0)}</TotalAmount>
    <SellerID>${taxId}</SellerID>
    <SellerName>${data.company.name}</SellerName>
    <BuyerID>${getIdentifier(data.client, 'VAT') || '0000000000'}</BuyerID>
    <BuyerName>${data.client.name}</BuyerName>
    <CarrierType/>
    <CarrierID1/>
    <NPOBAN/>
    <PrintMark>N</PrintMark>
  </Main>
  <Details>${data.items
    .map(
      (item, i) => `
    <ProductItem>
      <SequenceNumber>${i + 1}</SequenceNumber>
      <Description>${item.name}</Description>
      <Quantity>${item.quantity}</Quantity>
      <UnitPrice>${item.unitPrice.toFixed(0)}</UnitPrice>
      <Amount>${(item.quantity * item.unitPrice).toFixed(0)}</Amount>
    </ProductItem>`,
    )
    .join('')}
  </Details>
</Invoice>
<!-- TODO: InvoiceNumber allocation (track A/B/...) + random + QR (left: 35 chars, right: 34 chars) -->`;
}

/**
 * Kazakhstan IS ESF (Электронные счета-фактуры).
 * Schema: IS ESF XML (Приказ НК МФ РК №391).
 * TODO: sign with GOST or RSA (ЭЦП); supply virtual-warehouse linkage (склад);
 *   include currency rate if not KZT; submit to IS ESF API.
 */
export function buildKzEsf(data: InvoiceRenderData): string {
  const issueDate = isoDate(data);
  const bin = getIdentifier(data.company, 'VAT') || ''; // БИН (12 digits)
  const total = sumNet(data.items);
  const vat = sumVat(data.items, 12);
  return `<!-- TODO: Kazakhstan IS ESF — requires ЭЦП signature + БИН registration + virtual-warehouse linkage -->
<ESF xmlns="urn:esf:gov:kz:v2">
  <Num>${data.rawNumber || 'DRAFT'}</Num>
  <DateDoc>${issueDate}</DateDoc>
  <Supplier>
    <BIN>${bin}</BIN>
    <Name>${data.company.name}</Name>
    <Address>${data.company.address || 'TODO'}</Address>
  </Supplier>
  <Recipient>
    <BIN>${getIdentifier(data.client, 'VAT') || 'TODO'}</BIN>
    <Name>${data.client.name}</Name>
  </Recipient>
  <Products>${data.items
    .map(
      (item, i) => `
    <ProductsTable>
      <Num>${i + 1}</Num>
      <NameRu>${item.name}</NameRu>
      <Unit>796</Unit>
      <Count>${item.quantity}</Count>
      <Price>${item.unitPrice.toFixed(2)}</Price>
      <NDS>${(item.vatRate || 12).toFixed(0)}</NDS>
      <AmountNDS>${((item.quantity * item.unitPrice * (item.vatRate || 12)) / 100).toFixed(2)}</AmountNDS>
      <TurnoverSize>${(item.quantity * item.unitPrice).toFixed(2)}</TurnoverSize>
    </ProductsTable>`,
    )
    .join('')}
  </Products>
  <Totals>
    <TotalTurnoverSize>${total.toFixed(2)}</TotalTurnoverSize>
    <TotalNDS>${vat.toFixed(2)}</TotalNDS>
    <TotalSize>${(total + vat).toFixed(2)}</TotalSize>
  </Totals>
</ESF>
<!-- TODO: ЭЦП (qualified electronic signature) + IS ESF API submission -->`;
}

/**
 * Philippines BIR EIS (Electronic Invoicing System).
 * Schema: BIR EIS JSON (Revenue Regulations 8-2022).
 * TODO: sign with BIR-registered digital signature; include ORN (Official Receipt Number);
 *   submit to BIR EIS API.
 * Note: PH EIS uses JSON, wrapped in XML comment for the pipeline.
 */
export function buildPhEis(data: InvoiceRenderData): string {
  const issueDate = isoDate(data);
  const tin = getIdentifier(data.company, 'VAT') || ''; // TIN (9-12 digits)
  const total = sumNet(data.items);
  const vat = sumVat(data.items, 12);
  const eisJson = {
    schemaVersion: '1.0',
    invoiceNumber: data.rawNumber || 'DRAFT',
    invoiceDate: issueDate,
    sellerTIN: tin,
    sellerName: data.company.name,
    sellerAddress: data.company.address || 'TODO',
    buyerTIN: getIdentifier(data.client, 'VAT') || 'N/A',
    buyerName: data.client.name,
    buyerAddress: data.client.address || 'TODO',
    items: data.items.map((item, i) => ({
      lineNo: i + 1,
      description: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      amount: item.quantity * item.unitPrice,
      vatRate: item.vatRate || 12,
      vatAmount: (item.quantity * item.unitPrice * (item.vatRate || 12)) / 100,
    })),
    totalSales: total,
    totalVAT: vat,
    totalAmount: total + vat,
    digitalSignature: 'TODO', // TODO: BIR-registered DSA signature
  };
  return `<!-- TODO: Philippines BIR EIS (Revenue Regulations 8-2022) — requires digital signature + BIR API -->
${JSON.stringify(eisJson, null, 2)}`;
}

/**
 * Thailand RD e-Tax Invoice & e-Receipt.
 * Schema: RD XML (Notification of the Revenue Department on the criteria, procedure,
 *   and conditions for the preparation, delivery and storage of e-Tax Invoice and e-Receipt).
 * TODO: PKCS#7 / digital signature (ETDA-certified CA); submit via RD-approved service provider.
 */
export function buildThEtax(data: InvoiceRenderData): string {
  const issueDate = isoDate(data);
  const tin = getIdentifier(data.company, 'VAT') || ''; // เลขประจำตัวผู้เสียภาษี (13 digits)
  const total = sumNet(data.items);
  const vat = sumVat(data.items, 7);
  return `<!-- TODO: Thailand RD e-Tax Invoice — requires PKCS#7 signature + ETDA-certified CA -->
<TaxInvoice xmlns="urn:th:go:rd:etax:v2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <InvoiceNumber>${data.rawNumber || 'DRAFT'}</InvoiceNumber>
  <InvoiceDate>${issueDate}</InvoiceDate>
  <InvoiceType>T01</InvoiceType>
  <Seller>
    <TaxID>${tin}</TaxID>
    <Name>${data.company.name}</Name>
    <Address>${data.company.address || 'TODO'}</Address>
  </Seller>
  <Buyer>
    <TaxID>${getIdentifier(data.client, 'VAT') || 'N/A'}</TaxID>
    <Name>${data.client.name}</Name>
  </Buyer>
  <LineItems>${data.items
    .map(
      (item, i) => `
    <LineItem>
      <No>${i + 1}</No>
      <Description>${item.name}</Description>
      <Quantity>${item.quantity}</Quantity>
      <UnitPrice>${item.unitPrice.toFixed(2)}</UnitPrice>
      <Amount>${(item.quantity * item.unitPrice).toFixed(2)}</Amount>
      <VATRate>${item.vatRate || 7}</VATRate>
      <VATAmount>${((item.quantity * item.unitPrice * (item.vatRate || 7)) / 100).toFixed(2)}</VATAmount>
    </LineItem>`,
    )
    .join('')}
  </LineItems>
  <Totals>
    <SubTotal>${total.toFixed(2)}</SubTotal>
    <VATAmount>${vat.toFixed(2)}</VATAmount>
    <GrandTotal>${(total + vat).toFixed(2)}</GrandTotal>
  </Totals>
</TaxInvoice>
<!-- TODO: PKCS#7 digital signature (ETDA-certified) + RD service provider submission -->`;
}

/**
 * Nepal IRD CBMS (Central Billing Monitoring System).
 * Schema: IRD CBMS payload (fiscal device integration).
 * TODO: fiscal device serial; real-time online verification; QR code generation.
 */
export function buildNpCbms(data: InvoiceRenderData): string {
  const issueDate = isoDate(data);
  const pan = getIdentifier(data.company, 'VAT') || ''; // PAN (9 digits)
  const total = sumNet(data.items);
  const vat = sumVat(data.items, 13);
  return `<!-- TODO: Nepal IRD CBMS — requires fiscal device + real-time online verification -->
<CBMSInvoice xmlns="urn:np:gov:ird:cbms:v1">
  <InvoiceNo>${data.rawNumber || 'DRAFT'}</InvoiceNo>
  <InvoiceDate>${issueDate}</InvoiceDate>
  <FiscalYear>TODO</FiscalYear>
  <Taxpayer>
    <PAN>${pan}</PAN>
    <Name>${data.company.name}</Name>
    <Address>${data.company.address || 'TODO'}</Address>
  </Taxpayer>
  <Customer>
    <PAN>${getIdentifier(data.client, 'VAT') || 'N/A'}</PAN>
    <Name>${data.client.name}</Name>
  </Customer>
  <Items>${data.items
    .map(
      (item, i) => `
    <Item>
      <SN>${i + 1}</SN>
      <Particulars>${item.name}</Particulars>
      <Unit>Unit</Unit>
      <Quantity>${item.quantity}</Quantity>
      <Rate>${item.unitPrice.toFixed(2)}</Rate>
      <Amount>${(item.quantity * item.unitPrice).toFixed(2)}</Amount>
    </Item>`,
    )
    .join('')}
  </Items>
  <Summary>
    <TaxableAmount>${total.toFixed(2)}</TaxableAmount>
    <VATAmount>${vat.toFixed(2)}</VATAmount>
    <TotalAmount>${(total + vat).toFixed(2)}</TotalAmount>
  </Summary>
</CBMSInvoice>
<!-- TODO: fiscal device serial + CBMS real-time sync + verification QR -->`;
}

/**
 * Bangladesh NBR e-invoice.
 * Schema: NBR e-invoice payload (VAT Registration).
 * TODO: BIN (Business Identification Number); NBR API integration.
 */
export function buildBdNbr(data: InvoiceRenderData): string {
  const issueDate = isoDate(data);
  const bin = getIdentifier(data.company, 'VAT') || ''; // BIN (9 digits)
  const total = sumNet(data.items);
  const vat = sumVat(data.items, 15);
  return `<!-- TODO: Bangladesh NBR e-invoice — requires BIN + NBR API integration -->
<NBRInvoice xmlns="urn:bd:gov:nbr:einvoice:v1">
  <InvoiceNo>${data.rawNumber || 'DRAFT'}</InvoiceNo>
  <InvoiceDate>${issueDate}</InvoiceDate>
  <Supplier>
    <BIN>${bin}</BIN>
    <Name>${data.company.name}</Name>
    <Address>${data.company.address || 'TODO'}</Address>
  </Supplier>
  <Recipient>
    <BIN>${getIdentifier(data.client, 'VAT') || 'N/A'}</BIN>
    <Name>${data.client.name}</Name>
  </Recipient>
  <LineItems>${data.items
    .map(
      (item, i) => `
    <LineItem>
      <Sl>${i + 1}</Sl>
      <Description>${item.name}</Description>
      <Quantity>${item.quantity}</Quantity>
      <UnitValue>${item.unitPrice.toFixed(2)}</UnitValue>
      <TaxableValue>${(item.quantity * item.unitPrice).toFixed(2)}</TaxableValue>
      <VATRate>${item.vatRate || 15}</VATRate>
      <VATAmount>${((item.quantity * item.unitPrice * (item.vatRate || 15)) / 100).toFixed(2)}</VATAmount>
    </LineItem>`,
    )
    .join('')}
  </LineItems>
  <Totals>
    <TaxableAmount>${total.toFixed(2)}</TaxableAmount>
    <VATAmount>${vat.toFixed(2)}</VATAmount>
    <Total>${(total + vat).toFixed(2)}</Total>
  </Totals>
</NBRInvoice>
<!-- TODO: NBR BIN validation + NBR e-invoice API submission -->`;
}

/**
 * Pakistan FBR XIR (XML Invoice Reporting) / ESP (Electronic Sales Portal).
 * Schema: FBR XIR payload (Sales Tax Act 1990, SRO 1098).
 * TODO: STRN (Sales Tax Registration Number); FBR API key; digital signature (SCA).
 */
export function buildPkFbr(data: InvoiceRenderData): string {
  const issueDate = isoDate(data);
  const strn = getIdentifier(data.company, 'VAT') || ''; // STRN (7 or more digits)
  const total = sumNet(data.items);
  const vat = sumVat(data.items, 18);
  return `<!-- TODO: Pakistan FBR XIR — requires STRN + FBR API key + SCA signature -->
<FBRInvoice xmlns="urn:pk:fbr:xir:v1">
  <InvoiceNo>${data.rawNumber || 'DRAFT'}</InvoiceNo>
  <InvoiceDate>${issueDate}</InvoiceDate>
  <InvoiceType>SI</InvoiceType>
  <Seller>
    <STRN>${strn}</STRN>
    <Name>${data.company.name}</Name>
    <Address>${data.company.address || 'TODO'}</Address>
  </Seller>
  <Buyer>
    <STRN>${getIdentifier(data.client, 'VAT') || 'N/A'}</STRN>
    <Name>${data.client.name}</Name>
  </Buyer>
  <Items>${data.items
    .map(
      (item, i) => `
    <Item>
      <Sr>${i + 1}</Sr>
      <Description>${item.name}</Description>
      <Qty>${item.quantity}</Qty>
      <Rate>${item.unitPrice.toFixed(2)}</Rate>
      <Value>${(item.quantity * item.unitPrice).toFixed(2)}</Value>
      <SalesTaxRate>${item.vatRate || 18}</SalesTaxRate>
      <SalesTaxAmt>${((item.quantity * item.unitPrice * (item.vatRate || 18)) / 100).toFixed(2)}</SalesTaxAmt>
    </Item>`,
    )
    .join('')}
  </Items>
  <Totals>
    <TaxableValue>${total.toFixed(2)}</TaxableValue>
    <SalesTax>${vat.toFixed(2)}</SalesTax>
    <TotalBillAmt>${(total + vat).toFixed(2)}</TotalBillAmt>
  </Totals>
</FBRInvoice>
<!-- TODO: FBR XIR API submission + IRN + QR code (FBR POS/Invoice System) -->`;
}

/**
 * Vietnam TT78 / Decree-123 e-invoice.
 * Schema: TT78 XML (Thông tư 78/2021/TT-BTC; Nghị định 123/2020/NĐ-CP).
 * TODO: digital signature (token/HSM); mã CQT (tax authority code) from GDT;
 *   signed XML per PKCS#7.
 */
export function buildVnTt78(data: InvoiceRenderData): string {
  const issueDt = (data.issuedAt ?? data.createdAt).toISOString();
  const mst = getIdentifier(data.company, 'VAT') || ''; // Mã số thuế (10 or 13 digits)
  const total = sumNet(data.items);
  const vat = sumVat(data.items, 10);
  return `<!-- TODO: Vietnam TT78 e-invoice (Decree 123/2020) — requires PKCS#7 signature + GDT code (mã CQT) -->
<HDon xmlns="http://lanhdalieu.gdt.gov.vn/HD"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  Version="1.0">
  <DLHDon>
    <TTChung>
      <MaHDon>${data.rawNumber || 'DRAFT'}</MaHDon>
      <THDon>Hóa đơn giá trị gia tăng</THDon>
      <KHMSHDon>1</KHMSHDon>
      <KHHDon>TODO-SERIES</KHHDon>
      <SHDon>TODO-SEQUENCE</SHDon>
      <NLap>${issueDt}</NLap>
      <DDan>TODO: company description</DDan>
      <MaCQTCap>TODO-MA-CQT</MaCQTCap>
    </TTChung>
    <NDHDon>
      <NBan>
        <MST>${mst}</MST>
        <Ten>${data.company.name}</Ten>
        <DChi>${data.company.address || 'TODO'}</DChi>
      </NBan>
      <NMua>
        <Ten>${data.client.name}</Ten>
        <MST>${getIdentifier(data.client, 'VAT') || ''}</MST>
        <DChi>${data.client.address || 'TODO'}</DChi>
      </NMua>
      <DSHHDVu>${data.items
        .map(
          (item, i) => `
        <HHDVu>
          <STT>${i + 1}</STT>
          <THHDVu>${item.name}</THHDVu>
          <DVTinh>Dịch vụ</DVTinh>
          <SLuong>${item.quantity}</SLuong>
          <DGia>${item.unitPrice.toFixed(2)}</DGia>
          <ThTien>${(item.quantity * item.unitPrice).toFixed(2)}</ThTien>
          <TSuat>${item.vatRate || 10}%</TSuat>
          <TThueTGTGT>${((item.quantity * item.unitPrice * (item.vatRate || 10)) / 100).toFixed(2)}</TThueTGTGT>
        </HHDVu>`,
        )
        .join('')}
      </DSHHDVu>
      <TToan>
        <THTTLTSuat>
          <LTSuat>${data.items[0]?.vatRate || 10}%</LTSuat>
          <ThTien>${total.toFixed(2)}</ThTien>
          <TThue>${vat.toFixed(2)}</TThue>
        </THTTLTSuat>
        <TgTCThue>${total.toFixed(2)}</TgTCThue>
        <TgTThue>${vat.toFixed(2)}</TgTThue>
        <TgTTTBChu>TODO: amount in words</TgTTTBChu>
        <TgTTT>${(total + vat).toFixed(2)}</TgTTT>
      </TToan>
    </NDHDon>
  </DLHDon>
</HDon>
<!-- TODO: PKCS#7 XML digital signature + GDT mã CQT + TT78 schema validation -->`;
}

/**
 * Malaysia MyInvois (LHDNM) — UBL 2.1 skeleton with LHDNM mandatory extensions.
 * Schema: UBL 2.1 + LHDNM e-Invoice Schema v1.0 (cbc:ProfileID mandatory).
 * TODO: cbc:ProfileID = "reporting:1.0" (B2C) or "billing:1.0" (B2B/B2G);
 *   cac:Signature block (signed by MyInvois platform on clearance);
 *   SHA-256 hash of the document for the submission envelope;
 *   SST registration (if applicable).
 */
export function buildMyInvois(data: InvoiceRenderData): string {
  const issueDate = isoDate(data);
  const tin = getIdentifier(data.company, 'VAT') || ''; // TIN (C/P/D + 12-14 digits)
  const total = sumNet(data.items);
  const vat = sumVat(data.items, 8);
  return `<!-- TODO: Malaysia MyInvois (LHDNM) — UBL 2.1 + LHDNM extensions; submit to MyInvois for clearance -->
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <cbc:ID>${data.rawNumber || 'DRAFT'}</cbc:ID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  <cbc:IssueTime>12:00:00</cbc:IssueTime>
  <cbc:InvoiceTypeCode listVersionID="1.0">01</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${data.company.currency || 'MYR'}</cbc:DocumentCurrencyCode>
  <cbc:ProfileID>billing:1.0</cbc:ProfileID>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cbc:IndustryClassificationCode>TODO-MSIC</cbc:IndustryClassificationCode>
      <cac:PartyIdentification><cbc:ID schemeID="TIN">${tin}</cbc:ID></cac:PartyIdentification>
      <cac:PartyLegalEntity><cbc:RegistrationName>${data.company.name}</cbc:RegistrationName></cac:PartyLegalEntity>
      <cac:PostalAddress>
        <cbc:CityName>${data.company.city || 'TODO'}</cbc:CityName>
        <cbc:PostalZone>${data.company.postalCode || 'TODO'}</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>MY</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification><cbc:ID schemeID="TIN">${getIdentifier(data.client, 'VAT') || 'EI00000000010'}</cbc:ID></cac:PartyIdentification>
      <cac:PartyLegalEntity><cbc:RegistrationName>${data.client.name}</cbc:RegistrationName></cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${data.company.currency || 'MYR'}">${vat.toFixed(2)}</cbc:TaxAmount>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="${data.company.currency || 'MYR'}">${total.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${data.company.currency || 'MYR'}">${(total + vat).toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${data.company.currency || 'MYR'}">${(total + vat).toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  ${data.items
    .map(
      (item, i) => `<cac:InvoiceLine>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">${item.quantity}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${data.company.currency || 'MYR'}">${(item.quantity * item.unitPrice).toFixed(2)}</cbc:LineExtensionAmount>
    <cac:Item><cbc:Description>${item.name}</cbc:Description></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="${data.company.currency || 'MYR'}">${item.unitPrice.toFixed(2)}</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>`,
    )
    .join('\n  ')}
</Invoice>
<!-- TODO: SHA-256 documentHash for MyInvois submission envelope + LHDNM validation + longId QR -->`;
}
