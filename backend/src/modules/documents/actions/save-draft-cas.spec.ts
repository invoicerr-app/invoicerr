/**
 * Reviewer finding #1 on the #468 lock: "save-draft" used to persist unconditionally once past the
 * `lockedStatuses` check in `documents.service.ts#runAction` - a genuine TOCTOU. `runAction` reads a
 * record's status once, several `await`s before any handler's own write ever runs; if a concurrent
 * "send" (draft -> sending) or an OTP signature (sent -> signed) reached the row FIRST, the
 * unconditional `upsertDocument` call `performSaveDraft` used to make would still silently rewrite it
 * back to "draft" with whatever the stale caller submitted - exactly the race a country-policy-only
 * defense could never close (see `descriptors/types.ts`'s own `lockedStatuses` header).
 *
 * The fix threads `runAction`'s own `allowedFromStatuses` (lifecycle.ts#allowedFromStatuses: the
 * type's declared `statuses` minus the save-draft action's `lockedStatuses`) through every "save-draft"
 * handler, so the write becomes a compare-and-swap (`persistence.ts#upsertDocument`'s own
 * `fromStatuses`) instead of an unconditional one. The lists below come from that same function over
 * the real shipped descriptors, never from a hand-typed array.
 *
 * Real Postgres, no mocking: read the status ("runAction's own read"), let another write win in
 * between (a raw `prisma.documentInstance.update`, standing in for a concurrent "send" or OTP
 * signature), then call the save-draft handler with the context `runAction` captured at its own read.
 * The call must throw `ConflictException` and leave the row exactly as the concurrent write left it.
 * Removing `fromStatuses` from `performSaveDraft`'s `upsertDocument` call makes all three tests fail.
 */
