import { ForbiddenException } from '@nestjs/common';

import * as companyEmailTemplates from './actions/company-email-templates';
import { ActionExtensionRegistry } from './actions/action-extensions';
import { ActionRegistry } from './actions/action-registry';
import { APPROVAL_REQUIRED_MESSAGE } from './approval/approval-gate';
import * as approvalGate from './approval/approval-gate';
import { registerQuoteActions } from './actions/quote-actions';
import { ContributionRegistry } from './contributions/contribution-registry';
import * as countryPolicy from './country-policy/country-policy';
import { DocumentsService } from './documents.service';
import { FieldKindRegistry, registerCoreFieldKinds } from './descriptors/field-kinds';
import { buildQuoteDescriptor } from './descriptors/quote.descriptor';
import { DocumentTypeRegistry } from './descriptors/type-registry';
import * as takeNumber from './numbering/take-number';
import * as persistence from './persistence';
import { EntityReferenceRegistry } from './references/reference-registry';
import * as renderInstancePdf from './rendering/render-instance-pdf';
import { TransportRegistry } from './transports/transport-registry';

jest.mock('./persistence');
jest.mock('./rendering/render-instance-pdf');
jest.mock('./actions/company-email-templates');
jest.mock('./archive/archive-on-send');
jest.mock('./numbering/take-number');
jest.mock('./country-policy/country-policy');
// Only the I/O half (`resolveApprovalThresholdMinor`) is mocked here — `requiresApproval`, the actual
// rule, is proven for real against its own branching logic in approval-gate.spec.ts. Keeping it real
// in THIS file too means these tests prove `runAction`'s WIRING (the right role reaches the gate, the
// threshold is fetched for the right action, the gate runs at the right moment relative to
// persistence/enqueue), never a second, divergent copy of the rule itself — same discipline
// documents.service.country-policy.spec.ts already holds for country policy.
jest.mock('./approval/approval-gate', () => ({
  ...jest.requireActual('./approval/approval-gate'),
  resolveApprovalThresholdMinor: jest.fn(),
}));

/** Same wiring as documents.service.spec.ts's own `buildService` (quote type, real action
 *  registration) — reused rather than imported since that file doesn't export it; this file is about
 *  the approval gate specifically, not a second copy of the generic-machinery suite. */
function buildService() {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildQuoteDescriptor());

  const fieldKindRegistry = new FieldKindRegistry();
  registerCoreFieldKinds(fieldKindRegistry);

  const clientsService = { getClientById: jest.fn().mockResolvedValue(null) };
  const mailService = { sendMail: jest.fn().mockResolvedValue({ message: 'Email sent successfully' }) };
  const referenceRegistry = new EntityReferenceRegistry();
  const queueDispatcher = { enqueueAction: jest.fn().mockResolvedValue(undefined) };

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
  return { service, queueDispatcher };
}

// netMinor = 9.90 * 2 * 100 = 1980 (EUR, 2 decimals); no VAT-rate field on this line, so
// grossMinor === netMinor === 1980 ("counted in net only" — compute-totals.ts's own documented
// fallback for a line with no usable rate). A round, easy-to-reason-about gross for threshold math.
const validQuoteData = {
  client: 'client-1',
  issueDate: '2026-01-01',
  currency: 'EUR',
  lines: [{ description: 'Widget', quantity: 2, unitPrice: 9.9 }],
};

