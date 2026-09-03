import { ConflictException, ForbiddenException } from '@nestjs/common';

import { ActionExtensionRegistry } from './actions/action-extensions';
import { ActionRegistry } from './actions/action-registry';
import { registerInvoiceActions } from './actions/invoice-actions';
import { ContributionRegistry } from './contributions/contribution-registry';
import * as countryPolicy from './country-policy/country-policy';
import { DocumentsService } from './documents.service';
import { buildInvoiceDescriptor } from './descriptors/invoice.descriptor';
import { DocumentTypeRegistry } from './descriptors/type-registry';
import { FieldKindRegistry, registerCoreFieldKinds } from './descriptors/field-kinds';
import * as persistence from './persistence';
import { EntityReferenceRegistry } from './references/reference-registry';
import { TransportRegistry } from './transports/transport-registry';

jest.mock('./persistence');
jest.mock('./country-policy/country-policy');

/**
 * TODO_CORRECTION.md C3 — proves the WIRING: `DocumentsService#runAction('invoice', 'cancel', ...)`
 * actually reads `correction-routes/cancel-policy.ts`'s own per-country map (never mocked here — the
 * REAL catalog, same "compose real country data, mock only Prisma" discipline
 * `documents.service.correction-routes.spec.ts` already holds), composes it through the exact same
 * 403/409 machinery `documents.service.country-policy.spec.ts` already proves for every OTHER action,
 * and that "cancelled" is a genuine TERMINAL status. The per-country MAP itself (who is founded, who
 * isn't, and WHY) is pinned exhaustively in `correction-routes/cancel-policy.spec.ts` — this file
 * only proves DocumentsService respects it.
 */
function buildService(webhooks?: { dispatch: jest.Mock }) {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildInvoiceDescriptor());

  const fieldKindRegistry = new FieldKindRegistry();
  registerCoreFieldKinds(fieldKindRegistry);

  const transportRegistry = new TransportRegistry();
  const actionRegistry = new ActionRegistry();
  registerInvoiceActions(actionRegistry, {
    transportRegistry,
    queueDispatcher: { enqueueAction: jest.fn() },
    webhooks,
  });

  return new DocumentsService(
    typeRegistry,
    fieldKindRegistry,
    actionRegistry,
    new ActionExtensionRegistry(),
    new EntityReferenceRegistry(),
    transportRegistry,
    new ContributionRegistry(),
  );
}

/** `runAction` validates `payload.data` against the FULL descriptor's own fields on EVERY action —
 *  regardless of whether the action touches `data` at all (see documents.service.ts's own comment on
 *  that gate) — so, exactly like `documents.service.invoice.spec.ts`'s own `validInvoiceData`, every
 *  "cancel" call below needs a genuinely valid invoice payload, never `{}`. */
const validInvoiceData = {
  client: 'client-1',
  issueDate: '2026-01-01',
  dueDate: '2026-01-31',
  currency: 'EUR',
  lines: [{ description: 'Widget', quantity: 2, unit: 'unit', unitPrice: 9.9, vatRate: '20' }],
};

