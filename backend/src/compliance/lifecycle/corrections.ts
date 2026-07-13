/**
 * Corrections (COMPLIANCE_ARCHITECTURE.md §11). An issued document is immutable; a correction is a
 * NEW document referencing the original. The strategy is chosen per profile (CorrectionModel).
 */
import { TransactionContext } from '../canonical/canonical-document';
import { ComplianceLogger } from '../execution/logger';
import { CorrectionModel, DocumentKind } from '../types';

export interface CorrectionOutcome {
  newKind: DocumentKind;
  correctsRef: string;
  notes: string[];
}

export interface CorrectionStrategy {
  readonly model: CorrectionModel;
  correct(originalRef: string, ctx: TransactionContext, log: ComplianceLogger): CorrectionOutcome;
}

/** EU style: issue a credit note (avoir) referencing the original, optionally + a fresh invoice. */
export class CreditNoteStrategy implements CorrectionStrategy {
  readonly model: CorrectionModel = 'CREDIT_NOTE';
  correct(originalRef: string, _ctx: TransactionContext, log: ComplianceLogger): CorrectionOutcome {
    log.todo('lifecycle/corrections/credit-note', `create CREDIT_NOTE referencing ${originalRef}`);
    return { newKind: 'CREDIT_NOTE', correctsRef: originalRef, notes: ['credit note issued'] };
  }
}

/**
 * Some LATAM, and PL post-2026-02 (KSeF: `faktura korygująca`, the only legal correction path once
 * `cancellation.allowed=false` — see profiles/data/pl.ts): a corrective invoice that supersedes the
 * original's amounts.
 *
 * M-4 (COMPLIANCE_AUDIT.md): this strategy only decides the correction OUTCOME (kind + linkage) —
 * building the actual document is the format-provider layer's job, downstream of createRecord()
 * (see ComplianceService.correct()). For PL that's now real: national/fa-vat.ts's KOR mode
 * (RodzajFaktury=KOR + DaneFaKorygowanej referencing the original's KSeF number), wired end-to-end
 * by InvoicesService.correctInvoice() → ComplianceService.createDraft(..., correctsId) → issue() →
 * send() → FaVatFormatProvider → InvoiceRenderingService.renderFaVat(). No longer a stub.
 */
export class CorrectiveInvoiceStrategy implements CorrectionStrategy {
  readonly model: CorrectionModel = 'CORRECTIVE_INVOICE';
  correct(originalRef: string, _ctx: TransactionContext, log: ComplianceLogger): CorrectionOutcome {
    log.info('lifecycle/corrections/corrective-invoice', `CORRECTIVE_INVOICE created for ${originalRef}`);
    return { newKind: 'CORRECTIVE_INVOICE', correctsRef: originalRef, notes: ['corrective invoice issued'] };
  }
}

/** Clearance systems with substitution: cancel the original and replace it. */
export class CancelAndReplaceStrategy implements CorrectionStrategy {
  readonly model: CorrectionModel = 'CANCEL_AND_REPLACE';
  correct(originalRef: string, _ctx: TransactionContext, log: ComplianceLogger): CorrectionOutcome {
    log.todo(
      'lifecycle/corrections/cancel-replace',
      `cancel ${originalRef} with the authority and issue a replacement`,
    );
    return {
      newKind: 'INVOICE',
      correctsRef: originalRef,
      notes: ['original cancelled, replacement issued'],
    };
  }
}

export class CorrectionRegistry {
  private readonly byModel = new Map<CorrectionModel, CorrectionStrategy>();
  constructor(strategies?: CorrectionStrategy[]) {
    const list = strategies ?? [
      new CreditNoteStrategy(),
      new CorrectiveInvoiceStrategy(),
      new CancelAndReplaceStrategy(),
    ];
    for (const s of list) this.byModel.set(s.model, s);
  }
  get(model: CorrectionModel): CorrectionStrategy {
    return this.byModel.get(model) ?? this.byModel.get('CREDIT_NOTE')!;
  }
}

export const defaultCorrectionRegistry = new CorrectionRegistry();
