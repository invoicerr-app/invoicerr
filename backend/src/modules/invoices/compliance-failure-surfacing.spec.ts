/**
 * The four defects behind "I clicked send and there is no error anywhere".
 *
 * Reported from the running application, and no test saw any of them: an invoice with no lines was
 * issuable, the build failure that followed had no type so the queue retried it into silence, the
 * spent job then swallowed every later send, and the one event the system does record was not among
 * the ones the screen looks at. Four layers, each hiding the one beneath.
 */
import { BadRequestException } from '@nestjs/common';
import { deriveComplianceError, resolveInvoiceLinesOrThrow } from './invoices.helpers';
import { FormatBuildError } from '@/compliance/execution/types';

describe('BR-16 — an invoice with no lines must not be issuable', () => {
  it('refuses an empty line list, and says why in terms the user can act on', () => {
    // The state this prevents is the worst one the product can reach: the document takes a number
    // from the gapless series, moves to ISSUED, and can then NEVER be built — the EN 16931 schema
    // refuses it before any XML exists. No artifact, no transmission, no authority, ever.
    expect(() => resolveInvoiceLinesOrThrow([])).toThrow(BadRequestException);
    expect(() => resolveInvoiceLinesOrThrow([])).toThrow(/BR-16/);
    expect(() => resolveInvoiceLinesOrThrow([])).toThrow(/never be transmitted/);
  });

  it('refuses an absent line list too — undefined is not "no opinion" here', () => {
    expect(() => resolveInvoiceLinesOrThrow(undefined)).toThrow(BadRequestException);
    expect(() => resolveInvoiceLinesOrThrow(null)).toThrow(BadRequestException);
  });

  it('accepts one line, which is all the rule asks for', () => {
    expect(() => resolveInvoiceLinesOrThrow([{}])).not.toThrow();
  });
});

describe('deriveComplianceError — the screen sees every kind of failure, not one', () => {
  const at = new Date('2026-09-02T10:00:00Z');

  it('surfaces a validation block, which used to be recorded into silence', () => {
    // `VALIDATION_BLOCKED` exists so a user learns their invoice was refused BEFORE any
    // transmission. It was written to the event log and read by nothing.
    expect(deriveComplianceError([{ type: 'VALIDATION_BLOCKED', at, detail: 'BR-Z-02 fired' }])).toBe(
      'BR-Z-02 fired',
    );
  });

  it('surfaces a build failure, and explains it when the event carries no detail', () => {
    expect(deriveComplianceError([{ type: 'BUILD_FAILED', at }])).toMatch(/could not be produced/);
  });

  it('still surfaces a wiring failure — the one type it already knew', () => {
    expect(deriveComplianceError([{ type: 'WIRING_FAILED', at, detail: 'archive port down' }])).toBe(
      'archive port down',
    );
  });

  it('says nothing when the last event is a success — a fixed failure is not a failure', () => {
    // Only the LAST event is consulted, on purpose: showing a superseded failure would be its own
    // kind of lie.
    expect(
      deriveComplianceError([
        { type: 'BUILD_FAILED', at, detail: 'boom' },
        { type: 'TRANSMITTED', at: new Date('2026-09-02T11:00:00Z') },
      ]),
    ).toBeNull();
  });

  it('says nothing on an empty or absent log', () => {
    expect(deriveComplianceError([])).toBeNull();
    expect(deriveComplianceError(undefined)).toBeNull();
  });
});

describe('FormatBuildError — a deterministic failure that can be recognised as one', () => {
  it('carries the syntax, the role and whatever detail the renderer could give', () => {
    // Without a type, this arrived at the transmit processor as an anonymous library error and fell
    // through its "any OTHER error is transient" branch — three retries on something that could
    // never succeed, then nothing on screen.
    const err = new FormatBuildError('could not build EN16931_CII/AUTHORITATIVE: validation failed', 'EN16931_CII', 'AUTHORITATIVE', ['/cac:InvoiceLine must NOT have fewer than 1 items']);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('FormatBuildError');
    expect(err.syntax).toBe('EN16931_CII');
    expect(err.role).toBe('AUTHORITATIVE');
    expect(err.details[0]).toContain('InvoiceLine');
  });
});
