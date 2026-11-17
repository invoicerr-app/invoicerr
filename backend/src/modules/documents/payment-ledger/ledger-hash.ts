import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Hashing and signing of payment-ledger records. Each record's hash covers its own fields and the
 * previous record's hash, so changing or removing any sealed record breaks every hash after it.
 * The signature is an HMAC of that hash: it proves the record was sealed by this instance, which a
 * plain hash recomputed by whoever edited the database cannot.
 */

export const PAYMENT_LEDGER_HASH_VERSION = 1;

const SIGNING_LABEL = 'invoicerr/payment-ledger/v1';

/** The fields a payment's hash covers. Dates and the decimal rate are passed as strings so the
 *  digest never depends on how a driver happens to render them. */
export interface PaymentHashInput {
  companyId: string;
  ledgerSequence: number;
  id: string;
  documentId: string;
  amountMinor: number;
  currency: string;
  documentAmountMinor: number;
  conversionRate: string | null;
  conversionRateAsOf: Date | null;
  conversionSource: string | null;
  method: string | null;
  paidAt: Date;
  note: string | null;
  createdAt: Date;
  reversesPaymentId: string | null;
  previousHash: string | null;
}

export interface ClosureHashInput {
  companyId: string;
  sequence: number;
  kind: string;
  periodStart: Date;
  periodEnd: Date;
  paymentCount: number;
  firstPaymentSequence: number | null;
  lastPaymentSequence: number | null;
  totals: Record<string, number>;
  perpetualTotals: Record<string, number>;
  previousHash: string | null;
}

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

function sortedTotals(totals: Record<string, number>): [string, number][] {
  return Object.keys(totals)
    .sort()
    .map((currency) => [currency, totals[currency]]);
}

/** Field order is fixed by this array literal, never by object key order. */
export function canonicalPayment(input: PaymentHashInput): string {
  return JSON.stringify([
    'payment',
    PAYMENT_LEDGER_HASH_VERSION,
    input.companyId,
    input.ledgerSequence,
    input.id,
    input.documentId,
    input.amountMinor,
    input.currency,
    input.documentAmountMinor,
    input.conversionRate,
    iso(input.conversionRateAsOf),
    input.conversionSource,
    input.method,
    iso(input.paidAt),
    input.note,
    iso(input.createdAt),
    input.reversesPaymentId,
    input.previousHash,
  ]);
}

export function canonicalClosure(input: ClosureHashInput): string {
  return JSON.stringify([
    'closure',
    PAYMENT_LEDGER_HASH_VERSION,
    input.companyId,
    input.sequence,
    input.kind,
    iso(input.periodStart),
    iso(input.periodEnd),
    input.paymentCount,
    input.firstPaymentSequence,
    input.lastPaymentSequence,
    sortedTotals(input.totals),
    sortedTotals(input.perpetualTotals),
    input.previousHash,
  ]);
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Same derivation as `lib/invitation-code.ts`: a purpose-specific key from the instance secret, so
 *  rotating that secret makes earlier signatures fail verification while the hash chain still holds. */
function signingKey(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET || process.env.JWT_SECRET || '';
  return createHmac('sha256', secret).update(SIGNING_LABEL).digest();
}

export function signLedgerHash(hash: string): string {
  return createHmac('sha256', signingKey()).update(hash).digest('hex');
}

export function isValidLedgerSignature(hash: string, signature: string | null): boolean {
  if (!signature) return false;
  const expected = Buffer.from(signLedgerHash(hash), 'hex');
  const actual = Buffer.from(signature, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
