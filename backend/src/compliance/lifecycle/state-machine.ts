/**
 * Compliance lifecycle state machine (COMPLIANCE_ARCHITECTURE.md §11). Pure logic: transitions and
 * guards. The only way to mutate an issued invoice is a transition; free editing exists only in DRAFT.
 */
export type ComplianceStatus =
  | 'DRAFT'
  | 'ISSUED'
  | 'PENDING_CLEARANCE'
  | 'CLEARED'
  | 'REJECTED'
  | 'CONTINGENCY'
  | 'DELIVERED'
  | 'AWAITING_RESPONSE'
  | 'ACCEPTED'
  | 'REFUSED'
  | 'DISPUTED'
  | 'REPORTED'
  | 'CANCELLED'
  | 'CORRECTED';

export type ComplianceEvent =
  | 'ISSUE'
  | 'SUBMIT_CLEARANCE'
  | 'CLEAR'
  | 'REJECT'
  | 'ENTER_CONTINGENCY'
  | 'DELIVER'
  | 'OPEN_RESPONSE'
  | 'ACCEPT'
  | 'REFUSE'
  | 'DISPUTE'
  | 'REPORT'
  | 'CANCEL'
  | 'CORRECT';

const TRANSITIONS: Record<ComplianceStatus, Partial<Record<ComplianceEvent, ComplianceStatus>>> = {
  DRAFT: { ISSUE: 'ISSUED' },
  ISSUED: { SUBMIT_CLEARANCE: 'PENDING_CLEARANCE', DELIVER: 'DELIVERED', ENTER_CONTINGENCY: 'CONTINGENCY' },
  PENDING_CLEARANCE: { CLEAR: 'CLEARED', REJECT: 'REJECTED', ENTER_CONTINGENCY: 'CONTINGENCY' },
  CONTINGENCY: { CLEAR: 'CLEARED', REJECT: 'REJECTED' },
  CLEARED: { DELIVER: 'DELIVERED', CANCEL: 'CANCELLED' },
  REJECTED: {},
  DELIVERED: { OPEN_RESPONSE: 'AWAITING_RESPONSE', REPORT: 'REPORTED', CORRECT: 'CORRECTED', CANCEL: 'CANCELLED' },
  AWAITING_RESPONSE: { ACCEPT: 'ACCEPTED', REFUSE: 'REFUSED', DISPUTE: 'DISPUTED' },
  ACCEPTED: { REPORT: 'REPORTED', CORRECT: 'CORRECTED' },
  REFUSED: { CORRECT: 'CORRECTED' },
  DISPUTED: { CORRECT: 'CORRECTED', ACCEPT: 'ACCEPTED' },
  REPORTED: { CORRECT: 'CORRECTED' },
  CANCELLED: {},
  CORRECTED: {},
};

export class ComplianceStateMachine {
  constructor(public status: ComplianceStatus = 'DRAFT') {}

  /** The only state where free editing is allowed. */
  canEdit(): boolean {
    return this.status === 'DRAFT';
  }

  can(event: ComplianceEvent): boolean {
    return !!TRANSITIONS[this.status][event];
  }

  /** Apply a transition or throw if it is not allowed from the current state. */
  apply(event: ComplianceEvent): ComplianceStatus {
    const next = TRANSITIONS[this.status][event];
    if (!next) {
      throw new Error(`Illegal transition: cannot ${event} from ${this.status}`);
    }
    this.status = next;
    return this.status;
  }

  isTerminal(): boolean {
    return Object.keys(TRANSITIONS[this.status]).length === 0;
  }
}
