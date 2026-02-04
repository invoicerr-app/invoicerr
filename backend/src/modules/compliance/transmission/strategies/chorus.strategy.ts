import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import {
  TransmissionPayload,
  TransmissionResult,
  TransmissionStatus,
  TransmissionStrategy,
} from '../transmission.interface';
import { assertValid, validateChorusPayload } from '../validation';

/**
 * Chorus Pro Transmission Strategy
 * 
 * Chorus Pro is the French public sector e-procurement platform.
 * Used for B2G (Business-to-Government) invoices in France.
 * 
 * Uses OAuth 2.0 authentication and REST API.
 * Requires technical account credentials from Demarches Simplifiees.
 */
@Injectable()
export class ChorusTransmissionStrategy implements TransmissionStrategy {
  readonly name = 'chorus';
  readonly supportedPlatforms = ['chorus'];
  private readonly logger = new Logger(ChorusTransmissionStrategy.name);

  // Chorus Pro API endpoints (test environment)
  private readonly API_URL = process.env.CHORUS_API_URL || 'https://api-test.aife.economie.gouv.fr/chorus-pro';

  constructor(
    private readonly httpService: HttpService,
  ) {}

  supports(platform: string): boolean {
    return platform === 'chorus';
  }

  async send(payload: TransmissionPayload): Promise<TransmissionResult> {
    const validation = validateChorusPayload(payload);
    assertValid(validation, 'chorus transmission');

    try {
      // Get OAuth token
      const token = await this.getOAuthToken();

      // Prepare invoice for Chorus
      const chorusInvoice = this.buildChorusInvoice(payload);

      // Send to Chorus Pro
      const response = await this.httpService.axios.post(
        `${this.API_URL}/flux/pjm/flux_facturation_parametres`,
        chorusInvoice,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'cpro-account': process.env.CHORUS_TECHNICAL_ACCOUNT_ID || '',
            'cpro-account-organization': process.env.CHORUS_ORGANIZATION_ID || '',
          },
          timeout: 30000,
        },
      );

      const flowId = response.data?.flux_id || response.data?.id;

      this.logger.log(`Invoice ${payload.invoiceNumber} sent to Chorus Pro: ${flowId}`);

      return {
        success: true,
        status: 'delivered',
        externalId: flowId,
        message: 'Invoice sent to Chorus Pro',
        validationUrl: this.buildValidationUrl(flowId),
      };
    } catch (error) {
      this.logger.error(`Failed to send invoice ${payload.invoiceNumber} to Chorus Pro:`, error);

      return {
        success: false,
        status: 'failed',
        errorCode: 'CHORUS_SEND_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error sending to Chorus Pro',
      };
    }
  }

  async checkStatus(externalId: string): Promise<TransmissionStatus> {
    try {
      const token = await this.getOAuthToken();

      const response = await this.httpService.axios.get(
        `${this.API_URL}/factures/${externalId}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'cpro-account': process.env.CHORUS_TECHNICAL_ACCOUNT_ID || '',
          },
          timeout: 10000,
        },
      );

      const status = response.data?.statut || 'unknown';

      this.logger.log(`Chorus invoice ${externalId} status: ${status}`);

      // Map Chorus status to our enum
      const statusMap: Record<string, TransmissionStatus> = {
        cree: 'delivered',
        envoye: 'delivered',
        recu: 'accepted',
        accepte: 'accepted',
        rejetee: 'rejected',
        erreur: 'failed',
      };

      return statusMap[status] || 'pending';
    } catch (error) {
      this.logger.error(`Failed to check Chorus status for ${externalId}:`, error);
      return 'pending';
    }
  }

  async cancel(externalId: string): Promise<boolean> {
    try {
      const token = await this.getOAuthToken();

      await this.httpService.axios.post(
        `${this.API_URL}/factures/${externalId}/annuler`,
        {},
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'cpro-account': process.env.CHORUS_TECHNICAL_ACCOUNT_ID || '',
          },
        },
      );

      this.logger.log(`Chorus invoice ${externalId} cancelled`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to cancel Chorus invoice ${externalId}:`, error);
      return false;
    }
  }

  /**
   * Get OAuth 2.0 token from Chorus Pro
   */
  private async getOAuthToken(): Promise<string> {
    // Check for cached token
    // For production, implement token caching

    const clientId = process.env.CHORUS_CLIENT_ID || '';
    const clientSecret = process.env.CHORUS_CLIENT_SECRET || '';

    const response = await this.httpService.axios.post(
      `${this.API_URL}/oauth/token`,
      {
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'openid api_factures',
      },
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 10000,
      },
    );

    return response.data?.access_token || '';
  }

  /**
   * Build Chorus Pro invoice payload
   */
  private buildChorusInvoice(payload: TransmissionPayload): any {
    const seller = payload.sender;
    const buyer = payload.recipient;
    const metadata = payload.metadata || {};

    return {
      factures: [
        {
          id_facture: payload.invoiceNumber,
          siret: seller.siret || '',
          numero_piece: payload.invoiceNumber,
          date_echeance: payload.dueDate || new Date().toISOString().split('T')[0],
          date_emission: new Date().toISOString().split('T')[0],
          objet_facture: `Invoice ${payload.invoiceNumber}`,
          montant_ht: metadata.totalHT || 0,
          montant_ttc: metadata.totalTTC || 0,
          montant_tva: metadata.totalVAT || 0,
          id_categorie_tarifaire: 1,
          code_tva: 20,
          fournisseur: {
            siret: seller.siret || '',
            nom: seller.name || '',
            adresse: seller.address || '',
            code_postal: seller.postalCode || '',
            ville: seller.city || '',
            pays: 'FR',
          },
          destinataire: {
            siret: buyer.siret || '',
            numero_e_tva: buyer.vatNumber || '',
            nom: buyer.name || '',
            adresse: buyer.address || '',
            code_postal: buyer.postalCode || '',
            ville: buyer.city || '',
            pays: 'FR',
          },
          lignes: payload.items?.map(item => ({
            numero_ligne: item.id || 1,
            code_tva: item.vatRate,
            quantite: item.quantity,
            prix_unitaire: item.unitPrice,
            montant_ht: item.lineTotal || item.quantity * item.unitPrice,
            description: item.description,
            unite: 'PCE',
          })) || [],
        },
      ],
    };
  }

  /**
   * Build validation URL for Chorus
   */
  private buildValidationUrl(flowId: string): string {
    return `${this.API_URL}/flux/pjm/consulter_flux/${flowId}`;
  }
}
