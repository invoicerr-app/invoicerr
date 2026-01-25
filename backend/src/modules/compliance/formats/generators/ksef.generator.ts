import { Injectable } from '@nestjs/common';
import { FormatConfig } from '../../interfaces/format.interface';
import { FormatResult, InvoiceData, InvoiceLineItem } from '../format.interface';
import { BaseFormatGenerator } from './base.generator';

/**
 * KSeF FA Generator
 * Polish e-invoice format for KSeF (Krajowy System e-Faktur)
 *
 * Based on FA(2) schema - the official Polish e-invoice structure
 * Required for all B2B/B2G invoices in Poland from July 2026
 *
 * Key features:
 * - NIP-based identification
 * - PLN as primary currency (foreign currencies allowed with conversion)
 * - Polish VAT rates: 23%, 8%, 5%, 0%
 * - Strict schema validation by KSeF system
 */
@Injectable()
export class KSeFGenerator extends BaseFormatGenerator {
  readonly name = 'ksef';
  readonly supportedFormats = ['ksef', 'fa'];

  // KSeF FA namespace
  private readonly NS_FA = 'http://crd.gov.pl/wzor/2023/06/29/12648/';

  supports(format: string): boolean {
    return this.supportedFormats.includes(format.toLowerCase());
  }

  async generate(invoice: InvoiceData, _config: FormatConfig): Promise<FormatResult> {
    try {
      const xml = this.buildFA(invoice);
      return {
        success: true,
        xml: this.wrapWithDeclaration(xml),
        format: 'ksef',
        syntax: 'FA(2)',
        version: '2',
      };
    } catch (error) {
      this.logger.error('KSeF FA generation failed:', error);
      return {
        success: false,
        format: 'ksef',
        syntax: 'FA(2)',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private buildFA(invoice: InvoiceData): string {
    return `<Faktura xmlns="${this.NS_FA}">
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
    // KodFormularza: FA(2) for standard invoice
    // WariantFormularza: 2
    // DataWytworzeniaFa: document creation timestamp
    // SystemInfo: software identification

    return `<Naglowek>
    <KodFormularza kodSystemowy="FA (2)" wersjaSchemy="1-0E">FA</KodFormularza>
    <WariantFormularza>2</WariantFormularza>
    <DataWytworzeniaFa>${this.formatDateTime(new Date())}</DataWytworzeniaFa>
    <SystemInfo>Invoicerr 1.0</SystemInfo>
  </Naglowek>`;
  }

  /**
   * Build supplier section (Podmiot1 - Sprzedawca)
   */
  private buildPodmiot1(supplier: InvoiceData['supplier']): string {
    const nip = this.extractNIP(supplier.vatNumber || '');

    return `<Podmiot1>
    <DaneIdentyfikacyjne>
      <NIP>${this.escapeXml(nip)}</NIP>
      <Nazwa>${this.escapeXml(supplier.name)}</Nazwa>
    </DaneIdentyfikacyjne>
    <Adres>
      <KodKraju>PL</KodKraju>
      <AdresL1>${this.escapeXml(supplier.address)}</AdresL1>
      <AdresL2>${this.escapeXml(supplier.postalCode)} ${this.escapeXml(supplier.city)}</AdresL2>
    </Adres>
    ${supplier.email ? `<Email>${this.escapeXml(supplier.email)}</Email>` : ''}
    ${supplier.phone ? `<Telefon>${this.escapeXml(supplier.phone)}</Telefon>` : ''}
  </Podmiot1>`;
  }

  /**
   * Build customer section (Podmiot2 - Nabywca)
   */
  private buildPodmiot2(customer: InvoiceData['customer']): string {
    const countryCode = this.getCountryCode(customer.country);
    const isPolish = countryCode === 'PL';

    // For Polish customers, use NIP; for foreign, use full VAT number
    const identyfikator = isPolish
      ? `<NIP>${this.escapeXml(this.extractNIP(customer.vatNumber || ''))}</NIP>`
      : customer.vatNumber
        ? `<NrVatUE>${this.escapeXml(customer.vatNumber)}</NrVatUE>`
        : '';

    return `<Podmiot2>
    <DaneIdentyfikacyjne>
      ${identyfikator}
      <Nazwa>${this.escapeXml(customer.name)}</Nazwa>
    </DaneIdentyfikacyjne>
    <Adres>
      <KodKraju>${countryCode}</KodKraju>
      <AdresL1>${this.escapeXml(customer.address)}</AdresL1>
      <AdresL2>${this.escapeXml(customer.postalCode)} ${this.escapeXml(customer.city)}</AdresL2>
    </Adres>
    ${customer.email ? `<Email>${this.escapeXml(customer.email)}</Email>` : ''}
  </Podmiot2>`;
  }

  /**
   * Build main invoice data section (Fa)
   */
  private buildFa(invoice: InvoiceData): string {
    const vatBreakdown = this.calculateVatBreakdown(invoice.items);

    return `<Fa>
    <KodWaluty>${invoice.currency}</KodWaluty>
    <P_1>${this.formatDate(invoice.issueDate)}</P_1>
    <P_2>${this.escapeXml(invoice.number)}</P_2>
    ${this.buildDatySection(invoice)}
    ${invoice.items.map((item, idx) => this.buildFaWiersz(item, idx + 1)).join('\n    ')}
    ${this.buildRozliczenieSection(invoice, vatBreakdown)}
    ${this.buildPlatnoscSection(invoice)}
    ${invoice.notes ? `<Uwagi>${this.escapeXml(invoice.notes)}</Uwagi>` : ''}
  </Fa>`;
  }

  /**
   * Build dates section
   */
  private buildDatySection(invoice: InvoiceData): string {
    // P_6 = date of sale/service (defaults to issue date)
    return `<P_6>${this.formatDate(invoice.issueDate)}</P_6>`;
  }

  /**
   * Build line item (FaWiersz)
   */
  private buildFaWiersz(item: InvoiceLineItem, lineNumber: number): string {
    // P_7 - description
    // P_8A - unit code (optional)
    // P_8B - quantity
    // P_9A - unit price net
    // P_11 - net amount
    // P_12 - VAT rate

    const vatRateCode = this.getPolishVatRateCode(item.vatRate);

    return `<FaWiersz>
      <NrWierszaFa>${lineNumber}</NrWierszaFa>
      <P_7>${this.escapeXml(item.description)}</P_7>
      ${item.unitCode ? `<P_8A>${item.unitCode}</P_8A>` : ''}
      <P_8B>${this.formatQuantity(item.quantity)}</P_8B>
      <P_9A>${this.formatAmount(item.unitPrice)}</P_9A>
      <P_11>${this.formatAmount(item.lineTotal)}</P_11>
      <P_12>${vatRateCode}</P_12>
    </FaWiersz>`;
  }

  /**
   * Build settlement section (Rozliczenie)
   */
  private buildRozliczenieSection(
    invoice: InvoiceData,
    vatBreakdown: Array<{ rate: number; taxableAmount: number; taxAmount: number }>,
  ): string {
    // Build VAT breakdown by rate
    const vatSummary = vatBreakdown
      .map((vat) => this.buildVatRow(vat))
      .join('\n      ');

    return `<Rozliczenie>
      ${vatSummary}
      <P_13_1>${this.formatAmount(invoice.totalHT)}</P_13_1>
      <P_14_1>${this.formatAmount(invoice.totalVAT)}</P_14_1>
      <P_15>${this.formatAmount(invoice.totalTTC)}</P_15>
    </Rozliczenie>`;
  }

  /**
   * Build VAT summary row for a specific rate
   */
  private buildVatRow(vat: { rate: number; taxableAmount: number; taxAmount: number }): string {
    // Field naming follows Polish VAT rate structure:
    // P_13_x - net amount by VAT rate
    // P_14_x - VAT amount by VAT rate
    // x = 1 (23%), 2 (8%), 3 (5%), 4 (0%)

    const rateIndex = this.getPolishVatRateIndex(vat.rate);
    const netField = `P_13_${rateIndex}`;
    const vatField = `P_14_${rateIndex}`;

    return `<${netField}>${this.formatAmount(vat.taxableAmount)}</${netField}>
      <${vatField}>${this.formatAmount(vat.taxAmount)}</${vatField}>`;
  }

  /**
   * Build payment section (Platnosc)
   */
  private buildPlatnoscSection(invoice: InvoiceData): string {
    // TerminPlatnosci - payment due date
    // FormaPlatnosci - payment method (1=cash, 2=transfer, 3=card, etc.)
    const paymentMethod = this.mapPaymentMethod(invoice.paymentMethod);

    return `<Platnosc>
      <TerminPlatnosci>
        <Termin>${this.formatDate(invoice.dueDate)}</Termin>
      </TerminPlatnosci>
      <FormaPlatnosci>${paymentMethod}</FormaPlatnosci>
    </Platnosc>`;
  }

  /**
   * Extract NIP from VAT number
   * PL1234567890 -> 1234567890
   */
  private extractNIP(vatNumber: string): string {
    // Remove PL prefix and any formatting
    return vatNumber.replace(/^PL/i, '').replace(/[-\s]/g, '');
  }

  /**
   * Get Polish VAT rate code for FA schema
   * 23% -> "23", 8% -> "8", 5% -> "5", 0% -> "0"
   * Special: "zw" (exempt), "np" (not subject), "oo" (reverse charge)
   */
  private getPolishVatRateCode(rate: number): string {
    if (rate === 23) return '23';
    if (rate === 8) return '8';
    if (rate === 5) return '5';
    if (rate === 0) return '0';
    // For other rates, return as string
    return rate.toString();
  }

  /**
   * Get Polish VAT rate index for summary fields
   * 23% -> 1, 8% -> 2, 5% -> 3, 0% -> 4
   */
  private getPolishVatRateIndex(rate: number): number {
    if (rate === 23) return 1;
    if (rate === 8) return 2;
    if (rate === 5) return 3;
    return 4; // 0% or exempt
  }

  /**
   * Map payment method to Polish code
   */
  private mapPaymentMethod(method?: string): string {
    const methodMap: Record<string, string> = {
      cash: '1',
      transfer: '2',
      bank_transfer: '2',
      card: '3',
      credit_card: '3',
      cheque: '4',
      compensation: '5',
      other: '6',
    };

    if (!method) return '2'; // Default to bank transfer
    return methodMap[method.toLowerCase()] || '6';
  }

  /**
   * Validate NIP checksum
   */
  validateNIP(nip: string): boolean {
    const cleanNip = nip.replace(/[-\s]/g, '');
    if (!/^[0-9]{10}$/.test(cleanNip)) {
      return false;
    }

    const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      sum += parseInt(cleanNip[i], 10) * weights[i];
    }

    const checkDigit = sum % 11;
    return checkDigit === parseInt(cleanNip[9], 10);
  }
}
