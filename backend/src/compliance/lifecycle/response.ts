/**
 * Bidirectional response track (COMPLIANCE_ARCHITECTURE.md §11.1). After delivery, the buyer or
 * authority sends statuses back, often on a deadline with "silence = acceptance" (CL/CO/FR).
 */
import { ComplianceLogger } from '../execution/logger';
import { ResponsePolicy } from '../profiles/schema';

export interface ResponseWindow {
  open: boolean;
  deadlineAt?: string;
  defaultOnSilence: 'ACCEPT' | 'NONE';
  statuses: string[];
}

export class ResponseTracker {
  /** Open the response window per the profile's policy (if any). */
  open(policy: ResponsePolicy | undefined, now: Date, log: ComplianceLogger): ResponseWindow {
    if (!policy) return { open: false, defaultOnSilence: 'NONE', statuses: [] };
    const deadlineAt = policy.window
      ? new Date(now.getTime() + policy.window.hours * 3600_000).toISOString()
      : undefined;
    log.info('lifecycle/response', `response window open until ${deadlineAt ?? '(no deadline)'}`);
    return {
      open: true,
      deadlineAt,
      defaultOnSilence: policy.defaultOnSilence ?? 'NONE',
      statuses: policy.statuses ?? [],
    };
  }

  /** Record an inbound status message (Peppol response, SdI receipt, PE CDR, FR status). */
  applyStatus(status: string, log: ComplianceLogger): void {
    log.todo('lifecycle/response', `persist inbound status "${status}" as a ComplianceEvent`);
  }

  /** Fired by the scheduler when the deadline elapses without a response. */
  onSilence(window: ResponseWindow, log: ComplianceLogger): 'ACCEPTED' | 'NONE' {
    if (window.defaultOnSilence === 'ACCEPT') {
      log.info('lifecycle/response', 'silence = acceptance: finalising as ACCEPTED');
      return 'ACCEPTED';
    }
    return 'NONE';
  }
}

export const defaultResponseTracker = new ResponseTracker();