import { ConflictException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { buildCreditNoteDescriptor } from '../descriptors/credit-note.descriptor';
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { allowedFromStatuses } from '../descriptors/lifecycle';
import { buildQuoteDescriptor } from '../descriptors/quote.descriptor';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { ActionRegistry } from './action-registry';
import { registerCreditNoteActions } from './credit-note-actions';
import { performSaveDraft } from './generic-actions';
import { registerInvoiceActions } from './invoice-actions';
import { TransportRegistry } from '../transports/transport-registry';

// Every save-draft handler under test only ever reaches "send"'s own enqueue path through a real
// send call, which none of these tests make - a stub satisfying the interface's one required method
// is all `registerInvoiceActions`/`registerCreditNoteActions` need to REGISTER their handlers at all.
const queueDispatcher = { enqueueAction: async () => undefined };

// The exact list `documents.service.ts#runAction` hands to the handler, computed by the SAME function
// from the REAL shipped descriptor - never a hand-typed array that could drift from what production
// passes.
function saveDraftAllowedFrom(descriptor: DocumentTypeDescriptor): string[] {
  const saveDraft = descriptor.actions.find((a) => a.id === 'save-draft');
  if (!saveDraft) throw new Error(`${descriptor.id} declares no save-draft`);
  const list = allowedFromStatuses(descriptor, saveDraft);
  if (!list) throw new Error(`${descriptor.id} declares no statuses`);
  return list;
}

describe("save-draft CAS - a status that moved on between runAction's read and the write is refused, never silently overwritten", () => {
  let companyId: string;

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: {
        name: 'Save Draft CAS Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 rue de Test',
        postalCode: '75000',
        city: 'Paris',
        // Deliberately unresolvable to an ISO code (see country-policy.ts's own guessCountryCode)-
        // keeps every country-policy/correction-routes side effect (which this suite does not test)
        // out of the way, the same "this concern is unrelated to what this file tests" posture
        // documents.service.invoice.spec.ts already holds for its own B2G/currency-rates mocks.
        country: 'Nowhereland',
        phone: '+33100000000',
        email: `save-draft-cas-${Date.now()}@example.com`,
      },
    });
    companyId = company.id;
  });

  afterAll(async () => {
    await prisma.documentInstance.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
  });

  it('the generic mechanism (quote) refuses the stale write when an OTP signature lands in between', async () => {
    const created = await performSaveDraft(companyId, 'quote', undefined, { description: 'v1 - original' });
    const documentId = created.document!.id;
    await prisma.documentInstance.update({ where: { id: documentId }, data: { status: 'sent' } });

    // `runAction`'s OWN read, captured the instant it happens: "sent", which a quote may still re-edit.
    const readAtCheckTime = await prisma.documentInstance.findUnique({ where: { id: documentId } });
    expect(readAtCheckTime?.status).toBe('sent');

    // THE RACE: the client's OTP signature (signatures.service.ts#markSigned) wins and moves the quote
    // to "signed" several `await`s after that read, applied directly to the row exactly as that
    // concurrent request would leave it.
    await prisma.documentInstance.update({ where: { id: documentId }, data: { status: 'signed' } });

    const allowed = saveDraftAllowedFrom(buildQuoteDescriptor());
    expect(allowed).toContain('sent');
    expect(allowed).not.toContain('signed');
    await expect(
      performSaveDraft(companyId, 'quote', documentId, { description: 'v2 - the race' }, undefined, allowed),
    ).rejects.toThrow(ConflictException);

    const row = await prisma.documentInstance.findUnique({ where: { id: documentId } });
    expect(row?.status).toBe('signed');
    expect((row?.data as Record<string, unknown>).description).toBe('v1 - original');
  });

  it("the invoice's own save-draft handler (registerInvoiceSaveDraftAction) honors the same CAS", async () => {
    const registry = new ActionRegistry();
    registerInvoiceActions(registry, { transportRegistry: new TransportRegistry(), queueDispatcher });
    const handler = registry.resolve('invoice', 'save-draft')!;

    const created = await performSaveDraft(companyId, 'invoice', undefined, { issueDate: '2026-01-01' });
    const documentId = created.document!.id;

    // THE RACE - a concurrent "send" already moved this invoice on by the time this call's own write
    // is attempted, even though the context below still carries the STALE "draft" this action's own
    // defense-in-depth check (registerInvoiceSaveDraftAction's own `ctx.currentStatus` comparison)
    // would otherwise wave through.
    await prisma.documentInstance.update({ where: { id: documentId }, data: { status: 'sent' } });

    await expect(
      handler({
        companyId,
        typeId: 'invoice',
        documentId,
        data: { issueDate: '2026-01-01', client: 'rewritten-by-the-race' },
        params: {},
        currentStatus: 'draft', // the stale read `runAction` captured before the race
        allowedFromStatuses: saveDraftAllowedFrom(buildInvoiceDescriptor()),
      }),
    ).rejects.toThrow(ConflictException);

    const row = await prisma.documentInstance.findUnique({ where: { id: documentId } });
    expect(row?.status).toBe('sent');
    expect((row?.data as Record<string, unknown>).client).toBeUndefined();
  });

  it("the credit note's own save-draft handler (registerCreditNoteSaveDraftAction) honors the same CAS", async () => {
    const registry = new ActionRegistry();
    registerCreditNoteActions(registry, { queueDispatcher });
    const handler = registry.resolve('credit-note', 'save-draft')!;

    const created = await performSaveDraft(companyId, 'credit-note', undefined, {
      lines: [{ description: 'Refund', quantity: 1, unitPrice: 10, vatRate: 0 }],
      currency: 'EUR',
    });
    const documentId = created.document!.id;

    await prisma.documentInstance.update({ where: { id: documentId }, data: { status: 'sent' } });

    await expect(
      handler({
        companyId,
        typeId: 'credit-note',
        documentId,
        data: {
          lines: [{ description: 'rewritten-by-the-race', quantity: 99, unitPrice: 999, vatRate: 0 }],
          currency: 'EUR',
        },
        params: {},
        currentStatus: 'draft',
        allowedFromStatuses: saveDraftAllowedFrom(buildCreditNoteDescriptor()),
      }),
    ).rejects.toThrow(ConflictException);

    const row = await prisma.documentInstance.findUnique({ where: { id: documentId } });
    expect(row?.status).toBe('sent');
    expect((row?.data as Record<string, unknown>).lines).toEqual([
      { description: 'Refund', quantity: 1, unitPrice: 10, vatRate: 0 },
    ]);
  });
});
