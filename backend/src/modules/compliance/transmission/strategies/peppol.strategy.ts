import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import {
  TransmissionPayload,
  TransmissionResult,
  TransmissionStatus,
  TransmissionStrategy,
} from '../transmission.interface';

interface PeppolConfig {
  accessPointUrl: string;
  senderId: string;
  certificatePath?: string;
  privateKeyPath?: string;
  smlDomain: string;
  environment: 'production' | 'test';
}

interface SMPServiceMetadata {
  endpoint: string;
  certificate: string;
  transportProfile: string;
}

interface AS4Response {
  messageId: string;
  timestamp: string;
  status: string;
}

@Injectable()
export class PeppolTransmissionStrategy implements TransmissionStrategy {
  readonly name = 'peppol';
  readonly supportedPlatforms = ['peppol', 'xrechnung', 'si-ubl', 'pint'];
  private readonly logger = new Logger(PeppolTransmissionStrategy.name);
  private readonly config: PeppolConfig | null;

  constructor(private readonly configService: ConfigService) {
    this.config = this.loadConfig();
  }

  private loadConfig(): PeppolConfig | null {
    const accessPointUrl = this.configService.get<string>('PEPPOL_AP_URL');
    const senderId = this.configService.get<string>('PEPPOL_SENDER_ID');

    if (!accessPointUrl || !senderId) {
      this.logger.warn('Peppol configuration incomplete. Strategy will fail on send.');
      return null;
    }

    const environment = this.configService.get<string>('PEPPOL_ENVIRONMENT') === 'production'
      ? 'production'
      : 'test';

    // SML domains for Peppol
    // Production: edelivery.tech.ec.europa.eu
    // Test: acc.edelivery.tech.ec.europa.eu
    const smlDomain = environment === 'production'
      ? 'edelivery.tech.ec.europa.eu'
      : 'acc.edelivery.tech.ec.europa.eu';

    return {
      accessPointUrl,
      senderId,
      certificatePath: this.configService.get<string>('PEPPOL_CERTIFICATE_PATH'),
      privateKeyPath: this.configService.get<string>('PEPPOL_PRIVATE_KEY_PATH'),
      smlDomain,
      environment,
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
        errorCode: 'PEPPOL_NOT_CONFIGURED',
        message: 'Peppol Access Point is not configured',
      };
    }

    // Validate that we have XML content (Peppol requires UBL/CII XML)
    if (!payload.xmlContent) {
      return {
        success: false,
        status: 'rejected',
        errorCode: 'PEPPOL_NO_XML',
        message: 'Peppol transmission requires XML content (UBL or CII format)',
      };
    }

    // Validate recipient has Peppol ID
    if (!payload.recipient.peppolId) {
      return {
        success: false,
        status: 'rejected',
        errorCode: 'PEPPOL_NO_RECIPIENT_ID',
        message: 'Recipient does not have a Peppol participant ID',
      };
    }

