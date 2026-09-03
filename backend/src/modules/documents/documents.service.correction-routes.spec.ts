import { ConflictException, NotFoundException, NotImplementedException } from '@nestjs/common';

import { ActionExtensionRegistry } from './actions/action-extensions';
import { ActionRegistry } from './actions/action-registry';
import { ContributionRegistry } from './contributions/contribution-registry';
import * as countryPolicy from './country-policy/country-policy';
import { DocumentsService } from './documents.service';
import { buildInvoiceDescriptor } from './descriptors/invoice.descriptor';
import { buildQuoteDescriptor } from './descriptors/quote.descriptor';
import { DocumentTypeRegistry } from './descriptors/type-registry';
import { FieldKindRegistry, registerCoreFieldKinds } from './descriptors/field-kinds';
import * as persistence from './persistence';
import { EntityReferenceRegistry } from './references/reference-registry';
import { TransportRegistry } from './transports/transport-registry';

jest.mock('./persistence');
jest.mock('./country-policy/country-policy');

/**
 * TODO_CORRECTION.md C1 — proves `DocumentsService#getCorrectionRoutes` composes its FOUR gates (type
 * known -> 404, type is "invoice" -> 501, status not draft -> 409, seller country has a file -> 404
 * named) against the REAL correction-routes catalog (never mocked — a passing test here is a genuine
 * read of docs/compliance/CORRECTION-ROUTES.yaml's own transcription), the same "compose real country
 * data, mock only Prisma" discipline `documents.service.formats.spec.ts` already holds for
 * `downloadDocumentFormat`.
 */
function buildService() {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildInvoiceDescriptor());
  // Registered too, but never given a real "invoice" — this is exactly the type gate 2 (501) exists to
  // catch: a real, known, non-invoice type.
  typeRegistry.register(buildQuoteDescriptor());

  const fieldKindRegistry = new FieldKindRegistry();
  registerCoreFieldKinds(fieldKindRegistry);

  const service = new DocumentsService(
    typeRegistry,
    fieldKindRegistry,
    new ActionRegistry(),
    new ActionExtensionRegistry(),
    new EntityReferenceRegistry(),
    new TransportRegistry(),
    new ContributionRegistry(),
  );
  return { service };
}

function mockDocument(overrides: Partial<{ status: string }> = {}) {
  (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
    id: 'doc-1',
    typeId: 'invoice',
    status: 'sent',
    data: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
}

describe("DocumentsService#getCorrectionRoutes — TODO_CORRECTION.md C1's four gates", () => {
  afterEach(() => jest.resetAllMocks());

  it('gate 1 (404): a typeId nobody registered at all', async () => {
    (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue('FR');
    const { service } = buildService();
    await expect(service.getCorrectionRoutes('company-1', 'nonsense', 'doc-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('gate 2 (501): a real, known type that is not "invoice"', async () => {
    (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue('FR');
    const { service } = buildService();
    await expect(service.getCorrectionRoutes('company-1', 'quote', 'doc-1')).rejects.toThrow(
      NotImplementedException,
    );
    await expect(service.getCorrectionRoutes('company-1', 'quote', 'doc-1')).rejects.toThrow(
      /"invoice" only today/,
    );
    // Never even loads the document for an unsupported type — no wasted DB read past the type gate.
    expect(persistence.findOwnedDocument).not.toHaveBeenCalled();
  });

  it('gate 3 (404): the invoice does not exist for this company', async () => {
    (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue('FR');
    (persistence.findOwnedDocument as jest.Mock).mockRejectedValue(new NotFoundException('nope'));
    const { service } = buildService();
    await expect(service.getCorrectionRoutes('company-1', 'invoice', 'doc-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('gate 4 (409): a "draft" invoice — nothing issued yet to correct', async () => {
    (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue('FR');
    mockDocument({ status: 'draft' });
    const { service } = buildService();
    await expect(service.getCorrectionRoutes('company-1', 'invoice', 'doc-1')).rejects.toThrow(
      ConflictException,
    );
    await expect(service.getCorrectionRoutes('company-1', 'invoice', 'doc-1')).rejects.toThrow(/"draft"/);
    // The country lookup never even runs for a draft — the 409 is structural, not data-dependent.
  });

  it.each([
    'sending',
    'sent',
    'send_failed',
  ])('gate 4 passes for a "%s" (issued) invoice — only "draft" is refused', async (status) => {
    (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue('FR');
    mockDocument({ status });
    const { service } = buildService();
    const decision = await service.getCorrectionRoutes('company-1', 'invoice', 'doc-1');
    expect(decision.countryCode).toBe('FR');
  });

  it('gate 5 (404, NAMED): the seller country has no correction-routes file at all', async () => {
    (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue('BE');
    mockDocument({});
    const { service } = buildService();
    await expect(service.getCorrectionRoutes('company-1', 'invoice', 'doc-1')).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.getCorrectionRoutes('company-1', 'invoice', 'doc-1')).rejects.toThrow(
      /Aucune règle de correction déclarée pour BE/,
    );
  });

  it('gate 5 (404, NAMED): an unresolved seller country (no code at all)', async () => {
    (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue(undefined);
    mockDocument({});
    const { service } = buildService();
    await expect(service.getCorrectionRoutes('company-1', 'invoice', 'doc-1')).rejects.toThrow(
      /Aucune règle de correction déclarée/,
    );
  });

  it('the happy path — FR seller: INTERNAL_CREDIT_NOTE is required and implemented; the buyer-composition limitation is always present', async () => {
    (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue('FR');
    mockDocument({});
    const { service } = buildService();
    const decision = await service.getCorrectionRoutes('company-1', 'invoice', 'doc-1');

    expect(decision.countryCode).toBe('FR');
    const internalCreditNote = decision.routes.find((r) => r.routeId === 'INTERNAL_CREDIT_NOTE')!;
    expect(internalCreditNote.status).toBe('required');
    expect(internalCreditNote.implemented).toBe(true);
    expect(decision.limitation).toMatch(/buyer/i);

    // Every OTHER route stays honestly unimplemented, whatever its own status — EXCEPT
    // CANCEL_AND_REPLACE (TODO_CORRECTION.md C3): France is one of the four seller countries
    // `correction-routes/cancel-policy.ts` founds a real local cancellation for — see that file's own
    // header, and `correction-routes/correction-routes.spec.ts` for the full per-country pinning.
    for (const route of decision.routes) {
      if (route.routeId !== 'INTERNAL_CREDIT_NOTE' && route.routeId !== 'CANCEL_AND_REPLACE') {
        expect(route.implemented).toBe(false);
      }
    }
    expect(decision.routes.find((r) => r.routeId === 'CANCEL_AND_REPLACE')!.implemented).toBe(true);
  });

  it('the happy path — PL seller: INTERNAL_CREDIT_NOTE is forbidden, the canonical FR/PL inversion, still surfaced (never hidden)', async () => {
    (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue('PL');
    mockDocument({});
    const { service } = buildService();
    const decision = await service.getCorrectionRoutes('company-1', 'invoice', 'doc-1');

    expect(decision.countryCode).toBe('PL');
    const internalCreditNote = decision.routes.find((r) => r.routeId === 'INTERNAL_CREDIT_NOTE')!;
    expect(internalCreditNote.status).toBe('forbidden');
  });
});
