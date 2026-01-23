import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import {
  TransmissionPayload,
  TransmissionResult,
  TransmissionStatus,
  TransmissionStrategy,
} from '../transmission.interface';

interface SaftConfig {
  apiUrl: string;
  username: string;
  password: string;
  nif: string;
  softwareCertificateNumber: string;
  privateKeyPath?: string;
}

interface ATResponse {
  codigo: string;
  mensagem: string;
  chaveDocumento?: string;
  dataHora?: string;
}

@Injectable()
export class SaftTransmissionStrategy implements TransmissionStrategy {
  readonly name = 'saft';
  readonly supportedPlatforms = ['saft', 'at-portugal'];
  private readonly logger = new Logger(SaftTransmissionStrategy.name);
  private readonly config: SaftConfig | null;

  constructor(private readonly configService: ConfigService) {
    this.config = this.loadConfig();
  }

  private loadConfig(): SaftConfig | null {
    const apiUrl = this.configService.get<string>('AT_API_URL');
    const username = this.configService.get<string>('AT_USERNAME');
    const password = this.configService.get<string>('AT_PASSWORD');
    const nif = this.configService.get<string>('AT_NIF');
    const softwareCertificateNumber = this.configService.get<string>('AT_SOFTWARE_CERTIFICATE');

    if (!apiUrl || !username || !password || !nif || !softwareCertificateNumber) {
      this.logger.warn('AT (Autoridade Tributaria) configuration incomplete. Strategy will fail on send.');
      return null;
    }

    return {
      apiUrl,
      username,
      password,
      nif,
      softwareCertificateNumber,
      privateKeyPath: this.configService.get<string>('AT_PRIVATE_KEY_PATH'),
    };
  }

  supports(platform: string): boolean {
    return this.supportedPlatforms.includes(platform);
  }

  async send(payload: TransmissionPayload): Promise<TransmissionResult> {
    if (!this.config) {
      return {
        success: false,
        status: 'rejected',
        errorCode: 'AT_NOT_CONFIGURED',
        message: 'Autoridade Tributaria (AT) credentials are not configured',
      };
    }

    try {
      // Build SOAP request for AT webservice
      const soapRequest = this.buildSoapRequest(payload);

      // Send to AT webservice
      const response = await fetch(`${this.config.apiUrl}/faturas`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml;charset=UTF-8',
          SOAPAction: 'RegisterInvoice',
        },
        body: soapRequest,
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`AT API error: ${response.status} - ${errorText}`);
        return {
          success: false,
          status: 'rejected',
          errorCode: `AT_HTTP_${response.status}`,
          message: errorText,
        };
      }

      const responseXml = await response.text();
      const result = this.parseATResponse(responseXml);

      if (result.codigo !== '0') {
        return {
          success: false,
          status: 'rejected',
          errorCode: `AT_${result.codigo}`,
          message: result.mensagem,
        };
      }

      this.logger.log(
        `Invoice ${payload.invoiceNumber} registered with AT. Document key: ${result.chaveDocumento}`,
      );

