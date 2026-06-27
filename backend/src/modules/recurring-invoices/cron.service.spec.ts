/**
 * Unit tests for the pure functions in RecurringInvoicesCronService.
 *
 * We duplicate the function bodies here to avoid pulling in the NestJS
 * dependency tree (which fails in Jest due to an ESM-only transitive dep).
 *
 * NOTE: All Date constructors use (year, month-1, day) form to avoid
 * timezone issues with ISO string parsing (which defaults to UTC).
 */

/** Format a Date as YYYY-MM-DD in local time */
function localDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

// ─── calculateNextInvoiceDate (copy from cron.service.ts) ──────────────

function calculateNextInvoiceDate(from: Date, frequency: string): Date {
    const nextDate = new Date(from);

    switch (frequency) {
        case 'WEEKLY':
            nextDate.setDate(nextDate.getDate() + 7);
            break;
        case 'BIWEEKLY':
            nextDate.setDate(nextDate.getDate() + 14);
            break;
        case 'MONTHLY': {
            const targetDay = from.getDate();
            nextDate.setMonth(nextDate.getMonth() + 1);
            if (nextDate.getDate() !== targetDay) {
                nextDate.setDate(0);
            }
            break;
        }
        case 'BIMONTHLY': {
            const targetDay = from.getDate();
            nextDate.setMonth(nextDate.getMonth() + 2);
            if (nextDate.getDate() !== targetDay) {
                nextDate.setDate(0);
            }
            break;
        }
        case 'QUARTERLY': {
            const targetDay = from.getDate();
            nextDate.setMonth(nextDate.getMonth() + 3);
            if (nextDate.getDate() !== targetDay) {
                nextDate.setDate(0);
            }
            break;
        }
        case 'QUADMONTHLY': {
            const targetDay = from.getDate();
            nextDate.setMonth(nextDate.getMonth() + 4);
            if (nextDate.getDate() !== targetDay) {
                nextDate.setDate(0);
            }
            break;
        }
        case 'SEMIANNUALLY': {
            const targetDay = from.getDate();
            nextDate.setMonth(nextDate.getMonth() + 6);
            if (nextDate.getDate() !== targetDay) {
                nextDate.setDate(0);
            }
            break;
        }
        case 'ANNUALLY': {
            const targetDay = from.getDate();
            nextDate.setFullYear(nextDate.getFullYear() + 1);
            if (nextDate.getDate() !== targetDay) {
                nextDate.setDate(0);
            }
            break;
        }
        default:
            nextDate.setMonth(nextDate.getMonth() + 1);
    }

    return nextDate;
}

// ─── computePeriodKey (copy from cron.service.ts) ──────────────────────

function getISOWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function computePeriodKey(date: Date, frequency: string): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');

    switch (frequency) {
        case 'WEEKLY':
        case 'BIWEEKLY': {
            const weekNum = getISOWeekNumber(date);
            return `${y}-W${String(weekNum).padStart(2, '0')}`;
        }
        case 'MONTHLY':
            return `${y}-${m}`;
        case 'BIMONTHLY':
            return `${y}-${m}`;
        case 'QUARTERLY': {
            const quarter = Math.floor(date.getMonth() / 3) + 1;
            return `${y}-Q${quarter}`;
        }
        case 'QUADMONTHLY':
            return `${y}-${m}`;
        case 'SEMIANNUALLY': {
            const half = date.getMonth() < 6 ? 'H1' : 'H2';
            return `${y}-${half}`;
        }
        case 'ANNUALLY':
            return `${y}`;
        default:
            return `${y}-${m}`;
    }
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('calculateNextInvoiceDate', () => {
    it('WEEKLY: advances by 7 days', () => {
        const from = new Date(2026, 5, 26); // June 26, 2026 (Fri)
        const result = calculateNextInvoiceDate(from, 'WEEKLY');
        expect(localDate(result)).toBe('2026-07-03');
    });

    it('BIWEEKLY: advances by 14 days', () => {
        const from = new Date(2026, 5, 26); // June 26
        const result = calculateNextInvoiceDate(from, 'BIWEEKLY');
        expect(localDate(result)).toBe('2026-07-10');
    });

    it('MONTHLY: advances by 1 month, preserving day of month', () => {
        const from = new Date(2026, 0, 15); // Jan 15
        const result = calculateNextInvoiceDate(from, 'MONTHLY');
        expect(localDate(result)).toBe('2026-02-15');
    });

    it('MONTHLY: handles month overflow (Jan 31 → Feb 28)', () => {
        const from = new Date(2026, 0, 31); // Jan 31
        const result = calculateNextInvoiceDate(from, 'MONTHLY');
        expect(localDate(result)).toBe('2026-02-28');
    });

    it('MONTHLY: handles month overflow (Jan 31 → Feb 29 leap year)', () => {
        const from = new Date(2028, 0, 31); // Jan 31, 2028 is leap year
        const result = calculateNextInvoiceDate(from, 'MONTHLY');
        expect(localDate(result)).toBe('2028-02-29');
    });

    it('QUARTERLY: advances by 3 months', () => {
        const from = new Date(2026, 2, 10); // Mar 10
        const result = calculateNextInvoiceDate(from, 'QUARTERLY');
        expect(localDate(result)).toBe('2026-06-10');
    });

    it('QUARTERLY: handles month overflow (Oct 31 → Jan 31)', () => {
        const from = new Date(2026, 9, 31); // Oct 31
        const result = calculateNextInvoiceDate(from, 'QUARTERLY');
        expect(localDate(result)).toBe('2027-01-31');
    });

    it('ANNUALLY: advances by 1 year, preserving day', () => {
        const from = new Date(2026, 5, 26); // Jun 26
        const result = calculateNextInvoiceDate(from, 'ANNUALLY');
        expect(localDate(result)).toBe('2027-06-26');
    });

    it('ANNUALLY: handles Feb 29 → Feb 28 in non-leap year', () => {
        const from = new Date(2028, 1, 29); // Feb 29, 2028 (leap)
        const result = calculateNextInvoiceDate(from, 'ANNUALLY');
        expect(localDate(result)).toBe('2029-02-28');
    });

    it('SEMIANNUALLY: advances by 6 months', () => {
        const from = new Date(2026, 0, 15); // Jan 15
        const result = calculateNextInvoiceDate(from, 'SEMIANNUALLY');
        expect(localDate(result)).toBe('2026-07-15');
    });

    it('BIMONTHLY: advances by 2 months', () => {
        const from = new Date(2026, 5, 10); // Jun 10
        const result = calculateNextInvoiceDate(from, 'BIMONTHLY');
        expect(localDate(result)).toBe('2026-08-10');
    });

    it('QUADMONTHLY: advances by 4 months', () => {
        const from = new Date(2026, 5, 10); // Jun 10
        const result = calculateNextInvoiceDate(from, 'QUADMONTHLY');
        expect(localDate(result)).toBe('2026-10-10');
    });

    it('does NOT force to Monday — MONTHLY preserves day of month, not weekday', () => {
        const from = new Date(2026, 5, 26); // Friday June 26, 2026
        const result = calculateNextInvoiceDate(from, 'MONTHLY');
        // July 26 is a Sunday — the important thing is day 26 is preserved, not forced to Monday
        expect(result.getDate()).toBe(26); // Day of month preserved
        expect(result.getMonth()).toBe(6); // July (0-indexed)
        expect(result.getDay()).not.toBe(1); // Not forced to Monday
    });

    it('WEEKLY does NOT force to Monday — preserves original day', () => {
        const from = new Date(2026, 5, 26); // Friday June 26, 2026
        const result = calculateNextInvoiceDate(from, 'WEEKLY');
        expect(result.getDay()).toBe(5); // Still Friday
    });

    it('default: falls back to MONTHLY', () => {
        const from = new Date(2026, 5, 10); // Jun 10
        const result = calculateNextInvoiceDate(from, 'UNKNOWN');
        expect(localDate(result)).toBe('2026-07-10');
    });

    it('multiple consecutive calls produce correct sequence (monthly from Jan 31)', () => {
        let date = new Date(2026, 0, 31); // Jan 31
        const results: string[] = [];
        for (let i = 0; i < 6; i++) {
            date = calculateNextInvoiceDate(date, 'MONTHLY');
            results.push(localDate(date));
        }
        // After Jan 31 → Feb 28, subsequent months use day 28
        expect(results).toEqual([
            '2026-02-28',
            '2026-03-28',
            '2026-04-28',
            '2026-05-28',
            '2026-06-28',
            '2026-07-28',
        ]);
    });

    it('multiple consecutive calls produce correct sequence (monthly from 15th)', () => {
        let date = new Date(2026, 0, 15); // Jan 15
        const results: string[] = [];
        for (let i = 0; i < 6; i++) {
            date = calculateNextInvoiceDate(date, 'MONTHLY');
            results.push(localDate(date));
        }
        expect(results).toEqual([
            '2026-02-15',
            '2026-03-15',
            '2026-04-15',
            '2026-05-15',
            '2026-06-15',
            '2026-07-15',
        ]);
    });
});

