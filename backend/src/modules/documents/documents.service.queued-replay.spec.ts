import { vi, type Mock } from 'vitest';

import * as companyEmailTemplates from './actions/company-email-templates';
import { ActionExtensionRegistry } from './actions/action-extensions';
import { ActionRegistry } from './actions/action-registry';
import { registerQuoteActions } from './actions/quote-actions';
import { ContributionRegistry } from './contributions/contribution-registry';
import * as countryPolicy from './country-policy/country-policy';
import { DocumentsService } from './documents.service';
import { FieldKindRegistry, registerCoreFieldKinds } from './descriptors/field-kinds';
import { buildQuoteDescriptor } from './descriptors/quote.descriptor';
import { DocumentTypeRegistry } from './descriptors/type-registry';
import * as persistence from './persistence';
import { EntityReferenceRegistry } from './references/reference-registry';
import * as renderInstancePdf from './rendering/render-instance-pdf';
import { TransportRegistry } from './transports/transport-registry';

vi.mock('./persistence');
vi.mock('./rendering/render-instance-pdf');
vi.mock('./actions/company-email-templates');
vi.mock('./archive/archive-on-send');
vi.mock('./numbering/take-number');
vi.mock('./country-policy/country-policy');

/** Same wiring as documents.service.spec.ts's own `buildService` — reused rather than imported since
 *  that file doesn't export it. */
function buildService() {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildQuoteDescriptor());

  const fieldKindRegistry = new FieldKindRegistry();
  registerCoreFieldKinds(fieldKindRegistry);

  const clientsService = { getClientById: vi.fn().mockResolvedValue(null) };
  const mailService = {
    sendForCompany: vi.fn().mockResolvedValue({ message: 'Email sent successfully' }),
  };
  const referenceRegistry = new EntityReferenceRegistry();
  const queueDispatcher = { enqueueAction: vi.fn().mockResolvedValue(undefined) };

  const actionRegistry = new ActionRegistry();
  registerQuoteActions(actionRegistry, {
    clientsService: clientsService as never,
    mailService: mailService as never,
    typeRegistry,
    referenceRegistry,
    queueDispatcher,
  });

  const service = new DocumentsService(
    typeRegistry,
    fieldKindRegistry,
    actionRegistry,
    new ActionExtensionRegistry(),
    referenceRegistry,
    new TransportRegistry(),
    new ContributionRegistry(),
  );
  return { service, mailService, queueDispatcher };
}

const validQuoteData = {
  client: 'client-1',
  issueDate: '2026-01-01',
  currency: 'EUR',
  lines: [{ description: 'Widget', quantity: 2, unitPrice: 9.9 }],
};

/**
 * THE MUTATION TARGET: the worker's own replay of an async "send" job used to re-run EVERY admission
 * gate (country policy, field/row-selection/reference validation, the billing send-gate) against the
 * company's CURRENT state — even though phase 1 (`actions/async-send.ts`) already ran every one of
 * them, live, at the moment it took an IRREVERSIBLE document number. `isQueuedReplay` (runAction's own
 * new, additive parameter) is what closes this — these tests prove it actually narrows to the single
 * shape it should (`send`, already `sending`), never widening what a live HTTP request may do.
 */
describe('DocumentsService.runAction — isQueuedReplay (the worker\'s admitted replay of an async "send")', () => {
  beforeEach(() => {
    (renderInstancePdf.renderDocumentInstance as Mock).mockResolvedValue({
      pdf: Buffer.from('%PDF-fake'),
      totals: {
        currency: 'EUR',
        lines: [],
        netMinor: 0,
        vatMinor: 0,
        grossMinor: 0,
        vatBreakdown: [],
        warnings: [],
      },
      referenceLabels: {},
      companyName: 'Test Co',
    });
    (companyEmailTemplates.getCompanyDocumentEmailTemplates as Mock).mockResolvedValue({});
  });
  afterEach(() => vi.resetAllMocks());

  function mockSendingQuote() {
    (persistence.findOwnedDocument as Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'quote',
      status: 'sending',
      data: validQuoteData,
      createdAt: new Date(),
      updatedAt: new Date(),
      number: 1,
      displayNumber: 'QUOTE-2026-0001',
    });
    (persistence.updateDocumentStatus as Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'quote',
      status: 'sent',
      data: validQuoteData,
      createdAt: new Date(),
      updatedAt: new Date(),
      number: 1,
      displayNumber: 'QUOTE-2026-0001',
    });
  }

  it('an admitted replay (send, already "sending") delivers even though the country now forbids the action', async () => {
    mockSendingQuote();
    (countryPolicy.evaluateCountryPolicy as Mock).mockResolvedValue({
      allowed: false,
      reason: 'no longer permitted for this country',
    });
    const { service, mailService } = buildService();

    const result = await service.runAction(
      'company-1',
      'quote',
      'send',
      { documentId: 'doc-1', data: validQuoteData, params: { recipient: 'client@example.com' } },
      undefined,
      true, // isQueuedReplay
    );

    expect(result.changed).toBe(true);
    expect(result.document).toMatchObject({ status: 'sent' });
    expect(mailService.sendForCompany).toHaveBeenCalled();
    // The named 403 the country-policy gate would otherwise throw never even runs.
    expect(countryPolicy.evaluateCountryPolicy).not.toHaveBeenCalled();
  });

  it('the SAME "sending" record, WITHOUT isQueuedReplay (a genuine second HTTP call): the country-policy gate still applies, named', async () => {
    mockSendingQuote();
    (countryPolicy.evaluateCountryPolicy as Mock).mockResolvedValue({
      allowed: false,
      reason: 'no longer permitted for this country',
    });
    const { service, mailService } = buildService();

    const action = service.runAction('company-1', 'quote', 'send', {
      documentId: 'doc-1',
      data: validQuoteData,
      params: { recipient: 'client@example.com' },
    });

    await expect(action).rejects.toThrow('no longer permitted for this country');
    expect(mailService.sendForCompany).not.toHaveBeenCalled();
  });

  it('isQueuedReplay:true on a FRESH draft (not "sending"): narrowly scoped — the country-policy gate still applies', async () => {
    (persistence.findOwnedDocument as Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'quote',
      status: 'draft',
      data: validQuoteData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (countryPolicy.evaluateCountryPolicy as Mock).mockResolvedValue({
      allowed: false,
      reason: 'forbidden entirely',
    });
    const { service } = buildService();

    await expect(
      service.runAction(
        'company-1',
        'quote',
        'send',
        { documentId: 'doc-1', data: validQuoteData, params: { recipient: 'client@example.com' } },
        undefined,
        true,
      ),
    ).rejects.toThrow('forbidden entirely');
  });

  it('isQueuedReplay:true on a "sending" record but a DIFFERENT action id ("save-draft"): narrowly scoped — the gate still applies', async () => {
    (persistence.findOwnedDocument as Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'quote',
      status: 'sending',
      data: validQuoteData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (countryPolicy.evaluateCountryPolicy as Mock).mockResolvedValue({
      allowed: false,
      reason: 'save-draft forbidden',
    });
    const { service } = buildService();

    await expect(
      service.runAction(
        'company-1',
        'quote',
        'save-draft',
        { documentId: 'doc-1', data: validQuoteData },
        undefined,
        true,
      ),
    ).rejects.toThrow('save-draft forbidden');
  });
});