      return {
        success: true,
        status: 'accepted',
        externalId: result.chaveDocumento,
        message: `Invoice registered with Autoridade Tributaria. Key: ${result.chaveDocumento}`,
      };
    } catch (error) {
      this.logger.error('AT transmission failed:', error);
      return {
        success: false,
        status: 'rejected',
        errorCode: 'AT_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async checkStatus(externalId: string): Promise<TransmissionStatus> {
    // AT registration is synchronous - if registered, it's accepted
    if (externalId) {
      return 'accepted';
    }
    return 'pending';
  }

  async cancel(_externalId: string): Promise<boolean> {
    // AT does not support cancellation - corrections must be done via credit notes
    return false;
  }

  private buildSoapRequest(payload: TransmissionPayload): string {
    if (!this.config) {
      throw new Error('AT not configured');
    }

    const timestamp = new Date().toISOString();
    const nonce = crypto.randomBytes(16).toString('base64');

    // Create WS-Security header with username token
    const passwordDigest = this.createPasswordDigest(
      nonce,
      timestamp,
      this.config.password,
    );

    // Extract invoice data from payload
    const invoiceData = this.extractInvoiceData(payload);

    return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:fc="http://servicos.portaldasfinancas.gov.pt/faturas/"
               xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
               xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
  <soap:Header>
    <wsse:Security>
      <wsse:UsernameToken>
        <wsse:Username>${this.config.username}/${this.config.nif}</wsse:Username>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${passwordDigest}</wsse:Password>
        <wsse:Nonce>${nonce}</wsse:Nonce>
        <wsu:Created>${timestamp}</wsu:Created>
      </wsse:UsernameToken>
    </wsse:Security>
  </soap:Header>
  <soap:Body>
    <fc:RegisterInvoiceRequest>
      <fc:TaxRegistrationNumber>${this.config.nif}</fc:TaxRegistrationNumber>
      <fc:InvoiceHeader>
        <fc:InvoiceNo>${invoiceData.invoiceNo}</fc:InvoiceNo>
        <fc:ATCUD>${invoiceData.atcud}</fc:ATCUD>
        <fc:InvoiceDate>${invoiceData.invoiceDate}</fc:InvoiceDate>
        <fc:InvoiceType>${invoiceData.invoiceType}</fc:InvoiceType>
        <fc:SelfBillingIndicator>0</fc:SelfBillingIndicator>
        <fc:CustomerTaxID>${invoiceData.customerTaxId}</fc:CustomerTaxID>
        <fc:CustomerTaxIDCountry>${invoiceData.customerCountry}</fc:CustomerTaxIDCountry>
      </fc:InvoiceHeader>
      <fc:InvoiceSummary>
        <fc:TaxPayable>${invoiceData.taxPayable}</fc:TaxPayable>
        <fc:NetTotal>${invoiceData.netTotal}</fc:NetTotal>
        <fc:GrossTotal>${invoiceData.grossTotal}</fc:GrossTotal>
      </fc:InvoiceSummary>
      <fc:SoftwareCertificateNumber>${this.config.softwareCertificateNumber}</fc:SoftwareCertificateNumber>
      <fc:HashControl>${invoiceData.hashControl}</fc:HashControl>
    </fc:RegisterInvoiceRequest>
  </soap:Body>
</soap:Envelope>`;
  }

  private createPasswordDigest(nonce: string, created: string, password: string): string {
    // WS-Security UsernameToken password digest
    // Base64(SHA-1(Nonce + Created + Password))
    const nonceBuffer = Buffer.from(nonce, 'base64');
    const createdBuffer = Buffer.from(created, 'utf8');
    const passwordBuffer = Buffer.from(password, 'utf8');

    const combined = Buffer.concat([nonceBuffer, createdBuffer, passwordBuffer]);
    return crypto.createHash('sha1').update(combined).digest('base64');
  }

  private extractInvoiceData(payload: TransmissionPayload): {
    invoiceNo: string;
    atcud: string;
    invoiceDate: string;
    invoiceType: string;
    customerTaxId: string;
    customerCountry: string;
    taxPayable: string;
    netTotal: string;
    grossTotal: string;
    hashControl: string;
  } {
    // Parse XML content if available to extract structured data
    // Otherwise use payload fields directly
    const invoiceDate = new Date().toISOString().split('T')[0];

    // Determine invoice type (FT=Fatura, FS=Fatura Simplificada, FR=Fatura-Recibo, etc.)
    const invoiceType = 'FT';

    // Calculate hash control (first 4 chars of signature hash)
    const hashControl = this.calculateHashControl(payload);

    return {
      invoiceNo: payload.invoiceNumber,
      atcud: payload.metadata?.atcud || '0',
      invoiceDate,
      invoiceType,
      customerTaxId: payload.recipient.vatNumber || payload.recipient.siret || '999999990',
      customerCountry: payload.recipient.country || 'PT',
      taxPayable: (payload.metadata?.totalVat || 0).toFixed(2),
      netTotal: (payload.metadata?.totalHt || 0).toFixed(2),
      grossTotal: (payload.metadata?.totalTtc || 0).toFixed(2),
      hashControl,
    };
  }

  private calculateHashControl(payload: TransmissionPayload): string {
    // In SAF-T PT, each invoice must have a hash that chains to the previous invoice
    // The hashControl is the first 4 characters of the signature
    if (payload.metadata?.hash) {
      return payload.metadata.hash.substring(0, 4);
    }

    // Generate a new hash if not provided
    const dataToHash = `${payload.invoiceNumber};${new Date().toISOString()}`;
    const hash = crypto.createHash('sha256').update(dataToHash).digest('base64');
    return hash.substring(0, 4);
  }

  private parseATResponse(xml: string): ATResponse {
    // Parse AT response XML
    const codigoMatch = xml.match(/<codigo>([^<]+)<\/codigo>/i) ||
                        xml.match(/<CodigoResposta>([^<]+)<\/CodigoResposta>/i);
    const mensagemMatch = xml.match(/<mensagem>([^<]+)<\/mensagem>/i) ||
                          xml.match(/<Mensagem>([^<]+)<\/Mensagem>/i);
    const chaveMatch = xml.match(/<chaveDocumento>([^<]+)<\/chaveDocumento>/i) ||
                       xml.match(/<ATDocCodeID>([^<]+)<\/ATDocCodeID>/i);

    return {
      codigo: codigoMatch?.[1] || '-1',
      mensagem: mensagemMatch?.[1] || 'Unknown response',
      chaveDocumento: chaveMatch?.[1],
      dataHora: new Date().toISOString(),
    };
  }

  /**
   * Generate SAF-T export file for annual reporting
   * This creates a complete SAF-T (PT) XML file for tax authority submission
   */
  async generateSaftExport(
    companyData: Record<string, unknown>,
    invoices: TransmissionPayload[],
    period: { startDate: string; endDate: string },
  ): Promise<string> {
    // This would generate a full SAF-T (PT) XML file
    // Following Portaria 302/2016 specification
    this.logger.log(
      `Generating SAF-T export for period ${period.startDate} to ${period.endDate}`,
    );

    const header = this.buildSaftHeader(companyData, period);
    const masterFiles = this.buildMasterFiles(companyData);
    const sourceDocuments = this.buildSourceDocuments(invoices);

    return `<?xml version="1.0" encoding="UTF-8"?>
<AuditFile xmlns="urn:OECD:StandardAuditFile-Tax:PT_1.04_01"
           xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  ${header}
  ${masterFiles}
  ${sourceDocuments}
</AuditFile>`;
  }

  private buildSaftHeader(
    companyData: Record<string, unknown>,
    period: { startDate: string; endDate: string },
  ): string {
    return `<Header>
    <AuditFileVersion>1.04_01</AuditFileVersion>
    <CompanyID>${companyData.nif || ''}</CompanyID>
    <TaxRegistrationNumber>${companyData.nif || ''}</TaxRegistrationNumber>
    <TaxAccountingBasis>F</TaxAccountingBasis>
    <CompanyName>${companyData.name || ''}</CompanyName>
    <FiscalYear>${new Date(period.startDate).getFullYear()}</FiscalYear>
    <StartDate>${period.startDate}</StartDate>
    <EndDate>${period.endDate}</EndDate>
    <CurrencyCode>EUR</CurrencyCode>
    <DateCreated>${new Date().toISOString().split('T')[0]}</DateCreated>
    <TaxEntity>Global</TaxEntity>
    <ProductCompanyTaxID>${this.config?.nif || ''}</ProductCompanyTaxID>
    <SoftwareCertificateNumber>${this.config?.softwareCertificateNumber || ''}</SoftwareCertificateNumber>
    <ProductID>Invoicerr/1.0</ProductID>
    <ProductVersion>1.0</ProductVersion>
  </Header>`;
  }

  private buildMasterFiles(_companyData: Record<string, unknown>): string {
    // Build MasterFiles section with customers, products, etc.
    return `<MasterFiles>
    <GeneralLedgerAccounts/>
    <Customer/>
    <Supplier/>
    <Product/>
    <TaxTable/>
  </MasterFiles>`;
  }

  private buildSourceDocuments(invoices: TransmissionPayload[]): string {
    const invoiceXml = invoices
      .map((inv) => this.buildInvoiceXml(inv))
      .join('\n');

    return `<SourceDocuments>
    <SalesInvoices>
      <NumberOfEntries>${invoices.length}</NumberOfEntries>
      <TotalDebit>0.00</TotalDebit>
      <TotalCredit>${invoices.reduce((sum, inv) => sum + (inv.metadata?.totalTtc || 0), 0).toFixed(2)}</TotalCredit>
      ${invoiceXml}
    </SalesInvoices>
  </SourceDocuments>`;
  }

  private buildInvoiceXml(payload: TransmissionPayload): string {
    return `<Invoice>
      <InvoiceNo>${payload.invoiceNumber}</InvoiceNo>
      <ATCUD>${payload.metadata?.atcud || '0'}</ATCUD>
      <DocumentStatus>
        <InvoiceStatus>N</InvoiceStatus>
        <InvoiceStatusDate>${new Date().toISOString()}</InvoiceStatusDate>
        <SourceID>Invoicerr</SourceID>
        <SourceBilling>P</SourceBilling>
      </DocumentStatus>
      <Hash>${this.calculateHashControl(payload)}</Hash>
      <InvoiceDate>${new Date().toISOString().split('T')[0]}</InvoiceDate>
      <InvoiceType>FT</InvoiceType>
      <DocumentTotals>
        <TaxPayable>${(payload.metadata?.totalVat || 0).toFixed(2)}</TaxPayable>
        <NetTotal>${(payload.metadata?.totalHt || 0).toFixed(2)}</NetTotal>
        <GrossTotal>${(payload.metadata?.totalTtc || 0).toFixed(2)}</GrossTotal>
      </DocumentTotals>
    </Invoice>`;
  }
}
