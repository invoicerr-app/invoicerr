import { ClientsService } from '@/modules/clients/clients.service';
import { MailService } from '@/mail/mail.service';

import { buildPurchaseOrderDescriptor } from '../descriptors/purchase-order.descriptor';
import { DocumentTypeRegistry } from '../descriptors/type-registry';
import * as archiveOnSend from '../archive/archive-on-send';
import * as persistence from '../persistence';
import { EntityReferenceRegistry } from '../references/reference-registry';
import * as renderInstancePdf from '../rendering/render-instance-pdf';
import * as reportOnSend from '../reporting/report-on-send';
import { ActionRegistry } from './action-registry';
import * as companyEmailTemplates from './company-email-templates';
import { registerPurchaseOrderActions } from './purchase-order-actions';

jest.mock('../persistence');
jest.mock('../numbering/take-number');
jest.mock('../archive/archive-on-send');
jest.mock('../reporting/report-on-send');
jest.mock('../rendering/render-instance-pdf');
jest.mock('./company-email-templates');

/**
 * TODO_FEATURES.md rank 19 ("bons de commande") — proves the purchase order's own GLUE (this file),
 * never re-proving the shared engines it reuses (`runAsyncSendAction` — async-send.spec.ts's own job;
 * `sendDocumentInstanceEmail` — send-document-email.spec.ts's own job). Every boundary this handler
 * actually crosses (persistence, numbering, rendering, archiving, reporting) is mocked at its own
 * entry point, the same discipline every other spec in this directory already holds.
 */
function buildDeps() {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildPurchaseOrderDescriptor());
  const clientsService = { getClientById: jest.fn() } as unknown as ClientsService;
  const mailService = { sendForCompany: jest.fn().mockResolvedValue({ message: 'Email sent successfully' }) };
  const queueDispatcher = { enqueueAction: jest.fn().mockResolvedValue(undefined) };

  const registry = new ActionRegistry();
  registerPurchaseOrderActions(registry, {
    clientsService,
    mailService: mailService as unknown as MailService,
    typeRegistry,
    referenceRegistry: new EntityReferenceRegistry(),
    queueDispatcher,
  });

  return { registry, clientsService, mailService, queueDispatcher, typeRegistry };
}

const FAKE_PDF = Buffer.from('%PDF-fake-purchase-order');

function mockSuccessfulRender() {
  (renderInstancePdf.renderDocumentInstance as jest.Mock).mockResolvedValue({
    pdf: FAKE_PDF,
    totals: {
      currency: 'EUR',
      lines: [],
      netMinor: 0,
      vatMinor: 0,
      grossMinor: 0,
      vatBreakdown: [],
      warnings: [],
    },
    referenceLabels: { supplier: 'Acme Supplies' },
    companyName: 'Buyer Corp',
    language: 'en',
  });
}

