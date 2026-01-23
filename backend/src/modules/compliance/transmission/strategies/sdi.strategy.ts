import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TransmissionPayload,
  TransmissionResult,
  TransmissionStatus,
  TransmissionStrategy,
} from '../transmission.interface';
import { XadesSignatureService } from '../../services/xades-signature.service';

interface SdIConfig {
  apiUrl: string;
  certificatePath: string;
  privateKeyPath: string;
  password?: string;
}

interface SdISubmitResponse {
  identificativoSdI: string;
  dataOraRicezione: string;
  nomeFile: string;
}

interface SdIStatusResponse {
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
    if (!this.config) {
      return {
        success: false,
        status: 'rejected',
        errorCode: 'SDI_NOT_CONFIGURED',
        message: 'SdI (Sistema di Interscambio) is not configured',
      };
    }

    // SdI requires FatturaPA XML format
    if (!payload.xmlContent) {
      return {
        success: false,
        status: 'rejected',
        errorCode: 'SDI_NO_XML',
        message: 'SdI transmission requires FatturaPA XML content',
      };
    }

    // Validate recipient has Codice Destinatario or PEC
    if (!payload.recipient.codiceDestinatario && !payload.recipient.pec) {
      return {
        success: false,
        status: 'rejected',
        errorCode: 'SDI_NO_RECIPIENT',
        message: 'Recipient must have either Codice Destinatario or PEC address',
      };
    }

    try {
      // Sign the XML with XAdES signature
      const signedXml = await this.signFatturaPA(payload.xmlContent);

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
      const response = await fetch(
        `${this.config.apiUrl}/fatture/stato/${externalId}`,
        {
          method: 'GET',
          // In production, add client certificate authentication
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

    const response = await fetch(this.config.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml;charset=UTF-8',
        SOAPAction: 'http://www.fatturapa.gov.it/sdi/ws/trasmissione/v1.0/TrasmissioneFatture/RiceviFatture',
      },
      body: soapEnvelope,
      // In production, configure client certificate
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
    // Simple regex parsing - in production, use proper XML parser
    const idMatch = responseXml.match(/<identificativoSdI>(\d+)<\/identificativoSdI>/);
    const dateMatch = responseXml.match(/<dataOraRicezione>([^<]+)<\/dataOraRicezione>/);
    const nameMatch = responseXml.match(/<NomeFile>([^<]+)<\/NomeFile>/);

    if (!idMatch) {
      throw new Error('Failed to parse SdI response: missing identificativoSdI');
    }

    return {
      identificativoSdI: idMatch[1],
      dataOraRicezione: dateMatch?.[1] || new Date().toISOString(),
      nomeFile: nameMatch?.[1] || '',
    };
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
