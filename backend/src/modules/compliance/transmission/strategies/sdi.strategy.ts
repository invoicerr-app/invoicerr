import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TransmissionPayload,
  TransmissionResult,
  TransmissionStatus,
  TransmissionStrategy,
} from '../transmission.interface';
import { validateSdIPayload } from '../validation';
import { XadesSignatureService } from '../../services/xades-signature.service';

export interface SdIConfig {
  apiUrl: string;
  certificatePath: string;
  privateKeyPath: string;
  password?: string;
}

export interface SdISubmitResponse {
  identificativoSdI: string;
  dataOraRicezione: string;
  nomeFile: string;
}

export interface SdIStatusResponse {
  identificativoSdI: string;
  stato: string;
  dataOraRicezione: string;
  errori?: Array<{
    codice: string;
    descrizione: string;
  }>;
}

@Injectable()
export class SdITransmissionStrategy implements TransmissionStrategy {
  readonly name = 'sdi';
  readonly supportedPlatforms = ['sdi', 'fatturaPA'];
  private readonly logger = new Logger(SdITransmissionStrategy.name);
  private readonly config: SdIConfig | null;

  constructor(
    private readonly configService: ConfigService,
    private readonly xadesSignatureService: XadesSignatureService,
  ) {
    this.config = this.loadConfig();
  }

  private loadConfig(): SdIConfig | null {
    const apiUrl = this.configService.get<string>('SDI_API_URL');
    const certificatePath = this.configService.get<string>('SDI_CERTIFICATE_PATH');
    const privateKeyPath = this.configService.get<string>('SDI_PRIVATE_KEY_PATH');

    if (!apiUrl || !certificatePath || !privateKeyPath) {
      this.logger.warn('SdI configuration incomplete. Strategy will fail on send.');
      return null;
    }

    return {
      apiUrl,
      certificatePath,
      privateKeyPath,
      password: this.configService.get<string>('SDI_CERTIFICATE_PASSWORD'),
    };
  }

  supports(platform: string): boolean {
    return this.supportedPlatforms.includes(platform);
  }

  async send(payload: TransmissionPayload): Promise<TransmissionResult> {
    // Validate payload
    const validation = validateSdIPayload(payload);
    if (!validation.valid) {
      const errorMessages = validation.errors.map((e) => `${e.field}: ${e.message}`).join('; ');
      return {
        success: false,
        status: 'rejected',
        errorCode: 'SDI_VALIDATION_ERROR',
        message: `Validation failed: ${errorMessages}`,
      };
    }

    if (!this.config) {
      return {
        success: false,
        status: 'rejected',
        errorCode: 'SDI_NOT_CONFIGURED',
        message: 'SdI (Sistema di Interscambio) is not configured',
      };
    }

    try {
      // Sign the XML with XAdES signature (xmlContent validated above)
      const signedXml = await this.signFatturaPA(payload.xmlContent!);

      // Prepare the filename (required format: IT<vatNumber>_<progressive>.xml)
      const filename = this.generateFilename(payload);

      // Submit to SdI
      const result = await this.submitToSdI(signedXml, filename);

      this.logger.log(
        `FatturaPA ${payload.invoiceNumber} submitted to SdI. ID: ${result.identificativoSdI}`,
      );

      return {
        success: true,
        status: 'submitted',
        externalId: result.identificativoSdI,
        message: `Invoice submitted to SdI. ID: ${result.identificativoSdI}`,
      };
    } catch (error) {
      this.logger.error('SdI transmission failed:', error);
      return {
        success: false,
        status: 'rejected',
        errorCode: 'SDI_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async checkStatus(externalId: string): Promise<TransmissionStatus> {
    if (!this.config) {
      throw new Error('SdI not configured');
    }

    try {
      // TODO(production): SdI requires client certificate (mTLS) authentication.
      // Configure the fetch agent with:
      // - Client certificate from SDI_CERTIFICATE_PATH
      // - Private key from SDI_PRIVATE_KEY_PATH
      // - Use Node.js https.Agent or undici with TLS options
      const response = await fetch(
        `${this.config.apiUrl}/fatture/stato/${externalId}`,
        {
          method: 'GET',
        },
      );

      if (!response.ok) {
        return 'pending';
      }

      const result: SdIStatusResponse = await response.json();
      return this.mapSdIStatus(result.stato);
    } catch (error) {
      this.logger.error('Failed to check SdI status:', error);
      return 'pending';
    }
  }

  async cancel(_externalId: string): Promise<boolean> {
    // SdI doesn't support cancellation
    // Corrections must be done via credit notes
    return false;
  }

  /**
   * Sign FatturaPA XML with XAdES-BES signature
   */
  private async signFatturaPA(xml: string): Promise<string> {
    if (!this.config) {
      throw new Error('SdI configuration not available for signing');
    }

    const result = await this.xadesSignatureService.signXml(xml, {
      certificatePath: this.config.certificatePath,
      privateKeyPath: this.config.privateKeyPath,
      password: this.config.password,
    });

    if (!result.success || !result.signedXml) {
      throw new Error(`FatturaPA signing failed: ${result.error || 'Unknown error'}`);
    }

    this.logger.log('FatturaPA XML signed with XAdES-BES signature');
    return result.signedXml;
  }

  /**
   * Generate SdI-compliant filename
   * Format: IT<vatNumber>_<progressive>.xml
   */
  private generateFilename(payload: TransmissionPayload): string {
    const vatNumber = payload.sender.vatNumber?.replace(/^IT/, '') || '00000000000';
    const progressive = payload.invoiceNumber.replace(/[^A-Za-z0-9]/g, '').substring(0, 5);
    return `IT${vatNumber}_${progressive}.xml`;
  }

  /**
   * Submit to SdI via SOAP web service
   */
  private async submitToSdI(
    signedXml: string,
    filename: string,
  ): Promise<SdISubmitResponse> {
    if (!this.config) {
      throw new Error('SdI not configured');
    }

    // Build SOAP envelope for SdI
    const soapEnvelope = this.buildSoapEnvelope(signedXml, filename);

    // TODO(production): SdI requires client certificate (mTLS) authentication.
    // Configure the fetch agent with client certificate and private key.
    const response = await fetch(this.config.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml;charset=UTF-8',
        SOAPAction: 'http://www.fatturapa.gov.it/sdi/ws/trasmissione/v1.0/TrasmissioneFatture/RiceviFatture',
      },
      body: soapEnvelope,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`SdI submission failed: ${response.status} - ${errorText}`);
    }

    const responseXml = await response.text();
    return this.parseSdIResponse(responseXml);
  }

