/**
 * LATAM national e-invoice skeleton builders (live-deferred scaffolds).
 *
 * Pure functions: InvoiceRenderData in, national XML/JSON string out.
 * Extracted verbatim from InvoiceRenderingService (behaviour-preserving).
 */
import { getIdentifier } from '@/utils/entity-identifiers';
import type { InvoiceRenderData } from '../render-data';
import { sumNet, sumVat, isoDate, isoDateTimeSeconds } from './xml-helpers';

export function buildClDte(data: InvoiceRenderData): string {
        const issueDate = isoDate(data);
        const rut = getIdentifier(data.company, 'VAT') || '';
        const total = sumNet(data.items);
        const totalIVA = sumVat(data.items);
        return `<!-- TODO: Chile DTE (SII) — requires Folio電子 + Digital Signature -->
<ClaveDTE>
  <Encabezado>
    <IdDoc><TipoDTE>33</TipoDTE><Folio>1</Folio><FchEmis>${issueDate}</FchEmis></IdDoc>
    <Emisor><RUTEmisor>${rut}</RUTEmisor><RznSocEmisor>${data.company.name}</RznSocEmisor></Emisor>
    <Receptor><RUTRecep>${getIdentifier(data.client, 'VAT') || ''}</RUTRecep><RznSocRecep>${data.client.name}</RznSocRecep></Receptor>
    <Totals><MntNeto>${total.toFixed(2)}</MntNeto><IVA>${totalIVA.toFixed(2)}</IVA><MntTotal>${(total + totalIVA).toFixed(2)}</MntTotal></Totals>
  </Encabezado>
  <Detalle>${data.items.map((item, i) => `<Dtl><NroLinea>${i + 1}</NroLinea><NmbItem>${item.name}</NmbItem><QtyItem>${item.quantity}</QtyItem><PrcItem>${item.unitPrice}</PrcItem></Dtl>`).join('')}</Detalle>
</ClaveDTE>
<!-- TODO: FIRMA ELECTRÓNICA (SII Digital Signature) -->`;
}

export function buildArFe(data: InvoiceRenderData): string {
        const issueDate = isoDate(data);
        const cuit = getIdentifier(data.company, 'VAT') || '';
        const total = sumNet(data.items);
        const totalIVA = sumVat(data.items);
        return `<!-- TODO: Argentina Factura Electronica (AFIP/ARCA) — requires CAE + Digital Signature -->
<Factura>
  <Cabecera>
    <TipoComprobante>1</TipoComprobante>
    <PuntoVenta>1</PuntoVenta>
    <FechaEmision>${issueDate}</FechaEmision>
    <CUIT>${cuit}</CUIT>
  </Cabecera>
  <Detalles>${data.items.map((item, i) => `<Detalle><Id>${i + 1}</Id><Descripcion>${item.name}</Descripcion><Cantidad>${item.quantity}</Cantidad><PrecioUnitario>${item.unitPrice}</PrecioUnitario></Detalle>`).join('')}</Detalles>
  <Totales><Neto>${total.toFixed(2)}</Neto><IVA>${totalIVA.toFixed(2)}</IVA><Total>${(total + totalIVA).toFixed(2)}</Total></Totales>
</Factura>
<!-- TODO: CAE (AFIP Authorization Code) + QR Code -->`;
}

export function buildEcFe(data: InvoiceRenderData): string {
        const issueDate = isoDate(data);
        const ruc = getIdentifier(data.company, 'VAT') || '';
        const total = sumNet(data.items);
        const totalIVA = sumVat(data.items);
        return `<!-- TODO: Ecuador Factura Electronica (SRI) — requires ClaveAcceso + Digital Signature -->
<Factura>
  <InfoTributaria><Ambiente>1</Ambiente><TipoEmision>1</TipoEmision><Ruc>${ruc}</Ruc></InfoTributaria>
  <InfoFactura><FechaEmision>${issueDate}</FechaEmision><TotalSinImpuestos>${total.toFixed(2)}</TotalSinImpuestos><ImporteTotal>${(total + totalIVA).toFixed(2)}</ImporteTotal></InfoFactura>
  <Detalles>${data.items.map((item, i) => `<Detalle><CodigoPrincipal>${i + 1}</CodigoPrincipal><Descripcion>${item.name}</Descripcion><Cantidad>${item.quantity}</Cantidad><PrecioUnitario>${item.unitPrice}</PrecioUnitario></Detalle>`).join('')}</Detalles>
</Factura>
<!-- TODO: ClaveAcceso (SRI Access Key) + Firma Digital -->`;
}

