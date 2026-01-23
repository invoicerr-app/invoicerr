import { Injectable } from '@nestjs/common';
import { CorrectionConfig, CorrectionMethod } from '../interfaces';

export interface CorrectionContext {
  invoiceId: string;
  invoiceNumber: string;
  issueDate: string;
  totalHT: number;
  totalVAT: number;
  totalTTC: number;
  status: string;
  transmittedAt?: string;
  platformId?: string;
}

export interface CorrectionRequest {
  reason: string;
  reasonCode?: string;
  items?: Array<{
    originalItemId?: string;
    description: string;
    quantity: number;
    unitPrice: number;
    vatRate: number;
  }>;
  /** For partial correction */
  partialAmount?: number;
}

export interface CorrectionResult {
  canCorrect: boolean;
  method?: CorrectionMethod;
  requiresApproval?: boolean;
  approvalEndpoint?: string;
  message?: string;
  creditNoteData?: {
    number?: string;
    originalInvoiceRef: string;
    reason: string;
    reasonCode?: string;
    items: Array<{
      description: string;
      quantity: number;
      unitPrice: number;
      vatRate: number;
    }>;
    totalHT: number;
    totalVAT: number;
    totalTTC: number;
  };
}

@Injectable()
export class CorrectionService {

  /**
   * Check if an invoice can be modified directly
   */
  canModifyDirectly(invoice: CorrectionContext, config: CorrectionConfig): boolean {
    // If direct modification is not allowed, return false
    if (!config.allowDirectModification) {
      return false;
    }

    // If already transmitted to platform, cannot modify
    if (invoice.transmittedAt || invoice.platformId) {
      return false;
    }

    // If status is final (paid, etc.), cannot modify
    if (['PAID', 'CANCELLED', 'CREDITED'].includes(invoice.status)) {
      return false;
    }

    return true;
  }

  /**
   * Get the correction method required for an invoice
   */
  getCorrectionMethod(
    _invoice: CorrectionContext,
    config: CorrectionConfig,
  ): CorrectionMethod {
    return config.method;
  }

  /**
   * Check if correction requires pre-approval (e.g., China)
   */
  requiresPreApproval(config: CorrectionConfig): boolean {
    return config.requiresPreApproval || false;
  }

  /**
   * Create a credit note for an invoice
   */
  createCreditNote(
    invoice: CorrectionContext,
    request: CorrectionRequest,
    config: CorrectionConfig,
  ): CorrectionResult {
    // Validate the request
    if (!this.validateCorrectionRequest(invoice, request, config)) {
      return {
        canCorrect: false,
        message: 'Invalid correction request',
      };
    }

    // Check if pre-approval is needed
    if (config.requiresPreApproval) {
      return {
        canCorrect: true,
        method: 'platform_request',
        requiresApproval: true,
        approvalEndpoint: config.approvalEndpoint,
        message: 'Correction requires platform pre-approval',
      };
    }

    // Calculate credit note amounts
    let items: Array<{
      description: string;
      quantity: number;
      unitPrice: number;
      vatRate: number;
    }>;
    let totalHT: number;
    let totalVAT: number;
    let totalTTC: number;

    if (request.items && request.items.length > 0) {
      // Partial credit note with specific items
      items = request.items.map((item) => ({
        description: item.description,
        quantity: Math.abs(item.quantity) * -1, // Negative quantities
        unitPrice: item.unitPrice,
        vatRate: item.vatRate,
      }));

      totalHT = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
      totalVAT = items.reduce(
        (sum, item) => sum + (item.quantity * item.unitPrice * item.vatRate) / 100,
        0,
      );
      totalTTC = totalHT + totalVAT;
    } else if (request.partialAmount) {
      // Partial credit by amount
      const ratio = request.partialAmount / invoice.totalTTC;
      totalHT = Math.round(invoice.totalHT * ratio * 100) / 100;
      totalVAT = Math.round(invoice.totalVAT * ratio * 100) / 100;
      totalTTC = request.partialAmount;

      items = [
        {
          description: `Correction: ${request.reason}`,
          quantity: -1,
          unitPrice: totalHT,
          vatRate: invoice.totalVAT > 0 && invoice.totalHT > 0
            ? (invoice.totalVAT / invoice.totalHT) * 100
            : 0,
        },
      ];
    } else {
      // Full credit note
      totalHT = -invoice.totalHT;
      totalVAT = -invoice.totalVAT;
      totalTTC = -invoice.totalTTC;

      items = [
        {
          description: `Full credit: ${request.reason}`,
          quantity: -1,
          unitPrice: invoice.totalHT,
          vatRate: invoice.totalVAT > 0 && invoice.totalHT > 0
            ? (invoice.totalVAT / invoice.totalHT) * 100
            : 0,
        },
      ];
    }

    // Get reason code
    const reasonCode = request.reasonCode || this.getDefaultReasonCode(config);

    return {
      canCorrect: true,
      method: config.method,
      creditNoteData: {
        originalInvoiceRef: invoice.invoiceNumber,
        reason: request.reason,
        reasonCode,
        items,
        totalHT: Math.round(totalHT * 100) / 100,
        totalVAT: Math.round(totalVAT * 100) / 100,
        totalTTC: Math.round(totalTTC * 100) / 100,
      },
    };
  }

  /**
   * Validate a correction request
   */
  validateCorrectionRequest(
    invoice: CorrectionContext,
    request: CorrectionRequest,
    config: CorrectionConfig,
  ): boolean {
    // Must have a reason
    if (!request.reason || request.reason.trim().length === 0) {
      return false;
    }

    // If reason codes are required, validate
    if (config.codes && config.codes.length > 0 && request.reasonCode) {
      const validCodes = config.codes.map((c) => c.code);
      if (!validCodes.includes(request.reasonCode)) {
        return false;
      }
    }

    // Validate partial amount doesn't exceed original
    if (request.partialAmount && request.partialAmount > invoice.totalTTC) {
      return false;
    }

    return true;
  }

  /**
   * Get available correction codes for a country
   */
  getAvailableCodes(
    config: CorrectionConfig,
  ): Array<{ code: string; labelKey: string }> {
    return config.codes || [];
  }

  private getDefaultReasonCode(config: CorrectionConfig): string | undefined {
    if (config.codes && config.codes.length > 0) {
      return config.codes[0].code;
    }
    return undefined;
  }
}