  private buildSoapEnvelope(signedXml: string, filename: string): string {
    const base64Xml = Buffer.from(signedXml).toString('base64');

    return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ws="http://www.fatturapa.gov.it/sdi/ws/trasmissione/v1.0/types">
  <soapenv:Header/>
  <soapenv:Body>
    <ws:fileSdI>
      <ws:NomeFile>${filename}</ws:NomeFile>
      <ws:File>${base64Xml}</ws:File>
    </ws:fileSdI>
  </soapenv:Body>
</soapenv:Envelope>`;
  }

  private parseSdIResponse(responseXml: string): SdISubmitResponse {
    // Extract values handling namespaces and CDATA sections
    const identificativoSdI = this.extractXmlValue(responseXml, 'identificativoSdI');
    const dataOraRicezione = this.extractXmlValue(responseXml, 'dataOraRicezione');
    const nomeFile = this.extractXmlValue(responseXml, 'NomeFile');

    // Check for SOAP fault
    const faultString = this.extractXmlValue(responseXml, 'faultstring');
    if (faultString) {
      throw new Error(`SdI SOAP Fault: ${faultString}`);
    }

    // Check for error codes in response
    const errore = this.extractXmlValue(responseXml, 'Errore') ||
                   this.extractXmlValue(responseXml, 'ListaErrori');
    if (errore) {
      throw new Error(`SdI Error: ${errore}`);
    }

    if (!identificativoSdI) {
      // Try alternative element names
      const altId = this.extractXmlValue(responseXml, 'IdSdi') ||
                    this.extractXmlValue(responseXml, 'IdentificativoSdi') ||
                    this.extractXmlValue(responseXml, 'IdFile');
      if (!altId) {
        this.logger.error('SdI response missing identificativoSdI:', responseXml.substring(0, 500));
        throw new Error('Failed to parse SdI response: missing identificativoSdI');
      }
      return {
        identificativoSdI: altId,
        dataOraRicezione: dataOraRicezione || new Date().toISOString(),
        nomeFile: nomeFile || '',
      };
    }

    return {
      identificativoSdI,
      dataOraRicezione: dataOraRicezione || new Date().toISOString(),
      nomeFile: nomeFile || '',
    };
  }

  /**
   * Extract XML element value handling namespaces, CDATA, and whitespace
   */
  private extractXmlValue(xml: string, elementName: string): string | null {
    // Handle both with and without namespace prefixes
    // Match: <ns:elementName>, <elementName>, or CDATA content
    const patterns = [
      // With namespace prefix
      new RegExp(`<[a-zA-Z0-9_-]*:${elementName}[^>]*><!\\[CDATA\\[([^\\]]+)\\]\\]><\\/[a-zA-Z0-9_-]*:${elementName}>`, 'i'),
      new RegExp(`<[a-zA-Z0-9_-]*:${elementName}[^>]*>([^<]*)<\\/[a-zA-Z0-9_-]*:${elementName}>`, 'i'),
      // Without namespace prefix
      new RegExp(`<${elementName}[^>]*><!\\[CDATA\\[([^\\]]+)\\]\\]><\\/${elementName}>`, 'i'),
      new RegExp(`<${elementName}[^>]*>([^<]*)<\\/${elementName}>`, 'i'),
      // Self-closing with value attribute
      new RegExp(`<[a-zA-Z0-9_-]*:?${elementName}[^>]*value="([^"]*)"[^>]*\\/>`, 'i'),
    ];

    for (const pattern of patterns) {
      const match = xml.match(pattern);
      if (match && match[1]) {
        return this.decodeXmlEntities(match[1].trim());
      }
    }

    return null;
  }

  /**
   * Decode XML entities to plain text
   */
  private decodeXmlEntities(text: string): string {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }

  private mapSdIStatus(sdIStatus: string): TransmissionStatus {
    // SdI statuses
    const statusMap: Record<string, TransmissionStatus> = {
      // Invoice received by SdI
      RC: 'submitted', // Ricevuta di consegna
      // Invoice delivered to recipient
      MC: 'delivered', // Mancata consegna (failed delivery, but submitted)
      DT: 'delivered', // Decorrenza termini (time expired, considered accepted)
      // Invoice accepted/rejected by recipient
      NE: 'accepted', // Notifica esito cedente/prestatore (accepted)
      AT: 'accepted', // Attestazione trasmissione fattura con impossibilità di recapito
      EC: 'rejected', // Esito cedente/cessionario (rejection notification)
      // Errors
      NS: 'rejected', // Notifica di scarto (rejected by SdI)
      SE: 'rejected', // Scarto esito (error in response)
    };

    return statusMap[sdIStatus.toUpperCase()] || 'pending';
  }
}