    try {
      // Step 1: SMP Lookup to find receiver's Access Point
      const receiverAP = await this.lookupReceiverAP(payload.recipient.peppolId);

      if (!receiverAP) {
        return {
          success: false,
          status: 'rejected',
          errorCode: 'PEPPOL_RECIPIENT_NOT_FOUND',
          message: `Recipient ${payload.recipient.peppolId} not found in Peppol network`,
        };
      }

      // Step 2: Send via AS4 protocol
      const result = await this.sendAS4Message(payload, receiverAP);

      this.logger.log(
        `Invoice ${payload.invoiceNumber} sent via Peppol. Message ID: ${result.messageId}`,
      );

      return {
        success: true,
        status: 'submitted',
        externalId: result.messageId,
        message: `Invoice sent via Peppol network to ${payload.recipient.peppolId}`,
      };
    } catch (error) {
      this.logger.error('Peppol transmission failed:', error);
      return {
        success: false,
        status: 'rejected',
        errorCode: 'PEPPOL_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async checkStatus(externalId: string): Promise<TransmissionStatus> {
    if (!this.config) {
      throw new Error('Peppol not configured');
    }

    try {
      // Query Access Point for message delivery report (MDN)
      const response = await fetch(
        `${this.config.accessPointUrl}/api/messages/${externalId}/status`,
        {
          headers: {
            'X-Sender-Id': this.config.senderId,
          },
        },
      );

      if (!response.ok) {
        return 'pending';
      }

      const result = await response.json();
      return this.mapPeppolStatus(result.status);
    } catch (error) {
      this.logger.error('Failed to check Peppol status:', error);
      return 'pending';
    }
  }

  async cancel(_externalId: string): Promise<boolean> {
    // Peppol messages cannot be cancelled after sending
    return false;
  }

  /**
   * Lookup receiver's Access Point via SMP (Service Metadata Publisher)
   *
   * The Peppol SMP lookup process:
   * 1. Hash the participant identifier using MD5
   * 2. Build the SMP hostname using SML DNS lookup
   * 3. Query the SMP for service metadata
   * 4. Extract the endpoint URL and certificate
   */
  private async lookupReceiverAP(
    peppolId: string,
  ): Promise<SMPServiceMetadata | null> {
    if (!this.config) {
      return null;
    }

    try {
      // Parse participant ID (e.g., "0088:1234567890123" -> scheme:id)
      const colonIndex = peppolId.indexOf(':');
      if (colonIndex === -1) {
        this.logger.error(`Invalid Peppol ID format: ${peppolId}`);
        return null;
      }

      const schemeId = peppolId.substring(0, colonIndex);
      const participantId = peppolId.substring(colonIndex + 1);

      // Build the participant identifier for hashing
      // Format: iso6523-actorid-upis::<scheme>::<id>
      const participantIdentifier = `iso6523-actorid-upis::${schemeId}::${participantId}`;

      // Calculate MD5 hash of the participant identifier (lowercase)
      const hash = crypto
        .createHash('md5')
        .update(participantIdentifier.toLowerCase())
        .digest('hex')
        .toLowerCase();

      // Build SMP hostname using SML DNS lookup pattern
      // Format: B-<hash>.iso6523-actorid-upis.<sml-domain>
      const smpHostname = `B-${hash}.iso6523-actorid-upis.${this.config.smlDomain}`;

      this.logger.debug(`Looking up SMP for participant ${peppolId} at ${smpHostname}`);

      // Query SMP for service metadata
      // Document type ID for Peppol BIS Billing 3.0 Invoice
      const documentTypeId = encodeURIComponent(
        'busdox-docid-qns::urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1'
      );
      const participantIdEncoded = encodeURIComponent(`${schemeId}::${participantId}`);

      const smpUrl = `https://${smpHostname}/${participantIdEncoded}/services/${documentTypeId}`;

      const response = await fetch(smpUrl, {
        headers: {
          Accept: 'application/xml',
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          this.logger.warn(`Participant ${peppolId} not registered in Peppol network`);
          return null;
        }
        throw new Error(`SMP lookup failed: ${response.status} ${response.statusText}`);
      }

      const smpXml = await response.text();
      return this.parseSMPResponse(smpXml);
    } catch (error) {
      this.logger.error(`SMP lookup failed for ${peppolId}:`, error);
      return null;
    }
  }

  /**
   * Parse SMP response XML to extract endpoint and certificate
   */
  private parseSMPResponse(xml: string): SMPServiceMetadata | null {
    try {
      // Extract endpoint address
      const endpointMatch = xml.match(/<EndpointReference>[\s\S]*?<Address>([^<]+)<\/Address>/);
      if (!endpointMatch) {
        this.logger.error('No endpoint found in SMP response');
        return null;
      }

      // Extract certificate (Base64 encoded)
      const certMatch = xml.match(/<Certificate>([^<]+)<\/Certificate>/);

      // Extract transport profile
      const transportMatch = xml.match(/transportProfile="([^"]+)"/);

      return {
        endpoint: endpointMatch[1].trim(),
        certificate: certMatch?.[1]?.trim() || '',
        transportProfile: transportMatch?.[1] || 'peppol-transport-as4-v2_0',
      };
    } catch (error) {
      this.logger.error('Failed to parse SMP response:', error);
      return null;
    }
  }

  /**
   * Send message via AS4 protocol to the receiver's Access Point
   */
  private async sendAS4Message(
    payload: TransmissionPayload,
    receiver: SMPServiceMetadata,
  ): Promise<AS4Response> {
    if (!this.config) {
      throw new Error('Peppol not configured');
    }

    // Build AS4 envelope with proper ebMS3 headers
    const messageId = `${crypto.randomUUID()}@${this.config.senderId}`;
    const as4Envelope = this.buildAS4Envelope(payload, messageId);

    // For production AS4 transmission, we need to send via our Access Point
    // which handles the cryptographic operations (signing/encryption)
    // The AP will then forward to the receiver's endpoint from SMP lookup
    const response = await fetch(`${this.config.accessPointUrl}/api/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/soap+xml; charset=utf-8',
        'X-Sender-Id': this.config.senderId,
        'X-Recipient-Id': payload.recipient.peppolId || '',
        'X-Recipient-Endpoint': receiver.endpoint,
        'X-Recipient-Certificate': receiver.certificate,
        'X-Transport-Profile': receiver.transportProfile,
        'X-Document-Type': 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1',
        'X-Process-Id': 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0',
      },
      body: as4Envelope,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AS4 send failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();

    return {
      messageId: result.messageId || messageId,
      timestamp: result.timestamp || new Date().toISOString(),
      status: result.status || 'SENT',
    };
  }

  private buildAS4Envelope(payload: TransmissionPayload, messageId: string): string {
    // Note: This method is only called after config is validated (see sendAS4Message)
    if (!this.config) {
      throw new Error('Peppol configuration required for AS4 envelope');
    }

    const timestamp = new Date().toISOString();
    // Parse Peppol IDs safely - expected format: "scheme:identifier" (e.g., "0088:1234567890")
    const parsePeppolId = (peppolId: string | undefined, fallbackId: string | undefined): { scheme: string; id: string } => {
      if (!peppolId) {
        return { scheme: '0088', id: fallbackId || '' };
      }
      const colonIndex = peppolId.indexOf(':');
      if (colonIndex === -1) {
        // No colon found - treat entire value as ID with default scheme
        return { scheme: '0088', id: peppolId };
      }
      return {
        scheme: peppolId.substring(0, colonIndex) || '0088',
        id: peppolId.substring(colonIndex + 1) || fallbackId || '',
      };
    };

    const sender = parsePeppolId(payload.sender.peppolId, payload.sender.siret);
    const recipient = parsePeppolId(payload.recipient.peppolId, payload.recipient.siret);
    const senderScheme = sender.scheme;
    const senderId = sender.id;
    const recipientScheme = recipient.scheme;
    const recipientId = recipient.id;
    const configSenderId = this.config.senderId;

    // Build proper ebMS3/AS4 envelope per Peppol AS4 profile
    return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"
               xmlns:eb="http://docs.oasis-open.org/ebxml-msg/ebms/v3.0/ns/core/200704/"
               xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
               xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
  <soap:Header>
    <eb:Messaging>
      <eb:UserMessage>
        <eb:MessageInfo>
          <eb:Timestamp>${timestamp}</eb:Timestamp>
          <eb:MessageId>${messageId}</eb:MessageId>
        </eb:MessageInfo>
        <eb:PartyInfo>
          <eb:From>
            <eb:PartyId type="urn:fdc:peppol.eu:2017:identifiers:ap">${configSenderId}</eb:PartyId>
            <eb:Role>http://docs.oasis-open.org/ebxml-msg/ebms/v3.0/ns/core/200704/initiator</eb:Role>
          </eb:From>
          <eb:To>
            <eb:PartyId type="urn:fdc:peppol.eu:2017:identifiers:ap">UNKNOWN</eb:PartyId>
            <eb:Role>http://docs.oasis-open.org/ebxml-msg/ebms/v3.0/ns/core/200704/responder</eb:Role>
          </eb:To>
        </eb:PartyInfo>
        <eb:CollaborationInfo>
          <eb:Service type="cenbii-procid-ubl">urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</eb:Service>
          <eb:Action>busdox-docid-qns::urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1</eb:Action>
          <eb:ConversationId>${payload.invoiceId}</eb:ConversationId>
        </eb:CollaborationInfo>
        <eb:PayloadInfo>
          <eb:PartInfo href="cid:${payload.invoiceId}@invoicerr">
            <eb:PartProperties>
              <eb:Property name="MimeType">application/xml</eb:Property>
              <eb:Property name="CompressionType">application/gzip</eb:Property>
            </eb:PartProperties>
          </eb:PartInfo>
        </eb:PayloadInfo>
        <eb:MessageProperties>
          <eb:Property name="originalSender">${senderScheme}:${senderId}</eb:Property>
          <eb:Property name="finalRecipient">${recipientScheme}:${recipientId}</eb:Property>
        </eb:MessageProperties>
      </eb:UserMessage>
    </eb:Messaging>
  </soap:Header>
  <soap:Body/>
</soap:Envelope>`;
  }

  private mapPeppolStatus(status: string): TransmissionStatus {
    const statusMap: Record<string, TransmissionStatus> = {
      QUEUED: 'pending',
      SENDING: 'submitted',
      SENT: 'delivered',
      DELIVERED: 'delivered',
      ACKNOWLEDGED: 'accepted',
      FAILED: 'rejected',
      REJECTED: 'rejected',
    };

    return statusMap[status.toUpperCase()] || 'pending';
  }
}