export function buildBrNfe(data: InvoiceRenderData): string {
        const issueDate = isoDate(data);
        const cnpj = getIdentifier(data.company, 'VAT') || '';
        const total = sumNet(data.items);
        const totalIVA = sumVat(data.items);
        return `<!-- TODO: Brazil NF-e/NFS-e (SEFAZ) — requires ChaveAcesso + Digital Signature + Lote -->
<nfeProc>
  <NFe>
    <infNFe versao="4.00">
      <ide><natOp>Serviço</natOp><mod>55</mod><serie>1</serie><tpEmis>1</tpEmis><dhEmi>${issueDate}T12:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>${cnpj}</CNPJ><xNome>${data.company.name}</xNome><CRT>1</CRT></emit>
      <det nItem="1"><prod><cProd>1</cProd><xProd>${data.items[0]?.name || 'Service'}</xProd><qCom>${data.items[0]?.quantity || 1}</qCom><vUnCom>${data.items[0]?.unitPrice || 0}</vUnCom><vProd>${total.toFixed(2)}</vProd></prod></det>
      <total><ICMSTot><vBC>${total.toFixed(2)}</vBC><vICMS>${totalIVA.toFixed(2)}</vICMS><vNF>${(total + totalIVA).toFixed(2)}</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
</nfeProc>
<!-- TODO: ChaveAcesso + Protocolo + Lote (SEFAZ submission) -->`;
}

/**
 * Costa Rica — Hacienda Factura Electrónica v4.4.
 * Schema: https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica
 * TODO: generate real 50-digit Clave; sign with BCCR qualified cert; POST to
 *   https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1/hacienda
 */
export function buildCrFe(data: InvoiceRenderData): string {
        const issueDate = isoDateTimeSeconds(data);
        const ruc = getIdentifier(data.company, 'VAT') || '';
        const total = sumNet(data.items);
        const totalIVA = sumVat(data.items);
        return `<!-- TODO: Costa Rica FE v4.4 (Hacienda) — requires 50-digit Clave + BCCR qualified signature -->
<FacturaElectronica xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica"
  xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
  <Clave>TODO-50-DIGIT-CLAVE</Clave>
  <CodigoActividad>620100</CodigoActividad>
  <NumeroConsecutivo>00100001010000000001</NumeroConsecutivo>
  <FechaEmision>${issueDate}</FechaEmision>
  <Emisor>
    <Nombre>${data.company.name}</Nombre>
    <Identificacion><Tipo>02</Tipo><Numero>${ruc}</Numero></Identificacion>
    <CorreoElectronico>${(data.company as any).email || 'info@empresa.cr'}</CorreoElectronico>
  </Emisor>
  <Receptor>
    <Nombre>${data.client.name}</Nombre>
    <Identificacion><Tipo>02</Tipo><Numero>${getIdentifier(data.client, 'VAT') || ''}</Numero></Identificacion>
  </Receptor>
  <CondicionVenta>01</CondicionVenta>
  <MedioPago>01</MedioPago>
  <DetalleServicio>${data.items.map((item, i) => `
    <LineaDetalle>
      <NumeroLinea>${i + 1}</NumeroLinea>
      <Cantidad>${item.quantity}</Cantidad>
      <Detalle>${item.name}</Detalle>
      <PrecioUnitario>${item.unitPrice.toFixed(5)}</PrecioUnitario>
      <MontoTotal>${(item.quantity * item.unitPrice).toFixed(5)}</MontoTotal>
      <Impuesto>
        <Codigo>01</Codigo>
        <CodigoTarifa>${item.vatRate === 13 ? '08' : item.vatRate === 4 ? '02' : '01'}</CodigoTarifa>
        <Tarifa>${item.vatRate || 0}</Tarifa>
        <Monto>${(item.quantity * item.unitPrice * (item.vatRate || 0) / 100).toFixed(5)}</Monto>
      </Impuesto>
      <MontoTotalLinea>${(item.quantity * item.unitPrice * (1 + (item.vatRate || 0) / 100)).toFixed(5)}</MontoTotalLinea>
    </LineaDetalle>`).join('')}
  </DetalleServicio>
  <ResumenFactura>
    <CodigoTipoMoneda><CodigoMoneda>${data.company.currency || 'CRC'}</CodigoMoneda><TipoCambio>1</TipoCambio></CodigoTipoMoneda>
    <TotalServGravados>${total.toFixed(5)}</TotalServGravados>
    <TotalGravado>${total.toFixed(5)}</TotalGravado>
    <TotalImpuesto>${totalIVA.toFixed(5)}</TotalImpuesto>
    <TotalComprobante>${(total + totalIVA).toFixed(5)}</TotalComprobante>
  </ResumenFactura>
</FacturaElectronica>
<!-- TODO: POST to Hacienda API + poll for respuesta-Hacienda (aceptado/rechazado) -->`;
}

/**
 * Dominican Republic — e-Comprobante Fiscal Electrónico (e-CF).
 * Schema: DGII ECF v1.0
 * TODO: sign with approved CA certificate; submit to
 *   https://ecf.dgii.gov.do/testecf/emisorreceptor (test) or
 *   https://ecf.dgii.gov.do/ecf/emisorreceptor (prod)
 */
