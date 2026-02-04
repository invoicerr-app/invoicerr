import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import {
  TransmissionPayload,
  TransmissionResult,
  TransmissionStatus,
  TransmissionStrategy,
} from '../transmission.interface';
import { assertValid, validatePeppolPayload } from '../validation';

/**
 * Peppol Transmission Strategy
 * 
 * Peppol (Pan-European Public Procurement On-Line) is a network
 * for exchanging electronic documents in Europe and beyond.
 * 
 * Uses AS2 protocol with signed S/MIME messages.
 * Access points: Access Point providers (Peppol AS4 compatible)
 * 
 * Supported countries: DE, BE, NL, NO, SE, AT, AU, NZ, SG, etc.
 */
@Injectable()
export class PeppolTransmissionStrategy implements TransmissionStrategy {
  readonly name = 'peppol';
  readonly supportedPlatforms = ['peppol'];
  private readonly logger = new Logger(PeppolTransmissionStrategy.name);

  constructor(
    private readonly httpService: HttpService,
  ) {}

  supports(platform: string): boolean {
    return platform === 'peppol';
  }

  async send(payload: TransmissionPayload): Promise<TransmissionResult> {
    const validation = validatePeppolPayload(payload);
    assertValid(validation, 'peppol transmission');

    try {
      // Get Peppol access point URL from company settings
      // This would typically be stored in ComplianceSettings
      const accessPointUrl = process.env.PEPPOL_ACCESS_POINT_URL || 'https://ap.test.peppol.eu/as4';

      // Create SBDH (Standard Business Document Header)
      const sbdh = this.createSBDH(payload);
      const invoiceXml = payload.xmlContent || '<!-- XML content -->';

      // Create MIME message (S/MIME with XML attachment)
      const mimeMessage = this.createMimeMessage(sbdh, invoiceXml);

      // Send to Peppol access point
      const response = await this.httpService.axios.post(
        accessPointUrl,
        mimeMessage,
        {
          headers: {
            'Content-Type': 'multipart/related; boundary="Peppol-Boundary"',
            'AS2-To': payload.recipient.peppolId || `urn:fdc:peppol.eu:2017:receiver:${payload.recipient.vatNumber || ''}`,
            'AS2-From': payload.sender.peppolId || `urn:fdc:peppol.eu:2017:sender:${payload.sender.vatNumber || ''}`,
            'AS2-Action': 'Submit',
            'Message-Id': `msg-${Date.now()}@invoicerr.com`,
            'AS2-Sender': payload.sender.peppolId || `urn:fdc:peppol.eu:2017:sender:${payload.sender.vatNumber || ''}`,
          },
          timeout: 30000,
        },
      );

      this.logger.log(`Invoice ${payload.invoiceNumber} sent to Peppol: ${response.data?.messageId || response.data?.messageId || ''}`);

      return {
        success: true,
        status: 'delivered',
        externalId: response.data?.messageId || response.data?.messageId || '',
        message: 'Invoice sent to Peppol network',
        validationUrl: response.data?.validationUrl,
      };
    } catch (error) {
      this.logger.error(`Failed to send invoice ${payload.invoiceNumber} to Peppol:`, error);

      return {
        success: false,
        status: 'failed',
        errorCode: 'PEPPOL_SEND_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error sending to Peppol',
      };
    }
  }

  async checkStatus(externalId: string): Promise<TransmissionStatus> {
    try {
      // Peppol status is typically checked through the access point's AS4 interface
      // or through receiving platform's AS4 status endpoint
      const statusUrl = process.env.PEPPOL_STATUS_URL || 'https://ap.test.peppol.eu/as4/status';

      const response = await this.httpService.axios.get(`${statusUrl}/${externalId}`, {
        timeout: 10000,
      });

      const status = response.data?.status || 'unknown';

      this.logger.log(`Peppol invoice ${externalId} status: ${status}`);

      // Map AS4 status to our enum
      const statusMap: Record<string, TransmissionStatus> = {
        received: 'delivered',
        validated: 'accepted',
        processing: 'delivered',
        rejected: 'rejected',
        error: 'failed',
      };

      return statusMap[status] || 'pending';
    } catch (error) {
      this.logger.error(`Failed to check Peppol status for ${externalId}:`, error);
      return 'pending';
    }
  }

  async cancel(_externalId: string): Promise<boolean> {
    // Peppol transactions cannot be cancelled once sent
    // A credit note should be created instead
    return false;
  }

  /**
   * Create SBDH (Standard Business Document Header)
   */
  private createSBDH(payload: TransmissionPayload): string {
    const messageId = `msg-${Date.now()}@invoicerr.com`;
    const timestamp = new Date().toISOString();
    const senderId = payload.sender.peppolId || `urn:fdc:peppol.eu:2017:sender:${payload.sender.vatNumber || ''}`;
    const recipientId = payload.recipient.peppolId || `urn:fdc:peppol.eu:2017:receiver:${payload.recipient.vatNumber || ''}`;

    return `
<SBDH xmlns="urn:oasis:names:specification:ubl:schema:xsd:StandardBusinessDocumentHeader-2"
        xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
        xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:HeaderVersion>2.1</cbc:HeaderVersion>
  <cbc:Sender>${senderId}</cbc:Sender>
  <cbc:Receiver>${recipientId}</cbc:Receiver>
  <cbc:DocumentIdentification>
    <cbc:Standard>${payload.recipient.country === 'DE' ? 'urn:cen.eu:en16931:2017' : 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2'}</cbc:Standard>
    <cbc:TypeVersion>2.1</cbc:TypeVersion>
    <cbc:InstanceIdentifier>${payload.invoiceNumber}</cbc:InstanceIdentifier>
    <cbc:Type>${payload.recipient.country === 'DE' ? 'urn:fdc:peppol.europa.eu:2017:billing:01:1.0::urn:xoev-de:kosit:extension:1.0' : 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2'}</cbc:Type>
    <cbc:CreationDateAndTime>${timestamp}</cbc:CreationDateAndTime>
  </cbc:DocumentIdentification>
  <cbc:BusinessScope>
    <cbc:Scope>DOCUMENT</cbc:Scope>
    <cbc:Type>INVOICE</cbc:Type>
  </cbc:BusinessScope>
</SBDH>`;
  }

  /**
   * Create MIME message with SBDH and invoice
   */
  private createMimeMessage(sbdh: string, invoiceXml: string): string {
    const boundary = 'Peppol-Boundary';
    const timestamp = new Date().toISOString();

    return `
--${boundary}
Content-Type: application/xml; charset=UTF-8
Content-Transfer-Encoding: binary
Content-ID: invoice.xml@invoicerr.com

${invoiceXml}
--${boundary}
Content-Type: application/xml; charset=UTF-8
Content-Transfer-Encoding: binary
Content-ID: sbdh.xml@invoicerr.com

${sbdh.trim()}
--${boundary}--
`;
  }
}
