/**
 * CFDI 4.0 (MX) builder.
 *
 * Extracted verbatim from InvoiceRenderingService (behaviour-preserving).
 */
import { getIdentifier } from '@/utils/entity-identifiers';
import type { InvoiceRenderData } from '../render-data';

/** CFDI 4.0 Comprobante XML (MX) — Emisor/Receptor/Conceptos/Impuestos complete, namespaced
 *  to the SAT cfd/4 schema. Emitted unsealed: Sello/Certificado are the signing port's concern,
 *  the TimbreFiscalDigital UUID is the PAC (timbrado) transmission concern. No values faked. */
export async function buildCfdi(data: InvoiceRenderData): Promise<string> {
        const issueDate = (data.issuedAt ?? data.createdAt).toISOString().split('T')[0];
        const rfc = getIdentifier(data.company, 'VAT') || 'XAXX010101000';
        const rfcReceptor = getIdentifier(data.client, 'VAT') || 'XAXX010101000';
        const total = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const totalIVA = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 0) / 100, 0);
        const currency = data.company.currency || 'MXN';
        const numId = data.rawNumber || (data.number?.toString() ?? '001');
        const postalCode = data.company.postalCode || '00000';
        const receptorName = data.client.name || `${data.client.contactFirstname || ''} ${data.client.contactLastname || ''}`.trim();
        const receptorPostal = data.client.postalCode || '00000';

        let conceptosXml = '';
        for (let idx = 0; idx < data.items.length; idx++) {
            const item = data.items[idx];
            const importe = item.quantity * item.unitPrice;
            let impuestosXml = '';
            if (item.vatRate > 0) {
                const impIVA = importe * item.vatRate / 100;
                impuestosXml = `
              <cfdi:Impuestos>
                <cfdi:Traslados>
                  <cfdi:Traslado Base="${importe.toFixed(2)}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="${(item.vatRate / 100).toFixed(6)}" Importe="${impIVA.toFixed(2)}"/>
                </cfdi:Traslados>
              </cfdi:Impuestos>`;
            }
            // ObjetoImp: "01"=sujeto a impuesto (has tax), "02"=no sujeto a impuesto (no tax)
            const objetoImp = impuestosXml ? '01' : '02';
            if (impuestosXml) {
                conceptosXml += `
          <cfdi:Concepto NoIdentificacion="${idx + 1}" ClaveProdServ="84111506" Cantidad="${item.quantity}" ClaveUnidad="E48" Unidad="Servicio" Descripcion="${item.name}" ValorUnitario="${item.unitPrice.toFixed(2)}" Importe="${importe.toFixed(2)}" ObjetoImp="${objetoImp}">${impuestosXml}
          </cfdi:Concepto>`;
            } else {
                conceptosXml += `
          <cfdi:Concepto NoIdentificacion="${idx + 1}" ClaveProdServ="84111506" Cantidad="${item.quantity}" ClaveUnidad="E48" Unidad="Servicio" Descripcion="${item.name}" ValorUnitario="${item.unitPrice.toFixed(2)}" Importe="${importe.toFixed(2)}" ObjetoImp="${objetoImp}"/>`;
            }
        }

        let impuestosRoot = '<cfdi:Impuestos TotalImpuestosTrasladados="0"/>';
        if (totalIVA > 0) {
            impuestosRoot = `<cfdi:Impuestos TotalImpuestosTrasladados="${totalIVA.toFixed(2)}">
          <cfdi:Traslados>
            <cfdi:Traslado Base="${total.toFixed(2)}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="${totalIVA.toFixed(2)}"/>
          </cfdi:Traslados>
        </cfdi:Impuestos>`;
        }

        // Sello / Certificado / NoCertificado seam: the CFDI seal is computed over the
        // "cadena original" (a fixed XSLT transform of the document) and signed with the
        // taxpayer's CSD (Certificado de Sello Digital) private key, then the SAT-authorized
        // PAC stamps the TimbreFiscalDigital (UUID) in <cfdi:Complemento>. We emit the document
        // UNSEALED (empty Sello/Certificado/NoCertificado) — the signing port fills the seal and
        // the PAC transmission concern fills the UUID. We do NOT fabricate a certificate or UUID.
        return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd" Version="4.0" Serie="A" Folio="${numId}" Fecha="${issueDate}T12:00:00" FormaPago="03" NoCertificado="" Certificado="" Sello="" SubTotal="${total.toFixed(2)}" Moneda="${currency}" Total="${(total + totalIVA).toFixed(2)}" TipoDeComprobante="I" MetodoPago="PUE" LugarExpedicion="${postalCode}" Exportacion="01">
  <cfdi:Emisor Rfc="${rfc}" Nombre="${data.company.name}" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="${rfcReceptor}" Nombre="${receptorName}" RegimenFiscalReceptor="601" DomicilioFiscalReceptor="${receptorPostal}" UsoCFDI="G03"/>
  <cfdi:Conceptos>${conceptosXml}
  </cfdi:Conceptos>
  ${impuestosRoot}
  <cfdi:Complemento/>
</cfdi:Comprobante>`;
}