export function buildDoEcf(data: InvoiceRenderData): string {
        const issueDate = isoDate(data);
        const rnc = getIdentifier(data.company, 'VAT') || '';
        const total = sumNet(data.items);
        const totalIVA = sumVat(data.items);
        return `<!-- TODO: Dominican Republic e-CF (DGII) — requires e-NCF number series + digital signature -->
<FCCE xmlns="http://www.dgii.gov.do/xml/ecf">
  <Encabezado>
    <Version>1.0</Version>
    <IdDoc>
      <TipoeCF>31</TipoeCF>
      <eNCF>TODO-E-NCF-NUMBER</eNCF>
      <FechaVencimientoSecuencia>TODO</FechaVencimientoSecuencia>
      <IndicadorEnvioDiferido>0</IndicadorEnvioDiferido>
      <IndicadorMontoGravado>0</IndicadorMontoGravado>
      <TipoIngresos>01</TipoIngresos>
      <TipoPago>1</TipoPago>
      <FechaPago>${issueDate}</FechaPago>
      <TotalPaginas>1</TotalPaginas>
    </IdDoc>
    <Emisor>
      <RNCEmisor>${rnc}</RNCEmisor>
      <RazonSocialEmisor>${data.company.name}</RazonSocialEmisor>
      <FechaEmision>${issueDate}</FechaEmision>
    </Emisor>
    <Comprador>
      <RNCComprador>${getIdentifier(data.client, 'VAT') || ''}</RNCComprador>
      <RazonSocialComprador>${data.client.name}</RazonSocialComprador>
    </Comprador>
    <Totales>
      <MontoGravadoTotal>${total.toFixed(2)}</MontoGravadoTotal>
      <ITBIS1>${totalIVA.toFixed(2)}</ITBIS1>
      <MontoTotal>${(total + totalIVA).toFixed(2)}</MontoTotal>
    </Totales>
  </Encabezado>
  <DetallesItems>${data.items.map((item, i) => `
    <Item>
      <NumeroLinea>${i + 1}</NumeroLinea>
      <NombreItem>${item.name}</NombreItem>
      <IndicadorFacturacion>1</IndicadorFacturacion>
      <CantidadItem>${item.quantity}</CantidadItem>
      <PrecioUnitarioItem>${item.unitPrice.toFixed(2)}</PrecioUnitarioItem>
      <TablaSubDescuento><SubDescuento><TipoSubDescuento>01</TipoSubDescuento><PorcentajeSubDescuento>0.00</PorcentajeSubDescuento><MontoSubDescuento>0.00</MontoSubDescuento></SubDescuento></TablaSubDescuento>
      <MontoItem>${(item.quantity * item.unitPrice).toFixed(2)}</MontoItem>
    </Item>`).join('')}
  </DetallesItems>
</FCCE>
<!-- TODO: e-NCF numbering via DGII + XAdES-BES signature + POST to DGII -->`;
}

/**
 * Guatemala — FEL (Factura Electrónica en Línea) via SAT.
 * Schema: SAT FEL DTE v0.1
 * TODO: sign with CA-accredited certificate; certify via a SAT-authorized certificador
 *   (e.g. INFILE, G4S, Megaprint); SAT assigns UUID on certification.
 */
export function buildGtFel(data: InvoiceRenderData): string {
        const issueDate = (data.issuedAt ?? data.createdAt).toISOString().replace('.000', '');
        const nit = getIdentifier(data.company, 'VAT') || '';
        const total = sumNet(data.items);
        const totalIVA = sumVat(data.items);
        return `<!-- TODO: Guatemala FEL (SAT) — requires certificador authorization; SAT assigns UUID -->
<DTE xmlns="http://www.sat.gob.gt/dte/fel/0.1.0"
     xmlns:ds="http://www.w3.org/2000/09/xmldsig#"
     xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <DatosEmision>
    <DatosGenerales
      CodigoMoneda="${data.company.currency || 'GTQ'}"
      FechaHoraEmision="${issueDate}"
      Tipo="FACT"/>
    <Emisor
      AFiliacionIVA="GEN"
      CodigoEstablecimiento="1"
      CorreoEmisor="${(data.company as any).email || 'info@empresa.gt'}"
      NITEmisor="${nit}"
      NombreComercial="${data.company.name}"
      NombreEmisor="${data.company.name}">
      <DireccionEmisor>
        <Direccion>${data.company.address || ''}</Direccion>
        <CodigoPostal>${data.company.postalCode || '01001'}</CodigoPostal>
        <Municipio>${data.company.city || 'Guatemala'}</Municipio>
        <Departamento>Guatemala</Departamento>
        <Pais>GT</Pais>
      </DireccionEmisor>
    </Emisor>
    <Receptor
      CorreoReceptor="${(data.client as any).email || ''}"
      IDReceptor="${getIdentifier(data.client, 'VAT') || 'CF'}"
      NombreReceptor="${data.client.name}">
      <DireccionReceptor>
        <Direccion>${data.client.address || ''}</Direccion>
        <CodigoPostal>${data.client.postalCode || '01001'}</CodigoPostal>
        <Municipio>${data.client.city || ''}</Municipio>
        <Departamento>TODO</Departamento>
        <Pais>${data.client.country ? data.client.country.slice(0, 2).toUpperCase() : 'GT'}</Pais>
      </DireccionReceptor>
    </Receptor>
    <Frases>
      <Frase CodigoEscenario="1" TipoFrase="1"/>
    </Frases>
    <Items>${data.items.map((item, i) => `
      <Item BienOServicio="S" NumeroLinea="${i + 1}">
        <Cantidad>${item.quantity}</Cantidad>
        <UnidadMedida>UNI</UnidadMedida>
        <Descripcion>${item.name}</Descripcion>
        <PrecioUnitario>${item.unitPrice.toFixed(6)}</PrecioUnitario>
        <Precio>${(item.quantity * item.unitPrice).toFixed(6)}</Precio>
        <Descuento>0.000000</Descuento>
        <Impuestos>
          <Impuesto>
            <NombreCorto>IVA</NombreCorto>
            <CodigoUnidadGravable>1</CodigoUnidadGravable>
            <MontoGravable>${item.unitPrice.toFixed(6)}</MontoGravable>
            <MontoImpuesto>${(item.unitPrice * (item.vatRate || 0) / 100).toFixed(6)}</MontoImpuesto>
          </Impuesto>
        </Impuestos>
        <Total>${(item.quantity * item.unitPrice * (1 + (item.vatRate || 0) / 100)).toFixed(6)}</Total>
      </Item>`).join('')}
    </Items>
    <Totales>
      <TotalImpuestos>
        <TotalImpuesto NombreCorto="IVA" TotalMontoImpuesto="${totalIVA.toFixed(6)}"/>
      </TotalImpuestos>
      <GranTotal>${(total + totalIVA).toFixed(6)}</GranTotal>
    </Totales>
  </DatosEmision>
</DTE>
<!-- TODO: XAdES-BES digital signature + POST to certificador (INFILE etc.) → SAT UUID -->`;
}