function mockDocument(overrides: Partial<{ id: string; status: string }> = {}) {
  const document = {
    id: 'doc-1',
    typeId: 'invoice',
    status: 'sent',
    data: {},
    createdAt: new Date('2026-08-01'),
    updatedAt: new Date('2026-08-01'),
    number: 5,
    displayNumber: 'INV-2026-0005',
    ...overrides,
  };
  (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(document);
  return document;
}

describe('DocumentsService.runAction("invoice", "cancel") — TODO_CORRECTION.md C3', () => {
  afterEach(() => jest.resetAllMocks());

  describe('the per-country gate (correction-routes/cancel-policy.ts, real catalog)', () => {
    it('FR: cancel succeeds from "sent" — a status-only write, no field rewritten, no renumbering', async () => {
      (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue('FR');
      mockDocument({ status: 'sent' });
      (persistence.updateDocumentStatus as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'cancelled',
        data: {},
        createdAt: new Date('2026-08-01'),
        updatedAt: new Date('2026-08-02'),
        number: 5,
        displayNumber: 'INV-2026-0005',
      });

      const service = buildService();
      const result = await service.runAction('company-1', 'invoice', 'cancel', {
        documentId: 'doc-1',
        data: validInvoiceData,
      });

      expect(result.document?.status).toBe('cancelled');
      // The number is never touched by "cancel" (updateDocumentStatus only writes status) — the
      // exact "never reused, never renumbered" guarantee invoice-actions.ts's own header promises.
      expect(persistence.updateDocumentStatus).toHaveBeenCalledWith(
        'company-1',
        'invoice',
        'doc-1',
        'cancelled',
      );
    });

    it('DE and US: also an unrestricted local cancel (no restrictedToStatuses), same as FR', async () => {
      for (const countryCode of ['DE', 'US']) {
        (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue(countryCode);
        mockDocument({ status: 'sent' });
        (persistence.updateDocumentStatus as jest.Mock).mockResolvedValue({
          id: 'doc-1',
          typeId: 'invoice',
          status: 'cancelled',
          data: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        const service = buildService();
        const result = await service.runAction('company-1', 'invoice', 'cancel', {
          documentId: 'doc-1',
          data: validInvoiceData,
        });
        expect(result.document?.status).toBe('cancelled');
      }
    });

    it('PL: refused with 403 — CANCEL_AND_REPLACE is "required" but has no real local mechanism (corrective invoices only)', async () => {
      (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue('PL');
      mockDocument({ status: 'sent' });

      const service = buildService();
      const action = service.runAction('company-1', 'invoice', 'cancel', {
        documentId: 'doc-1',
        data: validInvoiceData,
      });

      await expect(action).rejects.toBeInstanceOf(ForbiddenException);
      await expect(action).rejects.toThrow(/PL/);
      expect(persistence.updateDocumentStatus).not.toHaveBeenCalled();
    });

    it('ES and MX: also refused with 403 — forbidden (ES) and authority-bound (MX), neither locally implementable', async () => {
      for (const countryCode of ['ES', 'MX']) {
        (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue(countryCode);
        mockDocument({ status: 'sent' });

        const service = buildService();
        const action = service.runAction('company-1', 'invoice', 'cancel', {
          documentId: 'doc-1',
          data: validInvoiceData,
        });
        await expect(action).rejects.toBeInstanceOf(ForbiddenException);
        expect(persistence.updateDocumentStatus).not.toHaveBeenCalled();
      }
    });

    it('a country with no correction-routes file at all (e.g. Belgium) never sees cancel either — 403, named', async () => {
      (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue('BE');
      mockDocument({ status: 'sent' });

      const service = buildService();
      const action = service.runAction('company-1', 'invoice', 'cancel', {
        documentId: 'doc-1',
        data: validInvoiceData,
      });
      await expect(action).rejects.toBeInstanceOf(ForbiddenException);
      await expect(action).rejects.toThrow(/BE/);
    });

    it('IT: refused with 409 (not 403) from "sent" — the route is founded, just narrowed to "send_failed" (post-scarto only)', async () => {
      (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue('IT');
      mockDocument({ status: 'sent' });

      const service = buildService();
      const action = service.runAction('company-1', 'invoice', 'cancel', {
        documentId: 'doc-1',
        data: validInvoiceData,
      });

      await expect(action).rejects.toBeInstanceOf(ConflictException);
      await expect(action).rejects.toThrow(/send_failed/);
      expect(persistence.updateDocumentStatus).not.toHaveBeenCalled();
    });

    it('IT: cancel SUCCEEDS from "send_failed" — exactly the status its own data founds', async () => {
      (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue('IT');
      mockDocument({ status: 'send_failed' });
      (persistence.updateDocumentStatus as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'cancelled',
        data: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const service = buildService();
      const result = await service.runAction('company-1', 'invoice', 'cancel', {
        documentId: 'doc-1',
        data: validInvoiceData,
      });
      expect(result.document?.status).toBe('cancelled');
    });
  });

  describe('the lifecycle (descriptors/invoice.descriptor.ts availableWhen — country-blind)', () => {
    beforeEach(() => {
      (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue('FR'); // founded — isolates the STATUS gate.
    });

    it('a "draft" invoice cannot be cancelled — 409, nothing to cancel before issuance', async () => {
      mockDocument({ status: 'draft' });
      const service = buildService();
      const action = service.runAction('company-1', 'invoice', 'cancel', {
        documentId: 'doc-1',
        data: validInvoiceData,
      });
      await expect(action).rejects.toBeInstanceOf(ConflictException);
      expect(persistence.updateDocumentStatus).not.toHaveBeenCalled();
    });

    it('a "sending" invoice (mid-flight) cannot be cancelled either — 409', async () => {
      mockDocument({ status: 'sending' });
      const service = buildService();
      const action = service.runAction('company-1', 'invoice', 'cancel', {
        documentId: 'doc-1',
        data: validInvoiceData,
      });
      await expect(action).rejects.toBeInstanceOf(ConflictException);
    });

    it('an ALREADY "cancelled" invoice cannot be cancelled again — 409, cancel is not idempotent by re-click', async () => {
      mockDocument({ status: 'cancelled' });
      const service = buildService();
      const action = service.runAction('company-1', 'invoice', 'cancel', {
        documentId: 'doc-1',
        data: validInvoiceData,
      });
      await expect(action).rejects.toBeInstanceOf(ConflictException);
      expect(persistence.updateDocumentStatus).not.toHaveBeenCalled();
    });
  });

  describe('"cancelled" is TERMINAL — the descriptor never declares a way out of it', () => {
    it('no action on the invoice descriptor names "cancelled" in its own availableWhen/transitions.from', () => {
      const descriptor = buildInvoiceDescriptor();
      for (const action of descriptor.actions) {
        if (action.availableWhen !== 'always') {
          expect(action.availableWhen).not.toContain('cancelled');
        }
        for (const transition of action.transitions ?? []) {
          if (transition.from !== 'always') {
            expect(transition.from).not.toContain('cancelled');
          }
        }
      }
    });
  });

  describe('DOCUMENT_CANCELLED webhook (schema.prisma WebhookEvent) — best-effort, fires once cancellation commits', () => {
    it('dispatches DOCUMENT_CANCELLED, carrying the row under the fixed "document" key, once "cancel" actually commits', async () => {
      (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue('FR');
      mockDocument({ status: 'sent' });
      const cancelled = {
        id: 'doc-1',
        typeId: 'invoice',
        status: 'cancelled',
        data: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (persistence.updateDocumentStatus as jest.Mock).mockResolvedValue(cancelled);
      const webhooks = { dispatch: jest.fn().mockResolvedValue(undefined) };

      const service = buildService(webhooks);
      await service.runAction('company-1', 'invoice', 'cancel', {
        documentId: 'doc-1',
        data: validInvoiceData,
      });

      expect(webhooks.dispatch).toHaveBeenCalledTimes(1);
      expect(webhooks.dispatch).toHaveBeenCalledWith(
        'DOCUMENT_CANCELLED',
        expect.objectContaining({
          documentId: 'doc-1',
          typeId: 'invoice',
          companyId: 'company-1',
          document: cancelled,
        }),
      );
    });

    it('a webhook DISPATCH failure never undoes the cancellation already committed', async () => {
      (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue('FR');
      mockDocument({ status: 'sent' });
      (persistence.updateDocumentStatus as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'cancelled',
        data: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const webhooks = { dispatch: jest.fn().mockRejectedValue(new Error('webhook endpoint down')) };

      const service = buildService(webhooks);
      const result = await service.runAction('company-1', 'invoice', 'cancel', {
        documentId: 'doc-1',
        data: validInvoiceData,
      });

      expect(result.document?.status).toBe('cancelled');
    });

    it('no webhooks wired at all (undefined) — cancel still succeeds, no crash', async () => {
      (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue('FR');
      mockDocument({ status: 'sent' });
      (persistence.updateDocumentStatus as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'cancelled',
        data: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const service = buildService(undefined);
      const result = await service.runAction('company-1', 'invoice', 'cancel', {
        documentId: 'doc-1',
        data: validInvoiceData,
      });
      expect(result.document?.status).toBe('cancelled');
    });
  });
});
