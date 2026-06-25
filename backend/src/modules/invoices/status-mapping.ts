/**
 * ComplianceStatus → InvoiceStatus mapping (III.1 — single vocabulary).
 *
 * Compliance statuses that have a direct InvoiceStatus equivalent are mapped 1:1.
 * Statuses without a match (REJECTED, CONTINGENCY, DELIVERED, …) return undefined —
 * the caller should keep the current InvoiceStatus unchanged.
 *
 * Invoice-only statuses (UNPAID, OVERDUE, SENT, PAID, ARCHIVED) have no
 * ComplianceStatus counterpart and are managed exclusively at the invoice level.
 */
import type { ComplianceStatus } from '@/compliance/lifecycle/state-machine';

export type InvoiceStatusValue =
    | 'DRAFT'
    | 'ISSUED'
    | 'PENDING_CLEARANCE'
    | 'CLEARED'
    | 'CANCELLED'
    | 'CORRECTED'
    | 'PAID'
    | 'UNPAID'
    | 'OVERDUE'
    | 'SENT'
    | 'ARCHIVED';

const COMPLIANCE_TO_INVOICE: Partial<Record<ComplianceStatus, InvoiceStatusValue>> = {
    DRAFT: 'DRAFT',
    ISSUED: 'ISSUED',
    PENDING_CLEARANCE: 'PENDING_CLEARANCE',
    CLEARED: 'CLEARED',
    CANCELLED: 'CANCELLED',
    CORRECTED: 'CORRECTED',
};

/**
 * Map a ComplianceStatus to the corresponding InvoiceStatus, or return undefined
 * when the compliance status has no direct invoice-level equivalent (e.g. REJECTED,
 * DELIVERED, CONTINGENCY).
 */
export function complianceToInvoiceStatus(cs: ComplianceStatus): InvoiceStatusValue | undefined {
    return COMPLIANCE_TO_INVOICE[cs];
}
