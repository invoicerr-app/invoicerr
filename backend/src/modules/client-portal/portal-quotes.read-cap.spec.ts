/**
 * The quote list a client sees in its portal, over a company whose quote history crosses the read
 * cap.
 *
 * `portal.service.spec.ts` next door mocks `../documents/persistence` wholesale — right for the
 * access-control boundary it proves, but it means a capped read there returns exactly the array the
 * spec wrote and the cap is invisible. Here the real read runs against the in-memory table: 600
 * quotes belong to one client while a busier client's 600 sit on top of them by recency, which is
 * precisely how a capped, company-wide read emptied one client's portal.
 *
 * `DocumentsService` is built for real (registries + real descriptors, the same shape
 * `portal.service.spec.ts` uses) so the client-visible statuses come from the REAL quote descriptor.
 */
import { vi } from 'vitest';

import {
  documentInstanceRow,
  seedDocumentInstances,
} from '../documents/__tests__/fake-document-instance-table';
import { ActionExtensionRegistry } from '../documents/actions/action-extensions';
import { ContributionRegistry } from '../documents/contributions/contribution-registry';
import { ActionRegistry } from '../documents/actions/action-registry';
import { buildCreditNoteDescriptor } from '../documents/descriptors/credit-note.descriptor';
import { registerCoreFieldKinds, FieldKindRegistry } from '../documents/descriptors/field-kinds';
import { buildInvoiceDescriptor } from '../documents/descriptors/invoice.descriptor';
import { buildQuoteDescriptor } from '../documents/descriptors/quote.descriptor';
import { DocumentTypeRegistry } from '../documents/descriptors/type-registry';
import { DocumentsService } from '../documents/documents.service';
import { PaymentSessionsService } from '../documents/payments/payment-sessions.service';
import { EntityReferenceRegistry } from '../documents/references/reference-registry';
import { ROW_ID_KEY } from '../documents/row-selection/row-selection';
import { SignaturesService } from '../documents/signatures/signatures.service';
import { TransportRegistry } from '../documents/transports/transport-registry';

vi.mock('@/prisma/prisma.service', async () => {
  const module = await import('../documents/__tests__/fake-document-instance-table');
  return { default: module.fakePrismaClient, prisma: module.fakePrismaClient };
});

const { PortalService } = await import('./portal.service');

/** Past the 500-row cap this read used to apply. */
const QUOTE_COUNT = 600;
/** One line of 100.00 EUR at 0% VAT -> 10 000 minor gross per quote. */
const GROSS_MINOR_PER_QUOTE = 10_000;

function quoteData(clientId: string) {
  return {
    client: clientId,
    issueDate: '2026-01-01',
    dueDate: '2026-02-01',
    currency: 'EUR',
    lines: [{ [ROW_ID_KEY]: 'line-1', description: 'Widget', quantity: 1, unitPrice: 100, vatRate: '0' }],
  };
}

function buildService(): InstanceType<typeof PortalService> {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildQuoteDescriptor());
  typeRegistry.register(buildInvoiceDescriptor());
  typeRegistry.register(buildCreditNoteDescriptor());

  const fieldKindRegistry = new FieldKindRegistry();
  registerCoreFieldKinds(fieldKindRegistry);

  const documentsService = new DocumentsService(
    typeRegistry,
    fieldKindRegistry,
    new ActionRegistry(),
    new ActionExtensionRegistry(),
    new EntityReferenceRegistry(),
    new TransportRegistry(),
    new ContributionRegistry(),
  );
  return new PortalService(
    documentsService,
    {} as unknown as SignaturesService,
    {} as unknown as PaymentSessionsService,
  );
}

beforeEach(() => {
  seedDocumentInstances([
    ...Array.from({ length: QUOTE_COUNT }, (_, index) =>
      documentInstanceRow({
        id: `mine-${String(index).padStart(5, '0')}`,
        typeId: 'quote',
        status: 'sent',
        displayNumber: `Q-${index}`,
        // This client's quotes are the OLDER ones — what a capped, recency-ordered company-wide read
        // pushed out entirely.
        updatedAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
        data: quoteData('client-1'),
      }),
    ),
    ...Array.from({ length: QUOTE_COUNT }, (_, index) =>
      documentInstanceRow({
        id: `busy-${String(index).padStart(5, '0')}`,
        typeId: 'quote',
        status: 'sent',
        updatedAt: new Date(Date.UTC(2026, 6, 1, 0, index)),
        data: quoteData('client-2'),
      }),
    ),
    // Never client-visible: a draft of this very client.
    documentInstanceRow({ id: 'draft-1', typeId: 'quote', status: 'draft', data: quoteData('client-1') }),
  ]);
});

describe('PortalService.listQuotes past the read cap', () => {
  it('shows the client every quote it may see, whatever the rest of the company has been doing', async () => {
    const rows = await buildService().listQuotes('company-1', 'client-1');

    expect(rows).toHaveLength(QUOTE_COUNT);
    expect(rows.reduce((total, row) => total + row.amountMinor, 0)).toBe(QUOTE_COUNT * GROSS_MINOR_PER_QUOTE);
  });

  it('still shows nothing belonging to another client, and no draft', async () => {
    const rows = await buildService().listQuotes('company-1', 'client-1');

    expect(rows.every((row) => row.id.startsWith('mine-'))).toBe(true);
    expect(rows.every((row) => row.status === 'sent')).toBe(true);
  });
});
