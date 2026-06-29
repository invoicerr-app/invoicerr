/**
 * Inbound reception (COMPLIANCE_ARCHITECTURE.md §11.1). Issuance and reception are peers: most
 * mandates require being able to *receive* e-invoices (IE/DK/FI/DE/FR…). Stub today — parsing,
 * validation and buyer-status emission are TODO.
 */
import { TransactionContext } from '../canonical/canonical-document';
import { ComplianceLogger } from '../execution/logger';
import { ValidationReport } from '../execution/types';
import { InboundDocument } from '../operations/types';

export interface InboundIngest {
  canonical: TransactionContext;
  validation: ValidationReport;
}

export class ReceptionService {
  /** Parse + validate an inbound e-invoice into the canonical model. */
  ingest(inbound: InboundDocument, log: ComplianceLogger): InboundIngest {
    log.todo('reception', `parse + validate inbound document from ${inbound.channel}`);
    return {
      canonical: inbound.ctx,
      validation: { valid: true, errors: [], warnings: ['reception parsing not implemented (stub)'] },
    };
  }

  /** Emit the mandated buyer-side status (SdI "consegnata", FR "déposée"→"approuvée", PE CDR…). */
  emitBuyerStatus(status: string, log: ComplianceLogger): void {
    log.todo('reception', `emit buyer status "${status}"`);
  }
}

export const defaultReceptionService = new ReceptionService();
