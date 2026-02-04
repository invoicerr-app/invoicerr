import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import {
  TransmissionPayload,
  TransmissionResult,
  TransmissionStatus,
  TransmissionStrategy,
} from '../transmission.interface';
import { assertValid, validateSDIPayload } from '../validation';

/**
 * SDI Transmission Strategy (Sistema di Interscambio)
 * 
 * SDI is Italy's e-invoicing platform for all B2B/B2G transactions.
 * Uses FatturaPA XML format with XAdES digital signature.
 * 
 * Transmission is mandatory for all Italian B2B/B2G invoices since 2019.
 */
@Injectable()
export class SdITransmissionStrategy implements TransmissionStrategy {
  readonly name = 'sdi';
  readonly supportedPlatforms = ['sdi'];
  private readonly logger = new Logger(SdITransmissionStrategy.name);

  // SDI endpoints (test and production)
  private readonly TEST_URL = 'https://webservicetest.sdi.mf.gov.it/services';
  private readonly PROD_URL = 'https://webservice.sdi.mf.gov.it/services';
  private readonly TEST_FILE_URL = 'https://individuazionetest.sdi.mf.gov.it/IndividuazioneWSDL/IndividuazioneService';
  private readonly PROD_FILE_URL = 'https://individuazione.sdi.mf.gov.it/IndividuazioneWSDL/IndividuazioneService';

  constructor(
    private readonly httpService: HttpService,
  ) {}

  supports(platform: string): boolean {
    return platform === 'sdi';
  }

  async send(payload: TransmissionPayload): Promise<TransmissionResult> {
    const validation = validateSDIPayload(payload);
    assertValid(validation, 'sdi transmission');

    const isTest = process.env.SDI_ENVIRONMENT !== 'production';
    const baseUrl = isTest ? this.TEST_URL : this.PROD_URL;
    const fileUrl = isTest ? this.TEST_FILE_URL : this.PROD_FILE_URL;

    try {
      // Validate XML structure
      if (!payload.xmlContent) {
        throw new Error('XML content is required for SDI transmission');
      }

      // Sign the XML (XAdES-BES)
      const signedXml = await this.signXML(payload.xmlContent);

      // Prepare file upload request
      const fileRequest = {
        File: signedXml,
        NomeFile: `IT${payload.sender.piva}_${payload.invoiceNumber}.xml.p7m`,
        Password: process.env.SDI_CERTIFICATE_PASSWORD || '',
      };

      // Upload file to SDI
      const fileResponse = await this.httpService.axios.post(
        `${fileUrl}/FileSdIBase`,
        fileRequest,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 30000,
        },
      );

      const fileName = fileResponse.data?.NomeFile || '';

      // Send invoice to SDI
      const invoiceRequest = {
        CodiceDestinatario: '0000000', // Default SDI ID for test
        File: fileName,
        NomeFile: fileName,
        CedentePrestatore: {
          IdPaese: 'IT',
          IdCodiceFiscale: payload.sender.piva || '',
        },
        SoggettoEmittente: {
          IdPaese: 'IT',
          IdCodiceFiscale: payload.sender.piva || '',
        },
        SoggettoRicevente: {
          CodiceFiscale: payload.recipient.piva || '',
        },
        DatiTrasmissione: {
          DataOraInvio: new Date().toISOString(),
          ProgressivoInvio: 1,
        },
        DatiFattura: {
          DatiGenerali: {
            TipoDocumento: 'TD01',
            Divisa: 'EUR',
            Data: payload.issueDate || new Date().toISOString().split('T')[0],
            Numero: payload.invoiceNumber,
          },
          DatiFatturaElettronica: {
            File: fileName,
          },
        },
      };

      const response = await this.httpService.axios.post(
        `${baseUrl}/RiceviFatture`,
        invoiceRequest,
        {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          timeout: 30000,
        },
      );

      const idFileSdI = response.data?.Esito?.IdentificativoSdI || '';

      this.logger.log(`Invoice ${payload.invoiceNumber} sent to SDI: ${idFileSdI}`);

      return {
        success: true,
        status: 'delivered',
        externalId: idFileSdI,
        message: 'Invoice sent to SDI',
        validationUrl: `https://individuazione.sdi.mf.gov.it/individuazione/${idFileSdI}`,
      };
    } catch (error) {
      this.logger.error(`Failed to send invoice ${payload.invoiceNumber} to SDI:`, error);

      return {
        success: false,
        status: 'failed',
        errorCode: 'SDI_SEND_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error sending to SDI',
      };
    }
  }

  async checkStatus(externalId: string): Promise<TransmissionStatus> {
    try {
      const isTest = process.env.SDI_ENVIRONMENT !== 'production';
      const baseUrl = isTest ? this.TEST_URL : this.PROD_URL;

      const response = await this.httpService.axios.get(
        `${baseUrl}/RiceviFatture`,
        {
          headers: {
            'Content-Type': 'application/json',
          },
          params: {
            IdentificativoSdI: externalId,
          },
          timeout: 10000,
        },
      );

      const esito = response.data?.Esito || {};

      this.logger.log(`SDI invoice ${externalId} status: ${esito.DescrizioneEsito}`);

      // Map SDI status to our enum
      const statusMap: Record<string, TransmissionStatus> = {
        EC01: 'pending', // Ricevuta SDI
        EC02: 'delivered', // Presa in carico SDI
        ER01: 'rejected', // Errore elaborazione
        ER02: 'failed', // File non trovato
        ER03: 'rejected', // Errore convalida
      };

      return statusMap[esito.CodiceEsito] || 'pending';
    } catch (error) {
      this.logger.error(`Failed to check SDI status for ${externalId}:`, error);
      return 'pending';
    }
  }

  async cancel(_externalId: string): Promise<boolean> {
    // SDI transactions cannot be cancelled once sent
    // A credit note should be created instead
    return false;
  }

  /**
   * Sign XML with XAdES-BES (Basic Electronic Signature)
   * This is a placeholder - actual implementation would use a crypto library
   */
  private async signXML(xml: string): Promise<string> {
    // In production, this would:
    // 1. Load the company's X.509 certificate from ComplianceSettings
    // 2. Create XAdES-BES signature
    // 3. Embed signature in XML
    // 4. Return signed XML as .p7m file

    // For now, return XML unchanged
    return xml;
  }
}