/**
 * Panama — Factura Electrónica / Comprobante Fiscal Electrónico.
 * Schema: DGI FE v1.0
 * TODO: sign; submit via PAC (Proveedor Autorizado de Certificación) to
 *   https://sfep.mef.gob.pa/api/v1 (prod) or sandbox equivalent.
 */
export function buildPaFe(data: InvoiceRenderData): string {
        const issueDate = isoDate(data);
        const ruc = getIdentifier(data.company, 'VAT') || '';
        const total = sumNet(data.items);
        const totalIVA = sumVat(data.items);
        return `<!-- TODO: Panama FE/CF (DGI) — requires CUFE + digital signature + PAC submission -->
<DocumentoFiscal xmlns="http://www.dgi.gob.pa/ns/v1/fe">
  <Encabezado>
    <TipoDocumento>01</TipoDocumento>
    <NumeroDocumento>${data.rawNumber || 'DRAFT'}</NumeroDocumento>
    <PuntoFacturacionFiscal>001</PuntoFacturacionFiscal>
    <NaturalezaOperacion>01</NaturalezaOperacion>
    <TipoOperacion>1</TipoOperacion>
    <FechaEmision>${issueDate}</FechaEmision>
    <CUFE>TODO-CUFE</CUFE>
  </Encabezado>
  <Emisor>
    <RUC>${ruc}</RUC>
    <RazonSocial>${data.company.name}</RazonSocial>
    <DireccionFiscal>${data.company.address || ''}</DireccionFiscal>
  </Emisor>
  <Receptor>
    <RUCReceptor>${getIdentifier(data.client, 'VAT') || ''}</RUCReceptor>
    <NombreReceptor>${data.client.name}</NombreReceptor>
  </Receptor>
  <DetalleItems>${data.items.map((item, i) => `
    <Item>
      <Numero>${i + 1}</Numero>
      <Descripcion>${item.name}</Descripcion>
      <Cantidad>${item.quantity}</Cantidad>
      <PrecioUnitario>${item.unitPrice.toFixed(2)}</PrecioUnitario>
      <Subtotal>${(item.quantity * item.unitPrice).toFixed(2)}</Subtotal>
      <ITBMS>${(item.quantity * item.unitPrice * (item.vatRate || 0) / 100).toFixed(2)}</ITBMS>
      <Total>${(item.quantity * item.unitPrice * (1 + (item.vatRate || 0) / 100)).toFixed(2)}</Total>
    </Item>`).join('')}
  </DetalleItems>
  <Totales>
    <SubtotalSinITBMS>${total.toFixed(2)}</SubtotalSinITBMS>
    <ITBMS>${totalIVA.toFixed(2)}</ITBMS>
    <Total>${(total + totalIVA).toFixed(2)}</Total>
  </Totales>
</DocumentoFiscal>
<!-- TODO: CUFE (código único de factura electrónica) + signature + DGI/PAC -->`;
}

/**
 * Paraguay — e-Kuatia Documento Electrónico (DE).
 * Schema: SIFEN DE v150
 * TODO: compute CDC (44-char control code); sign with ANDE-accredited certificate;
 *   POST to https://sifen.set.gov.py/de/ws/sync/recibe.wsdl (SOAP).
 */