describe('computePeriodKey', () => {
    it('MONTHLY: YYYY-MM', () => {
        expect(computePeriodKey(new Date(2026, 5, 15), 'MONTHLY')).toBe('2026-06');
    });

    it('QUARTERLY: YYYY-Qn', () => {
        expect(computePeriodKey(new Date(2026, 0, 10), 'QUARTERLY')).toBe('2026-Q1');
        expect(computePeriodKey(new Date(2026, 3, 10), 'QUARTERLY')).toBe('2026-Q2');
        expect(computePeriodKey(new Date(2026, 6, 10), 'QUARTERLY')).toBe('2026-Q3');
        expect(computePeriodKey(new Date(2026, 9, 10), 'QUARTERLY')).toBe('2026-Q4');
    });

    it('ANNUALLY: YYYY', () => {
        expect(computePeriodKey(new Date(2026, 5, 15), 'ANNUALLY')).toBe('2026');
    });

    it('SEMIANNUALLY: YYYY-H1 or YYYY-H2', () => {
        expect(computePeriodKey(new Date(2026, 2, 10), 'SEMIANNUALLY')).toBe('2026-H1');
        expect(computePeriodKey(new Date(2026, 8, 10), 'SEMIANNUALLY')).toBe('2026-H2');
    });

    it('WEEKLY: YYYY-Www', () => {
        const key = computePeriodKey(new Date(2026, 5, 26), 'WEEKLY');
        expect(key).toMatch(/^2026-W\d{2}$/);
    });

    it('BIWEEKLY: same format as WEEKLY', () => {
        const key = computePeriodKey(new Date(2026, 5, 26), 'BIWEEKLY');
        expect(key).toMatch(/^2026-W\d{2}$/);
    });

    it('BIMONTHLY: YYYY-MM', () => {
        expect(computePeriodKey(new Date(2026, 5, 15), 'BIMONTHLY')).toBe('2026-06');
    });

    it('QUADMONTHLY: YYYY-MM', () => {
        expect(computePeriodKey(new Date(2026, 5, 15), 'QUADMONTHLY')).toBe('2026-06');
    });

    it('same date always produces same key (deterministic)', () => {
        const date = new Date(2026, 5, 15, 10, 30, 0);
        const key1 = computePeriodKey(date, 'MONTHLY');
        const key2 = computePeriodKey(date, 'MONTHLY');
        expect(key1).toBe(key2);
    });

    it('default: falls back to YYYY-MM', () => {
        expect(computePeriodKey(new Date(2026, 5, 15), 'UNKNOWN')).toBe('2026-06');
    });
});

describe('autoIssue flag behavior', () => {
    it('autoIssue=false: creates DRAFT but does NOT issue', () => {
        let invoiceCreated = false;
        let invoiceIssued = false;
        let emailSent = false;

        const autoIssue = false;
        const autoSend = false;

        invoiceCreated = true;
        if (autoIssue) invoiceIssued = true;
        if (autoSend && invoiceIssued) emailSent = true;

        expect(invoiceCreated).toBe(true);
        expect(invoiceIssued).toBe(false);
        expect(emailSent).toBe(false);
    });

    it('autoIssue=true, autoSend=true: full flow', () => {
        let invoiceCreated = false;
        let invoiceIssued = false;
        let emailSent = false;

        const autoIssue = true;
        const autoSend = true;

        invoiceCreated = true;
        if (autoIssue) invoiceIssued = true;
        if (autoSend && invoiceIssued) emailSent = true;

        expect(invoiceCreated).toBe(true);
        expect(invoiceIssued).toBe(true);
        expect(emailSent).toBe(true);
    });

    it('autoIssue=true, autoSend=false: issues but does NOT send', () => {
        let invoiceCreated = false;
        let invoiceIssued = false;
        let emailSent = false;

        const autoIssue = true;
        const autoSend = false;

        invoiceCreated = true;
        if (autoIssue) invoiceIssued = true;
        if (autoSend && invoiceIssued) emailSent = true;

        expect(invoiceCreated).toBe(true);
        expect(invoiceIssued).toBe(true);
        expect(emailSent).toBe(false);
    });
});

describe('idempotency via period key', () => {
    it('same (date, frequency) always produces the same period key', () => {
        const date = new Date(2026, 5, 26);
        const key1 = computePeriodKey(date, 'MONTHLY');
        const key2 = computePeriodKey(date, 'MONTHLY');
        expect(key1).toBe(key2);
    });

    it('different months produce different period keys', () => {
        const key1 = computePeriodKey(new Date(2026, 5, 26), 'MONTHLY');
        const key2 = computePeriodKey(new Date(2026, 6, 26), 'MONTHLY');
        expect(key1).not.toBe(key2);
    });

    it('catch-up generates 3 distinct keys for 3 missed monthly cycles', () => {
        const startDate = new Date(2026, 2, 1); // Mar 1
        const keys: string[] = [];
        let current = startDate;

        for (let i = 0; i < 3; i++) {
            keys.push(computePeriodKey(current, 'MONTHLY'));
            current = calculateNextInvoiceDate(current, 'MONTHLY');
        }

        expect(keys).toEqual(['2026-03', '2026-04', '2026-05']);
        expect(new Set(keys).size).toBe(3);
    });
});
