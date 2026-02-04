import { Injectable } from '@nestjs/common';
import { BaseFormatGenerator } from './base.generator';
import { FormatConfig, InvoiceData, FormatResult } from '../../interfaces/format.interface';

/**
 * FatturaPA Generator (Italy-specific format)
 * Used by Sistema di Interscambio (SDI)
 * Version: 1.2.2 (current standard)
 */
@Injectable()
export class FatturaPAGenerator extends BaseFormatGenerator {
  readonly name = 'FatturaPA';
  readonly supportedFormats = ['fatturapa'];

  supports(format: string): boolean {
    return this.supportedFormats.includes(format);
  }

  async generate(invoice: InvoiceData, config: FormatConfig): Promise<FormatResult> {
    const xml = this.generateFatturaPA(invoice);

    return {
      xml: this.wrapWithDeclaration(xml),
      format: 'fatturapa',
      mimeType: 'application/xml',
    };
  }

  /**
   * Generate FatturaPA 1.2.2 XML
   */
  private generateFatturaPA(invoice: InvoiceData): string {
    const seller = invoice.supplier;
    const buyer = invoice.customer;
    const currencyCode = invoice.currency || 'EUR';

    return `<p:FatturaElettronica xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2"
                              xmlns:ds="http://www.w3.org/2000/09/xmldsig#"
                              xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                              xsi:schemaLocation="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2 http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2/fattura_v1.2.xsd"
                              versione="1.2.2">
  <p:FatturaElettronicaHeader>
    <p:DatiTrasmissione>
      <p:IdTrasmittente>${this.escapeXml(seller.identifiers?.codicefiscale || '')}</p:IdTrasmittente>
      <p:ProgressivoInvio>00001</p:ProgressivoInvio>
      <p:FormatoTrasmissione>FPA12</p:FormatoTrasmissione>
      <p:CodiceDestinatario>0000000</p:CodiceDestinatario>
    </p:DatiTrasmissione>
    <p:CedentePrestatore>
      <p:DatiAnagrafici>
        <p:IdFiscaleIVA>${this.escapeXml(seller.identifiers?.piva || '')}</p:IdFiscaleIVA>
        <p:CodiceFiscale>${this.escapeXml(seller.identifiers?.codicefiscale || '')}</p:CodiceFiscale>
        <p:Anagrafica>
          <p:Denominazione>${this.escapeXml(seller.name || '')}</p:Denominazione>
          ${seller.company ? `<p:Nome>${this.escapeXml(seller.company)}</p:Nome>` : ''}
          ${seller.firstname ? `<p:Nome>${this.escapeXml(seller.firstname)}</p:Nome>` : ''}
          ${seller.lastname ? `<p:Cognome>${this.escapeXml(seller.lastname)}</p:Cognome>` : ''}
        </p:Anagrafica>
        <p:AlboProfessionale>
          <p:Albo>CCIAA</p:Albo>
          <p:ProvinciaAlbo>${this.escapeXml(seller.province || '')}</p:ProvinciaAlbo>
          <p:NumeroIscrizione>${this.escapeXml(seller.registrationNumber || '')}</p:NumeroIscrizione>
          <p:DataIscrizione>${this.formatDate(seller.registrationDate || new Date())}</p:DataIscrizione>
        </p:AlboProfessionale>
        <p:Sede>
          ${this.buildIndirizzo(poter)}
          <p:Contatti>
            ${poter.phone ? `<p:Telefono>${this.escapeXml(seller.phone)}</p:Telefono>` : ''}
            ${poter.email ? `<p:Email>${this.escapeXml(seller.email)}</p:Email>` : ''}
          </p:Contatti>
        </p:Sede>
        <p:Rea>
          <p:Ufficio>${this.escapeXml(seller.ufficio || '')}</p:Ufficio>
          <p:NumeroREA>${this.escapeXml(seller.reaNumber || '')}</p:NumeroREA>
          <p:CapitaleSociale>${this.formatAmount(seller.capitale || 0)}</p:CapitaleSociale>
          <p:SocioUnico>${this.escapeXml(seller.socioUnico || '')}</p:SocioUnico>
          <p:StatoLiquidazione>${this.escapeXml(seller.statoLiquidazione || 'LN')}</p:StatoLiquidazione>
        </p:Rea>
      </p:DatiAnagrafici>
      <p:RegimeFiscale>RF01</p:RegimeFiscale>
    </p:CedentePrestatore>
  </p:FatturaElettronicaHeader>
  <p:FatturaElettronicaBody>
    <p:DatiGenerali>
      <p:TipoDocumento>TD01</p:TipoDocumento>
      <p:Divisa>EUR</p:Divisa>
      <p:Data>${this.formatDate(invoice.issueDate || new Date())}</p:Data>
      <p:Numero>${this.escapeXml(invoice.rawNumber || invoice.number || '')}</p:Numero>
      ${invoice.dueDate ? `<p:DataScadenzaPagamento>${this.formatDate(invoice.dueDate)}</p:DataScadenzaPagamento>` : ''}
      <p:ImportoTotaleDocumento>${this.formatAmount(invoice.totals?.total || 0)}</p:ImportoTotaleDocumento>
    </p:DatiGenerali>
    <p:DatiBeniServizi>
      ${this.buildDettaglioLinee(invoice.items, currencyCode)}
      <p:DatiRiepilogo>
        <p:ImponibileImporto>${this.formatAmount(invoice.totals?.subtotal || 0)}</p:ImponibileImporto>
        ${this.buildDatiRiepilogoIVA(invoice.vatBreakdown || [])}
        <p:ImportoTotaleDocumento>${this.formatAmount(invoice.totals?.total || 0)}</p:ImportoTotaleDocumento>
        <p:AliquotaIVA>20</p:AliquotaIVA>
      </p:DatiRiepilogo>
    </p:DatiBeniServizi>
    <p:DatiPagamento>
      <p:CondizioniPagamento>TP01</p:CondizioniPagamento>
      <p:DettaglioPagamento>
        ${invoice.dueDate ? `<p:DataScadenzaPagamento>${this.formatDate(invoice.dueDate)}</p:DataScadenzaPagamento>` : ''}
        <p:ImportoPagamento>${this.formatAmount(invoice.totals?.total || 0)}</p:ImportoPagamento>
      </p:DettaglioPagamento>
    </p:DatiPagamento>
    ${this.buildCessionarioCommittente(buyer)}
  </p:FatturaElettronicaBody>
</p:FatturaElettronica>`;
  }