export function buildPyDe(data: InvoiceRenderData): string {
        const issueDt = isoDateTimeSeconds(data);
        const ruc = getIdentifier(data.company, 'VAT') || '';
        const total = sumNet(data.items);
        const totalIVA = sumVat(data.items);
        return `<!-- TODO: Paraguay e-Kuatia DE (SIFEN) — requires CDC + digital signature + SIFEN SOAP -->
<DE xmlns="http://ekuatia.set.gov.py/sifen/xsd"
    xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
  <Id>TODO-CDC-44-CHARS</Id>
  <gDtipDE>
    <iTiDE>1</iTiDE>
    <dDesTiDE>Factura electrónica</dDesTiDE>
    <dNumTim>12345678</dNumTim>
    <dEst>001</dEst>
    <dPunExp>001</dPunExp>
    <dNumDoc>${data.rawNumber || '0000001'}</dNumDoc>
    <dSerieNum>TODO</dSerieNum>
    <dFeIniT>${issueDt}</dFeIniT>
  </gDtipDE>
  <gDatGralOpe>
    <dFecFirma>${issueDt}</dFecFirma>
    <dSisFact>1</dSisFact>
    <gOpeCom>
      <iTipTra>1</iTipTra>
      <iTImp>1</iTImp>
      <cMoneOpe>${data.company.currency || 'PYG'}</cMoneOpe>
      <dCondTipCam>1</dCondTipCam>
    </gOpeCom>
    <gEmis>
      <dRucEm>${ruc}</dRucEm>
      <dNomEmi>${data.company.name}</dNomEmi>
      <dNomFanEmi>${data.company.name}</dNomFanEmi>
    </gEmis>
    <gDatRec>
      <iNatRec>1</iNatRec>
      <iTiOpe>1</iTiOpe>
      <cPaisRec>PRY</cPaisRec>
      <dRucRec>${getIdentifier(data.client, 'VAT') || ''}</dRucRec>
      <dNomRec>${data.client.name}</dNomRec>
    </gDatRec>
  </gDatGralOpe>
  <gDtipDEFe>
    <gCamFE>
      <iIndPres>1</iIndPres>
    </gCamFE>
    <gCamItem>${data.items.map((item, i) => `
      <cUniMed>77</cUniMed>
      <dDesProSer>${item.name}</dDesProSer>
      <dCantProSer>${item.quantity}</dCantProSer>
      <dUniMed>${item.quantity}</dUniMed>
      <gValorItem>
        <dPUniProSer>${item.unitPrice.toFixed(8)}</dPUniProSer>
        <dTotBruOpeItem>${(item.quantity * item.unitPrice).toFixed(8)}</dTotBruOpeItem>
        <dDescItem>0</dDescItem>
        <dPorcDesIt>0</dPorcDesIt>
        <dDescGloItem>0</dDescGloItem>
        <dAntGloPreUniIt>0</dAntGloPreUniIt>
        <dTotNeto>${(item.quantity * item.unitPrice).toFixed(8)}</dTotNeto>
        <gValorRestaItem>
          <dDescuento>0</dDescuento>
          <dAnticipo>0</dAnticipo>
          <dRecargoInc>0</dRecargoInc>
          <dTotOpeItem>${(item.quantity * item.unitPrice).toFixed(8)}</dTotOpeItem>
          <dTotOpeGs>0</dTotOpeGs>
        </gValorRestaItem>
      </gValorItem>
      <gCamIVA>
        <iAfecIVA>${i + 1}</iAfecIVA>
        <dPropIVA>100</dPropIVA>
        <dTasaIVA>${item.vatRate || 0}</dTasaIVA>
        <dBasGravIVA>${(item.quantity * item.unitPrice).toFixed(8)}</dBasGravIVA>
        <dLiqIVAItem>${(item.quantity * item.unitPrice * (item.vatRate || 0) / 100).toFixed(8)}</dLiqIVAItem>
      </gCamIVA>`).join('')}
    </gCamItem>
  </gDtipDEFe>
  <gTotSub>
    <dSubExe>0</dSubExe>
    <dSubExo>0</dSubExo>
    <dSub5>0</dSub5>
    <dSub10>${total.toFixed(8)}</dSub10>
    <dSumSubTot>${total.toFixed(8)}</dSumSubTot>
    <dSumDescTot>0</dSumDescTot>
    <dSumAntTot>0</dSumAntTot>
    <dTotGralOpe>${(total + totalIVA).toFixed(8)}</dTotGralOpe>
    <dIVA5>0</dIVA5>
    <dIVA10>${totalIVA.toFixed(8)}</dIVA10>
    <dTotIVA>${totalIVA.toFixed(8)}</dTotIVA>
    <dBaseGrav5>0</dBaseGrav5>
    <dBaseGrav10>${total.toFixed(8)}</dBaseGrav10>
    <dTBasGraIVA>${total.toFixed(8)}</dTBasGraIVA>
  </gTotSub>
</DE>
<!-- TODO: CDC (control code) + XAdES-BES signature + SIFEN SOAP submission -->`;
}