describe('registerPurchaseOrderActions', () => {
  afterEach(() => jest.resetAllMocks());

  it('"save-draft" persists via the generic mechanism, exactly like every other type', async () => {
    const { registry } = buildDeps();
    (persistence.upsertDocument as jest.Mock).mockResolvedValue({
      id: 'po-1',
      typeId: 'purchase-order',
      status: 'draft',
      data: { supplier: 'client-1' },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const handler = registry.resolve('purchase-order', 'save-draft');
    expect(handler).toBeDefined();
    const result = await handler!({
      companyId: 'company-1',
      typeId: 'purchase-order',
      data: { supplier: 'client-1' },
      params: {},
    });

    expect(persistence.upsertDocument).toHaveBeenCalledWith(
      'company-1',
      'purchase-order',
      undefined,
      'draft',
      { supplier: 'client-1' },
    );
    expect(result.changed).toBe(true);
  });

  it('the "send" recipient default resolves from the SUPPLIER field, not "client"', async () => {
    const { registry, clientsService } = buildDeps();
    (clientsService.getClientById as jest.Mock).mockResolvedValue({
      id: 'supplier-1',
      contactEmail: 'orders@supplier.example.com',
    });

    const resolver = registry.resolveParamsDefaults('purchase-order', 'send');
    expect(resolver).toBeDefined();
    const defaults = await resolver!({
      companyId: 'company-1',
      typeId: 'purchase-order',
      data: { supplier: 'supplier-1' },
      params: {},
    });

    expect(clientsService.getClientById).toHaveBeenCalledWith('company-1', 'supplier-1');
    expect(defaults).toEqual({ recipient: 'orders@supplier.example.com' });
  });

  it('the "send" recipient default is empty when the supplier has no contact email on file', async () => {
    const { registry, clientsService } = buildDeps();
    (clientsService.getClientById as jest.Mock).mockResolvedValue({ id: 'supplier-1', contactEmail: null });

    const resolver = registry.resolveParamsDefaults('purchase-order', 'send');
    const defaults = await resolver!({
      companyId: 'company-1',
      typeId: 'purchase-order',
      data: { supplier: 'supplier-1' },
      params: {},
    });

    expect(defaults).toEqual({});
  });

  it('"send" carries the PDF as an attachment, via the SAME shared mechanism the quote uses', async () => {
    const { registry, mailService, queueDispatcher } = buildDeps();
    mockSuccessfulRender();
    (companyEmailTemplates.getCompanyDocumentEmailTemplates as jest.Mock).mockResolvedValue({});
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
      id: 'po-1',
      typeId: 'purchase-order',
      status: 'sending',
      data: { supplier: 'supplier-1' },
      createdAt: new Date(),
      updatedAt: new Date(),
      number: 7,
      displayNumber: 'PURCHASE-ORDER-2026-0007',
    });
    (persistence.updateDocumentStatus as jest.Mock).mockResolvedValue({
      id: 'po-1',
      typeId: 'purchase-order',
      status: 'sent',
      data: { supplier: 'supplier-1' },
      createdAt: new Date(),
      updatedAt: new Date(),
      number: 7,
      displayNumber: 'PURCHASE-ORDER-2026-0007',
    });

    const handler = registry.resolve('purchase-order', 'send');
    const result = await handler!({
      companyId: 'company-1',
      documentId: 'po-1',
      typeId: 'purchase-order',
      data: { supplier: 'supplier-1' },
      params: { recipient: 'orders@supplier.example.com' },
    });

    expect(mailService.sendForCompany).toHaveBeenCalledWith(
      'company-1',
      expect.objectContaining({
        to: 'orders@supplier.example.com',
        attachments: [
          expect.objectContaining({
            filename: 'PURCHASE-ORDER-2026-0007.pdf',
            contentType: 'application/pdf',
          }),
        ],
      }),
    );
    expect(result.document?.status).toBe('sent');
    expect(archiveOnSend.archiveDeliveredArtifactsIfAny).toHaveBeenCalled();
    expect(reportOnSend.reportOnSendIfObligated).toHaveBeenCalledWith(
      expect.objectContaining({ typeId: 'purchase-order', documentId: 'po-1', companyId: 'company-1' }),
    );
    expect(queueDispatcher.enqueueAction).not.toHaveBeenCalled(); // already "sending" — phase 2, no re-enqueue
  });

  it('"cancel-order" flips the status to "cancelled" and touches nothing else', async () => {
    const { registry } = buildDeps();
    (persistence.updateDocumentStatus as jest.Mock).mockResolvedValue({
      id: 'po-1',
      typeId: 'purchase-order',
      status: 'cancelled',
      data: { supplier: 'supplier-1' },
      createdAt: new Date(),
      updatedAt: new Date(),
      number: 7,
      displayNumber: 'PURCHASE-ORDER-2026-0007',
    });

    const handler = registry.resolve('purchase-order', 'cancel-order');
    expect(handler).toBeDefined();
    const result = await handler!({
      companyId: 'company-1',
      documentId: 'po-1',
      typeId: 'purchase-order',
      data: {},
      params: {},
    });

    expect(persistence.updateDocumentStatus).toHaveBeenCalledWith(
      'company-1',
      'purchase-order',
      'po-1',
      'cancelled',
    );
    expect(result.document?.status).toBe('cancelled');
    expect(result.changed).toBe(true);
  });

  it('"cancel-order" refuses a never-saved record rather than trusting availableWhen alone', async () => {
    const { registry } = buildDeps();
    const handler = registry.resolve('purchase-order', 'cancel-order');

    await expect(
      handler!({ companyId: 'company-1', typeId: 'purchase-order', data: {}, params: {} }),
    ).rejects.toThrow(/has not been saved yet/);
    expect(persistence.updateDocumentStatus).not.toHaveBeenCalled();
  });
});
