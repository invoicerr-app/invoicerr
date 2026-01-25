import { Injectable } from '@nestjs/common';
import { FormatConfig } from '../../interfaces/format.interface';
import { FormatResult, InvoiceData } from '../format.interface';
import { BaseFormatGenerator } from './base.generator';

/**
 * KSeF FA(3) Generator
 * Polish e-invoice format for KSeF (Krajowy System e-Faktur)
 *
 * Based on FA(3) schema from Polish Ministry of Finance
 * https://www.podatki.gov.pl/ksef/
 *
 * Document Types:
 * - VAT: Standard VAT invoice
 * - KOR: Correcting invoice
 * - ZAL: Advance payment invoice
 * - ROZ: Settlement invoice
 *
 * Required for B2B invoices in Poland from July 2024
 */
@Injectable()
export class KSeFFA3Generator extends BaseFormatGenerator {
  readonly name = 'ksef-fa3';
  readonly supportedFormats = ['ksef', 'ksef-fa3', 'fa3'];

  // KSeF FA(3) namespace
  private readonly NS_FA =
    'http://crd.gov.pl/wzor/2023/06/29/12648/';

  supports(format: string): boolean {
    return this.supportedFormats.includes(format.toLowerCase());
  }

  async generate(invoice: InvoiceData, config: FormatConfig): Promise<FormatResult> {
    try {
      const xml = this.buildFaktura(invoice);
      return {
        success: true,
        xml: this.wrapWithDeclaration(xml),
        format: 'ksef-fa3',
        syntax: 'KSeF',
        version: 'FA(3)',
      };
    } catch (error) {
      this.logger.error('KSeF FA(3) generation failed:', error);
      return {
        success: false,
        format: 'ksef-fa3',
        syntax: 'KSeF',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private buildFaktura(invoice: InvoiceData): string {
    return `<Faktura xmlns="${this.NS_FA}"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  ${this.buildNaglowek(invoice)}
  ${this.buildPodmiot1(invoice.supplier)}
  ${this.buildPodmiot2(invoice.customer)}
  ${this.buildFa(invoice)}
</Faktura>`;
  }

  /**
   * Build header section (Naglowek)
   */
  private buildNaglowek(invoice: InvoiceData): string {
    return `<Naglowek>
    <KodFormularza kodSystemowy="FA (3)" wersjaSchemy="1-0E">FA</KodFormularza>
    <WariantFormularza>3</WariantFormularza>
    <DataWytworzeniaFa>${this.formatDateTime(new Date())}</DataWytworzeniaFa>
    <SystemInfo>Invoicerr</SystemInfo>
  </Naglowek>`;
  }

  /**
   * Build seller section (Podmiot1 - Sprzedawca)
   */
  private buildPodmiot1(supplier: InvoiceData['supplier']): string {
    const nip = this.extractNIP(supplier.vatNumber || supplier.legalId || '');

    return `<Podmiot1>
    <DaneIdentyfikacyjne>
      <NIP>${this.escapeXml(nip)}</NIP>
      <Nazwa>${this.escapeXml(supplier.name)}</Nazwa>
    </DaneIdentyfikacyjne>
    <Adres>
      <KodKraju>${this.getCountryCode(supplier.country)}</KodKraju>
      <AdresL1>${this.escapeXml(supplier.address)}</AdresL1>
      <AdresL2>${this.escapeXml(supplier.postalCode)} ${this.escapeXml(supplier.city)}</AdresL2>
    </Adres>
    ${supplier.email ? `<DaneKontaktowe><Email>${this.escapeXml(supplier.email)}</Email></DaneKontaktowe>` : ''}
  </Podmiot1>`;
  }

  /**
   * Build buyer section (Podmiot2 - Nabywca)
   */
  private buildPodmiot2(customer: InvoiceData['customer']): string {
    const nip = this.extractNIP(customer.vatNumber || customer.legalId || '');
    const countryCode = this.getCountryCode(customer.country);
    const isPolish = countryCode === 'PL';

    return `<Podmiot2>
    <DaneIdentyfikacyjne>
      ${isPolish && nip ? `<NIP>${this.escapeXml(nip)}</NIP>` : ''}
      ${!isPolish && customer.vatNumber ? `<KodUE>${this.escapeXml(customer.vatNumber)}</KodUE>` : ''}
      <Nazwa>${this.escapeXml(customer.name)}</Nazwa>
    </DaneIdentyfikacyjne>
    <Adres>
      <KodKraju>${countryCode}</KodKraju>
      <AdresL1>${this.escapeXml(customer.address)}</AdresL1>
      <AdresL2>${this.escapeXml(customer.postalCode)} ${this.escapeXml(customer.city)}</AdresL2>
    </Adres>
    ${customer.email ? `<DaneKontaktowe><Email>${this.escapeXml(customer.email)}</Email></DaneKontaktowe>` : ''}
  </Podmiot2>`;
  }

  /**
   * Build invoice body section (Fa)
   */
  private buildFa(invoice: InvoiceData): string {
    const vatBreakdown = this.calculateVatBreakdown(invoice.items);

    return `<Fa>
    ${this.buildDaneOgolne(invoice)}
    ${invoice.items.map((item, idx) => this.buildFaWiersz(item, idx + 1)).join('\n    ')}
    ${this.buildPodsumowanie(invoice, vatBreakdown)}
    ${this.buildPlatnosc(invoice)}
  </Fa>`;
  }

  /**
   * Build general invoice data (DaneOgolne section within Fa)
   */
  private buildDaneOgolne(invoice: InvoiceData): string {
    // P_1 = Invoice type: VAT, KOR (correcting), ZAL (advance), ROZ (settlement)
    const rodzajFaktury = 'VAT';

    return `<KodWaluty>${invoice.currency}</KodWaluty>
    <P_1>${this.formatDate(invoice.issueDate)}</P_1>
    <P_2>${this.escapeXml(invoice.number)}</P_2>
    <RodzajFaktury>${rodzajFaktury}</RodzajFaktury>
    ${invoice.purchaseOrderReference ? `<DodatkowyOpis><Klucz>PO</Klucz><Wartosc>${this.escapeXml(invoice.purchaseOrderReference)}</Wartosc></DodatkowyOpis>` : ''}`;
  }

  /**
   * Build line item (FaWiersz)
   */
  private buildFaWiersz(item: InvoiceData['items'][0], lineNumber: number): string {
    const unitCode = item.unitCode || this.getPolishUnitCode(item.itemType);

    return `<FaWiersz>
      <NrWierszaFa>${lineNumber}</NrWierszaFa>
      <P_7>${this.escapeXml(item.description)}</P_7>
      <P_8A>${unitCode}</P_8A>
      <P_8B>${this.formatQuantity(item.quantity)}</P_8B>
      <P_9A>${this.formatAmount(item.unitPrice)}</P_9A>
      <P_11>${this.formatAmount(item.lineTotal)}</P_11>
      <P_12>${this.formatVatRate(item.vatRate)}</P_12>
    </FaWiersz>`;
  }

  /**
   * Build summary section (Podsumowanie within Fa)
   */
  private buildPodsumowanie(
    invoice: InvoiceData,
    vatBreakdown: Array<{ rate: number; taxableAmount: number; taxAmount: number }>,
  ): string {
    // Build VAT summary by rate
    const vatSummary = vatBreakdown.map((vat) => this.buildPodatekVat(vat)).join('\n    ');

    return `<P_13_1>${this.formatAmount(invoice.totalHT)}</P_13_1>
    <P_14_1>${this.formatAmount(invoice.totalVAT)}</P_14_1>
    ${vatSummary}
    <P_15>${this.formatAmount(invoice.totalTTC)}</P_15>`;
  }

  /**
   * Build VAT breakdown entry
   */
  private buildPodatekVat(vat: {
    rate: number;
    taxableAmount: number;
    taxAmount: number;
  }): string {
    const rateCode = this.getVatRateCode(vat.rate);

    // Standard rates use P_13_X and P_14_X where X is rate position
    // 23% = P_13_1/P_14_1, 8% = P_13_2/P_14_2, 5% = P_13_3/P_14_3, 0% = P_13_6/P_14_6
    return `<P_13_${rateCode}>${this.formatAmount(vat.taxableAmount)}</P_13_${rateCode}>
    <P_14_${rateCode}>${this.formatAmount(vat.taxAmount)}</P_14_${rateCode}>`;
  }

  /**
   * Build payment section (Platnosc)
   */
  private buildPlatnosc(invoice: InvoiceData): string {
    // FormaPlatnosci: 1=gotowka, 2=karta, 6=przelew
    const formaPlatnosci = this.getPaymentMethodCode(invoice.paymentMethod);

    return `<Platnosc>
      <TerminPlatnosci>
        <Termin>${this.formatDate(invoice.dueDate)}</Termin>
      </TerminPlatnosci>
      <FormaPlatnosci>${formaPlatnosci}</FormaPlatnosci>
    </Platnosc>
    ${invoice.notes ? `<Adnotacje><P_16>2</P_16><P_17>2</P_17><P_18>2</P_18><P_18A>2</P_18A><Zwolnienie><P_19N>1</P_19N></Zwolnienie></Adnotacje>` : ''}`;
  }

  /**
   * Extract Polish NIP from VAT number
   */
  private extractNIP(vatNumber: string): string {
    // Remove PL prefix and any non-digit characters
    return vatNumber.replace(/^PL/i, '').replace(/\D/g, '');
  }

  /**
   * Get Polish unit code
   */
  private getPolishUnitCode(itemType?: 'goods' | 'services'): string {
    // Polish codes: szt. (piece), godz. (hour), usł. (service), kg, m, etc.
    return itemType === 'services' ? 'usł.' : 'szt.';
  }

  /**
   * Format VAT rate for KSeF
   * Returns rate as integer (23, 8, 5, 0) or special codes (zw, np, oo)
   */
  private formatVatRate(rate: number): string {
    if (rate === 0) return '0';
    return rate.toFixed(0);
  }

  /**
   * Get VAT rate code position for P_13_X/P_14_X fields
   */
  private getVatRateCode(rate: number): string {
    // Polish VAT rates and their field positions:
    // 23% -> 1, 8% -> 2, 5% -> 3, 0% -> 6
    // Exempt (zw) -> 7, Reverse charge -> 8
    if (rate === 23) return '1';
    if (rate === 22) return '1'; // Legacy rate
    if (rate === 8) return '2';
    if (rate === 7) return '2'; // Legacy rate
    if (rate === 5) return '3';
    if (rate === 0) return '6';
    return '1'; // Default to standard rate
  }

  /**
   * Get payment method code for KSeF
   */
  private getPaymentMethodCode(paymentMethod?: string): string {
    const methodMap: Record<string, string> = {
      cash: '1',
      card: '2',
      transfer: '6',
      bank_transfer: '6',
      wire: '6',
      check: '3',
      compensation: '4',
    };
    return methodMap[paymentMethod?.toLowerCase() || ''] || '6'; // Default: transfer
  }
}