/**
 * El Salvador — Documento Tributario Electrónico (DTE) — JSON format (not XML).
 * Schema: MH DTE v1 (JSON)
 * TODO: generate real códigoGeneración UUID; sign JSON (JWS); POST to
 *   https://apitest.dtes.mh.gob.sv/fesv/recepciondte (test) or
 *   https://api.dtes.mh.gob.sv/fesv/recepciondte (prod)
 *
 * NOTE: SV DTE is JSON — this method returns a JSON string, not XML.
 */
export function buildSvDte(data: InvoiceRenderData): string {
        const issueDt = isoDateTimeSeconds(data);
        const issueDate = issueDt.split('T')[0];
        const issueTime = issueDt.split('T')[1] || '00:00:00';
        const nit = getIdentifier(data.company, 'VAT') || '';
        const total = sumNet(data.items);
        const totalIVA = sumVat(data.items);
        const dte = {
            nit,
            activo: true,
            passwordPri: 'TODO-PRIVATE-KEY-HASH',
            dteJson: {
                identificacion: {
                    version: 1,
                    ambiente: '00', // 00=test, 01=prod
                    tipoDte: '01', // 01=Factura
                    numeroControl: `DTE-01-${data.rawNumber || 'DRAFT'}-${String(Date.now()).slice(-15)}`,
                    codigoGeneracion: 'TODO-UUID-V4',
                    tipoModelo: 1,
                    tipoOperacion: 1,
                    tipoContingencia: null,
                    motivoContigencia: null,
                    fecEmi: issueDate,
                    horEmi: issueTime,
                    tipoMoneda: data.company.currency || 'USD',
                },
                emisor: {
                    nit,
                    nrc: 'TODO-NRC',
                    nombre: data.company.name,
                    codActividad: '620100',
                    descActividad: 'Servicios de TI',
                    nombreComercial: data.company.name,
                    tipoEstablecimiento: '01',
                    direccion: { departamento: '06', municipio: '23', complemento: data.company.address || '' },
                    telefono: (data.company as any).phone || '2200-0000',
                    correo: (data.company as any).email || 'info@empresa.sv',
                },
                receptor: {
                    tipoDocumento: '36',
                    numDocumento: getIdentifier(data.client, 'VAT') || '',
                    nrc: null,
                    nombre: data.client.name,
                    codActividad: null,
                    descActividad: null,
                    direccion: null,
                    telefono: null,
                    correo: null,
                },
                cuerpoDocumento: data.items.map((item, i) => ({
                    numItem: i + 1,
                    tipoItem: 2, // 2=servicio
                    numeroDocumento: null,
                    cantidad: item.quantity,
                    codigo: String(i + 1).padStart(6, '0'),
                    codTributo: null,
                    uniMedida: 59, // 59=unidad
                    descripcion: item.name,
                    precioUni: item.unitPrice,
                    montoDescu: 0,
                    ventaNoSuj: 0,
                    ventaExenta: 0,
                    ventaGravada: parseFloat((item.quantity * item.unitPrice).toFixed(2)),
                    tributos: ['20'], // 20=IVA
                    psv: 0,
                    noGravado: 0,
                    ivaItem: parseFloat((item.quantity * item.unitPrice * (item.vatRate || 0) / 100).toFixed(2)),
                })),
                resumen: {
                    totalNoSuj: 0,
                    totalExenta: 0,
                    totalGravada: parseFloat(total.toFixed(2)),
                    subTotalVentas: parseFloat(total.toFixed(2)),
                    descuNoSuj: 0,
                    descuExenta: 0,
                    descuGravada: 0,
                    porcentajeDescuento: 0,
                    totalDescu: 0,
                    tributos: [{ codigo: '20', descripcion: 'IVA', valor: parseFloat(totalIVA.toFixed(2)) }],
                    subTotal: parseFloat(total.toFixed(2)),
                    ivaRete1: 0,
                    reteRenta: 0,
                    montoTotalOperacion: parseFloat((total + totalIVA).toFixed(2)),
                    totalNoGravado: 0,
                    totalPagar: parseFloat((total + totalIVA).toFixed(2)),
                    totalLetras: 'TODO',
                    totalIva: parseFloat(totalIVA.toFixed(2)),
                    saldoFavor: 0,
                    condicionOperacion: 1,
                    pagos: [{ codigo: '01', montoPago: parseFloat((total + totalIVA).toFixed(2)), referencia: null, plazo: null, periodo: null }],
                    numPagoElectronico: null,
                },
                extension: null,
                apendice: null,
            },
        };
        return `<!-- TODO: El Salvador DTE (MH) — JSON format; requires JWS signature + MH submission -->
<!-- SV DTE is JSON, not XML. The actual payload is below: -->
${JSON.stringify(dte, null, 2)}
<!-- TODO: selloRecibido (received timestamp from MH) + real códigoGeneración UUID -->`;
}

