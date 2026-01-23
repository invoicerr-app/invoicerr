import { Injectable } from '@nestjs/common';
import { FormatConfig } from '../../interfaces/format.interface';
import { FormatResult, InvoiceData } from '../format.interface';
import { BaseFormatGenerator } from './base.generator';

/**
 * FatturaPA Generator
 * Italian e-invoice format for SdI (Sistema di Interscambio)
 *
 * Document Types:
 * - TD01: Invoice
 * - TD02: Advance invoice
 * - TD04: Credit note
 * - TD24: Deferred invoice
 *
 * Required for all B2B/B2G invoices in Italy
 */
@Injectable()
export class FatturaPAGenerator extends BaseFormatGenerator {
  readonly name = 'fatturapa';
  readonly supportedFormats = ['fatturapa', 'sdi'];

  // FatturaPA namespace
  private readonly NS_P =
    'http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2';

  supports(format: string): boolean {
    return this.supportedFormats.includes(format.toLowerCase());
  }

  async generate(invoice: InvoiceData, config: FormatConfig): Promise<FormatResult> {
    try {
      const xml = this.buildFatturaPA(invoice);
      return {
        success: true,
        xml: this.wrapWithDeclaration(xml),
        format: 'fatturapa',
        syntax: 'FatturaPA',
        version: '1.2.2',
      };
    } catch (error) {
      this.logger.error('FatturaPA generation failed:', error);
      return {
        success: false,
        format: 'fatturapa',
        syntax: 'FatturaPA',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private buildFatturaPA(invoice: InvoiceData): string {
    // Progressive number for this transmission (should be tracked externally)
    const progressivoInvio = this.generateProgressivoInvio();

    return `<p:FatturaElettronica xmlns:p="${this.NS_P}" versione="FPR12">
  ${this.buildFatturaElettronicaHeader(invoice, progressivoInvio)}
  ${this.buildFatturaElettronicaBody(invoice)}
</p:FatturaElettronica>`;
  }

  private generateProgressivoInvio(): string {
    // Should be unique per transmission - using timestamp + random for now
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 5).toUpperCase();
    return `${timestamp}${random}`.substring(0, 10);
  }

  private buildFatturaElettronicaHeader(invoice: InvoiceData, progressivoInvio: string): string {
    const supplierCountry = this.getCountryCode(invoice.supplier.country);
    const supplierVat = this.extractVatNumber(invoice.supplier.vatNumber || '');

    return `<FatturaElettronicaHeader>
    <DatiTrasmissione>
      <IdTrasmittente>
        <IdPaese>${supplierCountry}</IdPaese>
        <IdCodice>${this.escapeXml(supplierVat)}</IdCodice>
      </IdTrasmittente>
      <ProgressivoInvio>${progressivoInvio}</ProgressivoInvio>
      <FormatoTrasmissione>FPR12</FormatoTrasmissione>
      <CodiceDestinatario>${this.getCodiceDestinatario(invoice.customer)}</CodiceDestinatario>
      ${invoice.customer.email && !invoice.customer.routingCode ? `<PECDestinatario>${this.escapeXml(invoice.customer.email)}</PECDestinatario>` : ''}
    </DatiTrasmissione>
    ${this.buildCedentePrestatore(invoice.supplier)}
    ${this.buildCessionarioCommittente(invoice.customer)}
  </FatturaElettronicaHeader>`;
  }

  private extractVatNumber(vatNumber: string): string {
    // Remove country prefix if present (IT12345678901 -> 12345678901)
    return vatNumber.replace(/^[A-Z]{2}/i, '');
  }

  private getCodiceDestinatario(customer: InvoiceData['customer']): string {
    // Use routing code if provided, otherwise default to 0000000 (7 zeros)
    // which indicates the invoice should be sent via PEC
    if (customer.routingCode) {
      return customer.routingCode.padEnd(7, '0').substring(0, 7);
    }
    return '0000000';
  }

  private buildCedentePrestatore(supplier: InvoiceData['supplier']): string {
    const countryCode = this.getCountryCode(supplier.country);
    const vatNumber = this.extractVatNumber(supplier.vatNumber || '');

    return `<CedentePrestatore>
      <DatiAnagrafici>
        <IdFiscaleIVA>
          <IdPaese>${countryCode}</IdPaese>
          <IdCodice>${this.escapeXml(vatNumber)}</IdCodice>
        </IdFiscaleIVA>
        ${supplier.legalId ? `<CodiceFiscale>${this.escapeXml(supplier.legalId)}</CodiceFiscale>` : ''}
        <Anagrafica>
          <Denominazione>${this.escapeXml(supplier.name)}</Denominazione>
        </Anagrafica>
        <RegimeFiscale>RF01</RegimeFiscale>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>${this.escapeXml(supplier.address)}</Indirizzo>
        <CAP>${this.escapeXml(supplier.postalCode)}</CAP>
        <Comune>${this.escapeXml(supplier.city)}</Comune>
        <Nazione>${countryCode}</Nazione>
      </Sede>
    </CedentePrestatore>`;
  }

  private buildCessionarioCommittente(customer: InvoiceData['customer']): string {
    const countryCode = this.getCountryCode(customer.country);
    const vatNumber = this.extractVatNumber(customer.vatNumber || '');

    return `<CessionarioCommittente>
      <DatiAnagrafici>
        ${customer.vatNumber ? `<IdFiscaleIVA>
          <IdPaese>${countryCode}</IdPaese>
          <IdCodice>${this.escapeXml(vatNumber)}</IdCodice>
        </IdFiscaleIVA>` : ''}
        ${customer.legalId ? `<CodiceFiscale>${this.escapeXml(customer.legalId)}</CodiceFiscale>` : ''}
        <Anagrafica>
          <Denominazione>${this.escapeXml(customer.name)}</Denominazione>
        </Anagrafica>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>${this.escapeXml(customer.address)}</Indirizzo>
        <CAP>${this.escapeXml(customer.postalCode)}</CAP>
        <Comune>${this.escapeXml(customer.city)}</Comune>
        <Nazione>${countryCode}</Nazione>
      </Sede>
    </CessionarioCommittente>`;
  }

  private buildFatturaElettronicaBody(invoice: InvoiceData): string {
    return `<FatturaElettronicaBody>
    ${this.buildDatiGenerali(invoice)}
    ${this.buildDatiBeniServizi(invoice)}
    ${this.buildDatiPagamento(invoice)}
  </FatturaElettronicaBody>`;
  }

  private buildDatiGenerali(invoice: InvoiceData): string {
    // TD01 = Invoice, TD04 = Credit Note
    const tipoDocumento = 'TD01';

    return `<DatiGenerali>
      <DatiGeneraliDocumento>
        <TipoDocumento>${tipoDocumento}</TipoDocumento>
        <Divisa>${invoice.currency}</Divisa>
        <Data>${this.formatDate(invoice.issueDate)}</Data>
        <Numero>${this.escapeXml(invoice.number)}</Numero>
        <ImportoTotaleDocumento>${this.formatAmount(invoice.totalTTC)}</ImportoTotaleDocumento>
        ${invoice.notes ? `<Causale>${this.escapeXml(invoice.notes.substring(0, 200))}</Causale>` : ''}
      </DatiGeneraliDocumento>
    </DatiGenerali>`;
  }

  private buildDatiBeniServizi(invoice: InvoiceData): string {
    const vatBreakdown = this.calculateVatBreakdown(invoice.items);

    return `<DatiBeniServizi>
      ${invoice.items.map((item, idx) => this.buildDettaglioLinee(item, idx + 1)).join('\n      ')}
      ${vatBreakdown.map((vat) => this.buildDatiRiepilogo(vat)).join('\n      ')}
    </DatiBeniServizi>`;
  }

  private buildDettaglioLinee(item: InvoiceData['items'][0], lineNumber: number): string {
    return `<DettaglioLinee>
        <NumeroLinea>${lineNumber}</NumeroLinea>
        <Descrizione>${this.escapeXml(item.description)}</Descrizione>
        <Quantita>${this.formatQuantity(item.quantity)}</Quantita>
        <PrezzoUnitario>${this.formatAmount(item.unitPrice)}</PrezzoUnitario>
        <PrezzoTotale>${this.formatAmount(item.lineTotal)}</PrezzoTotale>
        <AliquotaIVA>${this.formatAmount(item.vatRate)}</AliquotaIVA>
      </DettaglioLinee>`;
  }

  private buildDatiRiepilogo(vat: {
    rate: number;
    taxableAmount: number;
    taxAmount: number;
  }): string {
    // N1-N7 are exemption codes, empty for standard rated
    const natura = vat.rate === 0 ? 'N4' : ''; // N4 = Export

    return `<DatiRiepilogo>
        <AliquotaIVA>${this.formatAmount(vat.rate)}</AliquotaIVA>
        ${natura ? `<Natura>${natura}</Natura>` : ''}
        <ImponibileImporto>${this.formatAmount(vat.taxableAmount)}</ImponibileImporto>
        <Imposta>${this.formatAmount(vat.taxAmount)}</Imposta>
        <EsigibilitaIVA>I</EsigibilitaIVA>
      </DatiRiepilogo>`;
  }

  private buildDatiPagamento(invoice: InvoiceData): string {
    // TP02 = Complete payment
    // MP05 = Bank transfer (bonifico)
    return `<DatiPagamento>
      <CondizioniPagamento>TP02</CondizioniPagamento>
      <DettaglioPagamento>
        <ModalitaPagamento>MP05</ModalitaPagamento>
        <DataScadenzaPagamento>${this.formatDate(invoice.dueDate)}</DataScadenzaPagamento>
        <ImportoPagamento>${this.formatAmount(invoice.totalTTC)}</ImportoPagamento>
      </DettaglioPagamento>
    </DatiPagamento>`;
  }
}
