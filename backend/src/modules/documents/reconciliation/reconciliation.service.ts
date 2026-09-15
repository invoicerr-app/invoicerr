/**
 * Purchase orders & goods receipts, second pass (three-way match / rapprochement à 3 voies) —
 * `Controller → Service → Prisma` for the 3-way-match HTTP
 * surface (`received-invoices.controller.ts`'s own new routes): a thin `Injectable` wrapping the pure
 * composition (`resolve-received-invoice-reconciliation.ts`), the acceptance write
 * (`variance-acceptance.ts`), and the company-wide tolerance setting (`reconciliation-settings.ts`) —
 * none of which touch Prisma from a controller, the same layering discipline every other module here
 * already holds.
 */
import { Injectable } from '@nestjs/common';

import {
  DEFAULT_TOLERANCE_PERCENT,
  getReconciliationSettings,
  ReconciliationSettings,
  setReconciliationTolerancePercent,
} from './reconciliation-settings';
import {
  ReceivedInvoiceReconciliationResult,
  resolveReceivedInvoiceReconciliation,
} from './resolve-received-invoice-reconciliation';
import { acceptVariance as acceptVarianceWrite } from './variance-acceptance';

@Injectable()
export class ReconciliationService {
  async getReconciliation(
    companyId: string,
    receivedInvoiceId: string,
  ): Promise<ReceivedInvoiceReconciliationResult> {
    return resolveReceivedInvoiceReconciliation(companyId, receivedInvoiceId);
  }

  /** Records the acceptance, then re-resolves the FULL reconciliation — the caller (the frontend
   *  panel) gets back exactly the same shape `getReconciliation` returns, freshly reflecting the
   *  acceptance it just recorded, in one round-trip. */
  async acceptVariance(
    companyId: string,
    receivedInvoiceId: string,
    userId: string,
    userLabel: string,
    reason?: string,
  ): Promise<ReceivedInvoiceReconciliationResult> {
    await acceptVarianceWrite(companyId, receivedInvoiceId, userId, userLabel, reason);
    return resolveReceivedInvoiceReconciliation(companyId, receivedInvoiceId);
  }

  async getSettings(companyId: string): Promise<ReconciliationSettings> {
    return getReconciliationSettings(companyId);
  }

  async setSettings(companyId: string, tolerancePercent: number): Promise<ReconciliationSettings> {
    return setReconciliationTolerancePercent(companyId, tolerancePercent);
  }
}

export { DEFAULT_TOLERANCE_PERCENT };