/**
 * Uruguay — Comprobante Fiscal Electrónico (CFE / e-Factura / e-Ticket).
 * Schema: DGI CFE e-Factura (RES 798/2012 + updates)
 * TODO: generate CAE (Constancia de Autorización Electrónica) number from DGI;
 *   sign with XAdES-BES; POST via WS to DGI.
 */
export function buildUyCfe(data: InvoiceRenderData): string {
        const issueDt = isoDateTimeSeconds(data);
        const issueDate = issueDt.split('T')[0];
        const rut = getIdentifier(data.company, 'VAT') || '';
        const total = sumNet(data.items);
        const totalIVA = sumVat(data.items);
        return `<!-- TODO: Uruguay CFE e-Factura (DGI) — requires CAE numbering + XAdES-BES signature -->
<CFE xmlns="http://www.dgi.gub.uy"
     xmlns:ds="http://www.w3.org/2000/09/xmldsig#"
     version="1.0">
  <eFact>
    <TmstFirma>${issueDt}</TmstFirma>
    <Encabezado>
      <IdDoc>
        <TipoCFE>111</TipoCFE>
        <Serie>A</Serie>
        <Nro>${data.rawNumber || 'TODO'}</Nro>
        <FechEmis>${issueDate}</FechEmis>
        <FchVenc>TODO</FchVenc>
        <MntBruto>1</MntBruto>
        <FmaPago>1</FmaPago>
        <MdosPago>
          <MdoPago>
            <FmaPago>1</FmaPago>
            <MontoMP>${(total + totalIVA).toFixed(2)}</MontoMP>
            <CodMnpMP>${data.company.currency || 'UYU'}</CodMnpMP>
          </MdoPago>
        </MdosPago>
      </IdDoc>
      <Emisor>
        <RUCEmisor>${rut}</RUCEmisor>
        <RznSoc>${data.company.name}</RznSoc>
        <NomFantasia>${data.company.name}</NomFantasia>
        <CdgDGISucur>001</CdgDGISucur>
        <DomFiscal>${data.company.address || ''}</DomFiscal>
        <Ciudad>${data.company.city || ''}</Ciudad>
        <Departamento>TODO</Departamento>
      </Emisor>
      <Receptor>
        <TipoDocRecep>2</TipoDocRecep>
        <CodPaisRecep>UY</CodPaisRecep>
        <DocRecep>${getIdentifier(data.client, 'VAT') || ''}</DocRecep>
        <RznSocRecep>${data.client.name}</RznSocRecep>
        <DirRecep>${data.client.address || ''}</DirRecep>
        <CiudadRecep>${data.client.city || ''}</CiudadRecep>
      </Receptor>
      <Totales>
        <TpoMoneda>${data.company.currency || 'UYU'}</TpoMoneda>
        <MntNetoIvaTasaMin>0</MntNetoIvaTasaMin>
        <MntNetoIVATasaBasica>${total.toFixed(2)}</MntNetoIVATasaBasica>
        <IVATasaMin>0</IVATasaMin>
        <IVATasaBasica>${totalIVA.toFixed(2)}</IVATasaBasica>
        <MntTotal>${(total + totalIVA).toFixed(2)}</MntTotal>
        <CantLinDet>${data.items.length}</CantLinDet>
        <MontoNF>${(total + totalIVA).toFixed(2)}</MontoNF>
      </Totales>
    </Encabezado>
    <Detalle>${data.items.map((item, i) => `
      <Item>
        <NroLinDet>${i + 1}</NroLinDet>
        <IndFact>3</IndFact>
        <NomItem>${item.name}</NomItem>
        <Cantidad>${item.quantity}</Cantidad>
        <UniMed>unit</UniMed>
        <PrecioUnitario>${item.unitPrice.toFixed(6)}</PrecioUnitario>
        <MontoItem>${(item.quantity * item.unitPrice).toFixed(2)}</MontoItem>
      </Item>`).join('')}
    </Detalle>
  </eFact>
</CFE>
<!-- TODO: CAE (Constancia de Autorización Electrónica) from DGI + XAdES-BES + WS submission -->`;
}

/**
 * Venezuela — Factura Electrónica (SENIAT).
 * Schema: SENIAT XML v1.0 (Resolución SNAT/2011/0071)
 * TODO: sign; submit to SENIAT portal (currently unstable; system uses SIVEF).
 */
