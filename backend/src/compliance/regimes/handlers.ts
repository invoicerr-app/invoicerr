import { TransactionContext } from '../canonical/canonical-document';
import { CompliancePlan } from '../engine/compliance-engine';
import { ComplianceLogger } from '../execution/logger';
import { RegimeResult, SignedArtifact } from '../execution/types';
import { RegimeModel } from '../types';
import { RegimeHandler } from './regime-handler';

/** Post-audit: nothing to do at issue time; the invoice is valid immediately. */
export class PostAuditRegimeHandler implements RegimeHandler {
  readonly model: RegimeModel = 'POST_AUDIT';
  handle(): RegimeResult {
    return { model: this.model, clearanceRequired: false, cleared: true, authorityIds: [], notes: ['post-audit: no real-time obligation'] };
  }
}

/** Periodic reporting (SAF-T, ledgers): valid now; data filed later via the reporting layer. */
export class PeriodicReportingRegimeHandler implements RegimeHandler {
  readonly model: RegimeModel = 'PERIODIC_REPORTING';
  handle(_ctx: TransactionContext, _plan: CompliancePlan, _signed: SignedArtifact[], log: ComplianceLogger): RegimeResult {
    log.todo('regime/periodic-reporting', 'enqueue document into the periodic SAF-T / ledger batch');
    return { model: this.model, clearanceRequired: false, cleared: true, authorityIds: [], notes: ['queued for periodic reporting'] };
  }
}

/** Real-time reporting: valid now, but data must be reported near-immediately (non-blocking). */
export class RealTimeReportingRegimeHandler implements RegimeHandler {
  readonly model: RegimeModel = 'REAL_TIME_REPORTING';
  handle(_ctx: TransactionContext, _plan: CompliancePlan, _signed: SignedArtifact[], log: ComplianceLogger): RegimeResult {
    log.todo('regime/real-time-reporting', 'push transaction data to the authority within the mandated window');
    return { model: this.model, clearanceRequired: false, cleared: true, authorityIds: [], notes: ['real-time report due'] };
  }
}

/** Clearance: BLOCKING — the invoice is not legally valid until the authority/PAC authorises it. */
export class ClearanceRegimeHandler implements RegimeHandler {
  readonly model: RegimeModel = 'CLEARANCE';
  handle(_ctx: TransactionContext, _plan: CompliancePlan, _signed: SignedArtifact[], log: ComplianceLogger): RegimeResult {
    log.todo('regime/clearance', 'submit for clearance and await authorisation (UUID/folio/protocol) before the invoice is valid');
    // Stub: clearance is asynchronous → starts PENDING (not yet cleared). Real impl polls the channel.
    return { model: this.model, clearanceRequired: true, cleared: false, authorityIds: [], notes: ['awaiting clearance (async)'] };
  }
}

/** Decentralized CTC (FR PDP / Peppol 5-corner): valid now; routed + e-reported, non-blocking. */
export class DecentralizedCtcRegimeHandler implements RegimeHandler {
  readonly model: RegimeModel = 'DECENTRALIZED_CTC';
  handle(_ctx: TransactionContext, _plan: CompliancePlan, _signed: SignedArtifact[], log: ComplianceLogger): RegimeResult {
    log.todo('regime/decentralized-ctc', 'route via PDP/Peppol + extract e-reporting; track lifecycle statuses');
    return { model: this.model, clearanceRequired: false, cleared: true, authorityIds: [], notes: ['routed via decentralized CTC network'] };
  }
}