  /**
   * Build address block
   */
  private buildIndirizzo(party: any): string {
    return `<p:Indirizzo>
      <p:Indirizzo>${this.escapeXml(poter.address || '')}</p:Indirizzo>
      <p:CAP>${this.escapeXml(party.postalCode || '')}</p:CAP>
      <p:Comune>${this.escapeXml(party.city || '')}</p:Comune>
      <p:Provincia>${this.escapeXml(party.province || '')}</p:Provincia>
      <p:Nazione>${this.escapeXml(this.getCountryCode(party.country))}</p:Nazione>
    </p:Indirizzo>`;
  }

  /**
   * Build line items (DettaglioLinee)
   */
  private buildDettaglioLinee(items: any[], currencyCode: string): string {
    return items.map((item, index) => `
    <p:DettaglioLinee>
      <p:NumeroLinea>${index + 1}</p:NumeroLinea>
      <p:Descrizione>${this.escapeXml(item.description)}</p:Descrizione>
      <p:Quantita>${this.formatQuantity(item.quantity)}</p:Quantita>
      <p:UnitaMisura>PCE</p:UnitaMisura>
      <p:DataInizioPeriodo>${this.formatDate(item.startDate || new Date())}</p:DataInizioPeriodo>
      <p:DataFinePeriodo>${this.formatDate(item.endDate || new Date())}</p:DataFinePeriodo>
      <p:PrezzoUnitario>${this.formatAmount(item.unitPrice)}</p:PrezzoUnitario>
      <p:PrezzoTotale>${this.formatAmount(item.lineTotal)}</p:PrezzoTotale>
      <p:AliquotaIVA>${item.vatRate}</p:AliquotaIVA>
      <p:Ritenuta>0.00</p:Ritenuta>
      <p:Natura>3</p:Natura>
      <p:RiferimentoAmministrazione>${this.escapeXml(item.reference || '')}</p:RiferimentoAmministrazione>
    </p:DettaglioLinee>
  `).join('');
  }

  /**
   * Build VAT summary (DatiRiepilogoIVA)
   */
  private buildDatiRiepilogoIVA(breakdown: any[]): string {
    return breakdown.map(vat => `
    <p:DatiRiepilogoIVA>
      <p:AliquotaIVA>${vat.rate}</p:AliquotaIVA>
      <p:ImponibileImporto>${this.formatAmount(vat.taxableAmount)}</p:ImponibileImporto>
      <p:Imposta>${this.formatAmount(vat.vatAmount)}</p:Imposta>
      <p:EsigibilitaIVA>I</p:EsigibilitaIVA>
      <p:RiferimentoNormativo>N3.6</p:RiferimentoNormativo>
    </p:DatiRiepilogoIVA>
  `).join('');
  }

  /**
   * Build buyer (CessionarioCommittente)
   */
  private buildCessionarioCommittente(buyer: any): string {
    if (!buyer || !buyer.identifiers?.piva) return '';
    return `<p:DatiCessionarioCommittente>
      <p:DatiAnagraficiCessionario>
        <p:IdFiscaleIVA>${this.escapeXml(buyer.identifiers.piva)}</p:IdFiscaleIVA>
        <p:CodiceFiscale>${this.escapeXml(buyer.identifiers.codicefiscale || '')}</p:CodiceFiscale>
        <p:Anagrafica>
          <p:Denominazione>${this.escapeXml(buyer.name || '')}</p:Denominazione>
        </p:Anagrafica>
      </p:DatiAnagraficiCessionario>
      ${this.buildIndirizzo(buyer)}
    </p:DatiCessionarioCommittente>`;
  }
}