export function buildVeFe(data: InvoiceRenderData): string {
        const issueDate = isoDate(data);
        const rif = getIdentifier(data.company, 'VAT') || '';
        const total = sumNet(data.items);
        const totalIVA = sumVat(data.items);
        return `<!-- TODO: Venezuela Factura Electrónica (SENIAT/SIVEF) — submission system currently in flux -->
<FacturaElectronica xmlns="http://www.seniat.gob.ve/namespace/factura_electronica/v1.0">
  <EncabezadoFactura>
    <NumeroFactura>${data.rawNumber || 'DRAFT'}</NumeroFactura>
    <FechaEmision>${issueDate}</FechaEmision>
    <TipoDocumento>01</TipoDocumento>
    <Moneda>${data.company.currency || 'VES'}</Moneda>
  </EncabezadoFactura>
  <Emisor>
    <RIF>${rif}</RIF>
    <RazonSocial>${data.company.name}</RazonSocial>
    <Direccion>${data.company.address || ''}</Direccion>
  </Emisor>
  <Receptor>
    <RIFReceptor>${getIdentifier(data.client, 'VAT') || ''}</RIFReceptor>
    <RazonSocialReceptor>${data.client.name}</RazonSocialReceptor>
  </Receptor>
  <Detalles>${data.items.map((item, i) => `
    <Linea>
      <Numero>${i + 1}</Numero>
      <Descripcion>${item.name}</Descripcion>
      <Cantidad>${item.quantity}</Cantidad>
      <PrecioUnitario>${item.unitPrice.toFixed(2)}</PrecioUnitario>
      <Monto>${(item.quantity * item.unitPrice).toFixed(2)}</Monto>
      <AlicuotaIVA>${item.vatRate || 0}</AlicuotaIVA>
      <IVA>${(item.quantity * item.unitPrice * (item.vatRate || 0) / 100).toFixed(2)}</IVA>
    </Linea>`).join('')}
  </Detalles>
  <Totales>
    <BaseImponible>${total.toFixed(2)}</BaseImponible>
    <MontoIVA>${totalIVA.toFixed(2)}</MontoIVA>
    <MontoTotal>${(total + totalIVA).toFixed(2)}</MontoTotal>
  </Totales>
</FacturaElectronica>
<!-- TODO: digital signature (SUSCERTE-accredited CA) + SENIAT/SIVEF submission -->`;
}

/**
 * Bolivia — Facturación Electrónica SIN (Sistema Integral de Facturación).
 * Schema: SIN XML (Resolución Normativa de Directorio 101800000011)
 * TODO: compute CUF (Código Único de Facturación); compute CUFD (Código Único
 *   de Facturación Diaria); sign; submit to SIN API.
 */
export function buildBoFe(data: InvoiceRenderData): string {
        const issueDt = isoDateTimeSeconds(data);
        const nit = getIdentifier(data.company, 'VAT') || '';
        const total = sumNet(data.items);
        const totalIVA = sumVat(data.items);
        return `<!-- TODO: Bolivia Facturación Electrónica SIN — requires CUF/CUFD + digital signature -->
<facturaComputarizadaCompraVenta xmlns="urn:siat:facturaelectronica:v2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <cabecera>
    <nitEmisor>${nit}</nitEmisor>
    <razonSocialEmisor>${data.company.name}</razonSocialEmisor>
    <municipio>TODO</municipio>
    <telefono>${(data.company as any).phone || ''}</telefono>
    <numeroFactura>${data.rawNumber || 'DRAFT'}</numeroFactura>
    <cuf>TODO-CUF-64-CHARS</cuf>
    <cufd>TODO-CUFD</cufd>
    <codigoSucursal>0</codigoSucursal>
    <direccion>${data.company.address || ''}</direccion>
    <codigoPuntoVenta xsi:nil="true"/>
    <fechaEmision>${issueDt}</fechaEmision>
    <nombreRazonSocial>${data.client.name}</nombreRazonSocial>
    <codigoTipoDocumentoIdentidad>5</codigoTipoDocumentoIdentidad>
    <numeroDocumento>${getIdentifier(data.client, 'VAT') || ''}</numeroDocumento>
    <complemento xsi:nil="true"/>
    <codigoCliente>${getIdentifier(data.client, 'VAT') || ''}</codigoCliente>
    <codigoMetodoPago>1</codigoMetodoPago>
    <importeTotal>${(total + totalIVA).toFixed(2)}</importeTotal>
    <importeTotalSujetoIva>${total.toFixed(2)}</importeTotalSujetoIva>
    <codigoMoneda>1</codigoMoneda>
    <tipoCambio>1</tipoCambio>
    <importeTotalMoneda>${(total + totalIVA).toFixed(2)}</importeTotalMoneda>
    <leyenda>Ley 453: el proveedor no está obligado a emitir nota fiscal.</leyenda>
    <usuario>${(data.company as any).email || ''}</usuario>
    <codigoDocumentoSector>1</codigoDocumentoSector>
  </cabecera>
  <detalle>${data.items.map((item, i) => `
    <detalleFactura>
      <actividadEconomica>TODO</actividadEconomica>
      <codigoProductoSin>83111</codigoProductoSin>
      <codigoProducto>${String(i + 1).padStart(6, '0')}</codigoProducto>
      <descripcion>${item.name}</descripcion>
      <cantidad>${item.quantity}</cantidad>
      <unidadMedida>57</unidadMedida>
      <precioUnitario>${item.unitPrice.toFixed(2)}</precioUnitario>
      <montoDescuento>0.00</montoDescuento>
      <subTotal>${(item.quantity * item.unitPrice).toFixed(2)}</subTotal>
    </detalleFactura>`).join('')}
  </detalle>
</facturaComputarizadaCompraVenta>
<!-- TODO: CUF (Código Único de Facturación) algorithm + CUFD + SIN API submission -->`;
}