describe('DocumentsService.runAction — the approval-threshold gate', () => {
  beforeEach(() => {
    (countryPolicy.evaluateCountryPolicy as jest.Mock).mockResolvedValue({ allowed: true });
    (takeNumber.takeDocumentNumberForTransition as jest.Mock).mockResolvedValue(undefined);
    (renderInstancePdf.renderDocumentInstance as jest.Mock).mockResolvedValue({
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
    (companyEmailTemplates.getCompanyDocumentEmailTemplates as jest.Mock).mockResolvedValue({});
  });
  afterEach(() => jest.resetAllMocks());

  // A pre-existing "draft" quote, exactly like documents.service.spec.ts's own "phase 1" send test —
  // never a brand-new/undefined-status record, so only the approval gate itself is under test here,
  // not the "no currentStatus" edge case (covered by the descriptor/lifecycle specs instead).
  function mockDraftQuote() {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'quote',
      status: 'draft',
      data: validQuoteData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (persistence.upsertDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'quote',
      status: 'sending',
      data: validQuoteData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  function runSend(service: DocumentsService, role: 'OWNER' | 'ADMIN' | 'MEMBER' | undefined) {
    return service.runAction(
      'company-1',
      'quote',
      'send',
      { documentId: 'doc-1', data: validQuoteData, params: { recipient: 'client@example.com' } },
      role,
    );
  }

  it('blocks a MEMBER sending a document whose gross exceeds the threshold — 403, named, nothing persisted or enqueued', async () => {
    mockDraftQuote();
    (approvalGate.resolveApprovalThresholdMinor as jest.Mock).mockResolvedValue(1000); // 10.00 EUR < 19.80 EUR gross
    const { service, queueDispatcher } = buildService();

    const action = runSend(service, 'MEMBER');

    await expect(action).rejects.toBeInstanceOf(ForbiddenException);
    await expect(action).rejects.toThrow(APPROVAL_REQUIRED_MESSAGE);
    // A blocked send must never transition status or enqueue anything — the gate runs BEFORE the
    // handler, not as a check the handler itself might partially act on first.
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
    expect(queueDispatcher.enqueueAction).not.toHaveBeenCalled();
  });

  it('lets a MEMBER send a document exactly at the threshold — the boundary a company chose to allow', async () => {
    mockDraftQuote();
    (approvalGate.resolveApprovalThresholdMinor as jest.Mock).mockResolvedValue(1980);
    const { service } = buildService();

    const result = await runSend(service, 'MEMBER');

    expect(result.changed).toBe(true);
    expect(result.document).toMatchObject({ status: 'sending' });
  });

  it('lets a MEMBER send a document under the threshold', async () => {
    mockDraftQuote();
    (approvalGate.resolveApprovalThresholdMinor as jest.Mock).mockResolvedValue(2000);
    const { service } = buildService();

    const result = await runSend(service, 'MEMBER');

    expect(result.changed).toBe(true);
  });

  it('lets an OWNER send the same over-threshold document — their send IS the approval', async () => {
    mockDraftQuote();
    (approvalGate.resolveApprovalThresholdMinor as jest.Mock).mockResolvedValue(1000);
    const { service } = buildService();

    const result = await runSend(service, 'OWNER');

    expect(result.changed).toBe(true);
  });

  it('lets an ADMIN send the same over-threshold document', async () => {
    mockDraftQuote();
    (approvalGate.resolveApprovalThresholdMinor as jest.Mock).mockResolvedValue(1000);
    const { service } = buildService();

    const result = await runSend(service, 'ADMIN');

    expect(result.changed).toBe(true);
  });

  it('never gates when the company has no threshold configured (NULL) — even for a MEMBER over any amount', async () => {
    mockDraftQuote();
    (approvalGate.resolveApprovalThresholdMinor as jest.Mock).mockResolvedValue(null);
    const { service } = buildService();

    const result = await runSend(service, 'MEMBER');

    expect(result.changed).toBe(true);
  });

  it('never gates a caller with no role — the worker replaying an already-approved async send, or any other internal/API-key caller', async () => {
    mockDraftQuote();
    (approvalGate.resolveApprovalThresholdMinor as jest.Mock).mockResolvedValue(1000);
    const { service } = buildService();

    const result = await runSend(service, undefined);

    expect(result.changed).toBe(true);
    // `role === 'MEMBER'` short-circuits the whole gate before the threshold is even fetched (see
    // runAction's own comment) — proves the "never re-gated" guarantee isn't merely `requiresApproval`
    // returning false, but the async worker path never paying for the lookup at all.
    expect(approvalGate.resolveApprovalThresholdMinor).not.toHaveBeenCalled();
  });

  it('never gates a non-"send" action, regardless of role or threshold', async () => {
    (persistence.upsertDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'quote',
      status: 'draft',
      data: validQuoteData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (approvalGate.resolveApprovalThresholdMinor as jest.Mock).mockResolvedValue(1);
    const { service } = buildService();

    const result = await service.runAction(
      'company-1',
      'quote',
      'save-draft',
      { data: validQuoteData },
      'MEMBER',
    );

    expect(result.changed).toBe(true);
    expect(approvalGate.resolveApprovalThresholdMinor).not.toHaveBeenCalled();
  });
});
