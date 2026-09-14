import { ConflictException, NotFoundException, NotImplementedException } from '@nestjs/common';

import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import { DocumentsService } from '../documents.service';
import { PaymentProviderRegistry } from './payment-provider-registry';
import * as persistence from './payment-sessions.persistence';
import { PaymentSessionsService } from './payment-sessions.service';
import { PaymentWebhookVerificationError } from './provider';

/** `./payment-sessions.persistence` fully mocked — it reaches Prisma directly, the same discipline
 *  `bank-reconciliation.service.spec.ts`'s own header holds for its sibling `./persistence`.
 *  `DocumentsService`/`ChannelCredentialsService`/`PaymentProviderRegistry` are never constructed for
 *  real either: a bare object exposing only the methods this service actually calls, the exact same
 *  "mock the methods actually called, not the whole class" shape that file's own header documents. */
jest.mock('./payment-sessions.persistence');

const createCheckoutSession = persistence.createCheckoutSession as jest.Mock;
const findPendingSessionForDocument = persistence.findPendingSessionForDocument as jest.Mock;
const claimSessionForCompletion = persistence.claimSessionForCompletion as jest.Mock;
const attachSessionPayment = persistence.attachSessionPayment as jest.Mock;
const releaseSessionClaim = persistence.releaseSessionClaim as jest.Mock;
const markSessionFailed = persistence.markSessionFailed as jest.Mock;

function buildService() {
  const documentsService = {
    getDocument: jest.fn(),
    getSettlement: jest.fn(),
    runAction: jest.fn(),
  };
  const channelCredentials = { resolveActive: jest.fn() };
  const provider = { id: 'stripe', createCheckoutSession: jest.fn(), parseWebhookEvent: jest.fn() };
  const providerRegistry = { resolve: jest.fn().mockReturnValue(provider) };

  const service = new PaymentSessionsService(
    documentsService as unknown as DocumentsService,
    channelCredentials as unknown as ChannelCredentialsService,
    providerRegistry as unknown as PaymentProviderRegistry,
  );
  return { service, documentsService, channelCredentials, provider, providerRegistry };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('PaymentSessionsService.createInvoiceCheckoutSession', () => {
  const INPUT = {
    successUrl: 'https://app.example.com/portal?payment=success',
    cancelUrl: 'https://app.example.com/portal?payment=cancelled',
  };

  it('refuses an invoice that is not "sent" — a NAMED 409, never a session opened', async () => {
    const { service, documentsService, provider } = buildService();
    documentsService.getDocument.mockResolvedValue({ id: 'inv-1', status: 'draft', data: {} });

    await expect(service.createInvoiceCheckoutSession('company-1', 'inv-1', INPUT)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(provider.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('refuses an already fully-settled invoice', async () => {
    const { service, documentsService } = buildService();
    documentsService.getDocument.mockResolvedValue({
      id: 'inv-1',
      status: 'sent',
      data: { currency: 'EUR' },
    });
    documentsService.getSettlement.mockResolvedValue({ settlement: { outstandingMinor: 0 }, payments: [] });

    await expect(service.createInvoiceCheckoutSession('company-1', 'inv-1', INPUT)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuses when this company has no payment provider connected — 501, never invents a session', async () => {
    const { service, documentsService, channelCredentials, provider } = buildService();
    documentsService.getDocument.mockResolvedValue({
      id: 'inv-1',
      status: 'sent',
      data: { currency: 'EUR' },
    });
    documentsService.getSettlement.mockResolvedValue({ settlement: { outstandingMinor: 12000 } });
    channelCredentials.resolveActive.mockResolvedValue(null);

    await expect(service.createInvoiceCheckoutSession('company-1', 'inv-1', INPUT)).rejects.toBeInstanceOf(
      NotImplementedException,
    );
    expect(provider.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('reuses an existing PENDING session when the amount/currency still match', async () => {
    const { service, documentsService, channelCredentials, provider } = buildService();
    documentsService.getDocument.mockResolvedValue({
      id: 'inv-1',
      displayNumber: 'INV-1',
      status: 'sent',
      data: { currency: 'EUR' },
    });
    documentsService.getSettlement.mockResolvedValue({ settlement: { outstandingMinor: 12000 } });
    channelCredentials.resolveActive.mockResolvedValue({ config: { secretKey: 'sk' } });
    findPendingSessionForDocument.mockResolvedValue({
      checkoutUrl: 'https://checkout.stripe.com/pay/cs_old',
      amountMinor: 12000,
      currency: 'EUR',
    });

    const result = await service.createInvoiceCheckoutSession('company-1', 'inv-1', INPUT);

    expect(result).toEqual({ checkoutUrl: 'https://checkout.stripe.com/pay/cs_old' });
    expect(provider.createCheckoutSession).not.toHaveBeenCalled();
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it('opens a FRESH session when a pending one exists but quotes a DIFFERENT (stale) amount', async () => {
    const { service, documentsService, channelCredentials, provider } = buildService();
    documentsService.getDocument.mockResolvedValue({
      id: 'inv-1',
      displayNumber: 'INV-1',
      status: 'sent',
      data: { currency: 'EUR' },
    });
    documentsService.getSettlement.mockResolvedValue({ settlement: { outstandingMinor: 8000 } });
    channelCredentials.resolveActive.mockResolvedValue({ config: { secretKey: 'sk' } });
    findPendingSessionForDocument.mockResolvedValue({
      checkoutUrl: 'https://checkout.stripe.com/pay/cs_old',
      amountMinor: 12000, // stale — a partial payment has since reduced the balance
      currency: 'EUR',
    });
    provider.createCheckoutSession.mockResolvedValue({
      providerSessionId: 'cs_new',
      checkoutUrl: 'https://checkout.stripe.com/pay/cs_new',
    });
    createCheckoutSession.mockResolvedValue({ checkoutUrl: 'https://checkout.stripe.com/pay/cs_new' });

    const result = await service.createInvoiceCheckoutSession('company-1', 'inv-1', INPUT);

    expect(result).toEqual({ checkoutUrl: 'https://checkout.stripe.com/pay/cs_new' });
    // The amount handed to the provider — and persisted — is the FRESH figure, never the stale one.
    expect(provider.createCheckoutSession).toHaveBeenCalledWith(
      { secretKey: 'sk' },
      expect.objectContaining({ amountMinor: 8000, currency: 'EUR' }),
    );
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ amountMinor: 8000, providerSessionId: 'cs_new' }),
    );
  });

  it('opens a session with the fresh outstanding amount when none is pending', async () => {
    const { service, documentsService, channelCredentials, provider } = buildService();
    documentsService.getDocument.mockResolvedValue({
      id: 'inv-1',
      displayNumber: 'INV-2026-014',
      status: 'sent',
      data: { currency: 'EUR' },
    });
    documentsService.getSettlement.mockResolvedValue({ settlement: { outstandingMinor: 15000 } });
    channelCredentials.resolveActive.mockResolvedValue({ config: { secretKey: 'sk_test' } });
    findPendingSessionForDocument.mockResolvedValue(null);
    provider.createCheckoutSession.mockResolvedValue({
      providerSessionId: 'cs_new',
      checkoutUrl: 'https://checkout.stripe.com/pay/cs_new',
    });
    createCheckoutSession.mockResolvedValue({ checkoutUrl: 'https://checkout.stripe.com/pay/cs_new' });

    const result = await service.createInvoiceCheckoutSession('company-1', 'inv-1', INPUT);

    expect(result).toEqual({ checkoutUrl: 'https://checkout.stripe.com/pay/cs_new' });
    expect(provider.createCheckoutSession).toHaveBeenCalledWith(
      { secretKey: 'sk_test' },
      expect.objectContaining({
        amountMinor: 15000,
        currency: 'EUR',
        description: 'Invoice INV-2026-014',
        successUrl: INPUT.successUrl,
        cancelUrl: INPUT.cancelUrl,
        metadata: { companyId: 'company-1', documentId: 'inv-1' },
      }),
    );
  });
});

describe('PaymentSessionsService.handleWebhookEvent', () => {
  it('404s for an unregistered provider id, before ever resolving credentials', async () => {
    const { service, channelCredentials, providerRegistry } = buildService();
    providerRegistry.resolve.mockReturnValue(undefined);

    await expect(
      service.handleWebhookEvent('company-1', 'unknown-provider', 'body', 'sig'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(channelCredentials.resolveActive).not.toHaveBeenCalled();
  });

  it('refuses when this company has not connected the provider — never reaches signature parsing', async () => {
    const { service, channelCredentials, provider } = buildService();
    channelCredentials.resolveActive.mockResolvedValue(null);

    await expect(service.handleWebhookEvent('company-1', 'stripe', 'body', 'sig')).rejects.toBeInstanceOf(
      PaymentWebhookVerificationError,
    );
    expect(provider.parseWebhookEvent).not.toHaveBeenCalled();
  });

  it('propagates a signature verification failure verbatim, before any claim is attempted', async () => {
    const { service, channelCredentials, provider } = buildService();
    channelCredentials.resolveActive.mockResolvedValue({ config: { webhookSecret: 'whsec' } });
    provider.parseWebhookEvent.mockImplementation(() => {
      throw new PaymentWebhookVerificationError('bad signature');
    });

    await expect(service.handleWebhookEvent('company-1', 'stripe', 'body', 'sig')).rejects.toThrow(
      'bad signature',
    );
    expect(claimSessionForCompletion).not.toHaveBeenCalled();
  });

  it('marks a session FAILED for a "checkout.failed" event, and never calls record-payment', async () => {
    const { service, documentsService, channelCredentials, provider } = buildService();
    channelCredentials.resolveActive.mockResolvedValue({ config: { webhookSecret: 'whsec' } });
    provider.parseWebhookEvent.mockReturnValue({ type: 'checkout.failed', providerSessionId: 'cs_1' });

    const result = await service.handleWebhookEvent('company-1', 'stripe', 'body', 'sig');

    expect(result).toEqual({ outcome: 'processed' });
    expect(markSessionFailed).toHaveBeenCalledWith('stripe', 'cs_1');
    expect(documentsService.runAction).not.toHaveBeenCalled();
  });

  it('answers "ignored" for any other event type — never an error, never a claim', async () => {
    const { service, channelCredentials, provider } = buildService();
    channelCredentials.resolveActive.mockResolvedValue({ config: { webhookSecret: 'whsec' } });
    provider.parseWebhookEvent.mockReturnValue({ type: 'ignored', providerSessionId: 'cus_1' });

    const result = await service.handleWebhookEvent('company-1', 'stripe', 'body', 'sig');

    expect(result).toEqual({ outcome: 'ignored' });
    expect(claimSessionForCompletion).not.toHaveBeenCalled();
  });

  describe('a "checkout.completed" event', () => {
    function completedEvent(providerSessionId = 'cs_1') {
      return { type: 'checkout.completed' as const, providerSessionId };
    }

    it('THE REPLAY PROOF: a SECOND delivery of the SAME event finds the claim already lost and credits NOTHING', async () => {
      const { service, documentsService, channelCredentials, provider } = buildService();
      channelCredentials.resolveActive.mockResolvedValue({ config: { webhookSecret: 'whsec' } });
      provider.parseWebhookEvent.mockReturnValue(completedEvent());
      // The claim's own atomic `WHERE status = 'PENDING'` — this is what actually models a replay:
      // the FIRST delivery already flipped the row to COMPLETED, so this second one matches zero rows.
      claimSessionForCompletion.mockResolvedValue(null);

      const result = await service.handleWebhookEvent('company-1', 'stripe', 'body', 'sig');

      expect(result).toEqual({ outcome: 'unknown_session' });
      expect(documentsService.runAction).not.toHaveBeenCalled();
      expect(attachSessionPayment).not.toHaveBeenCalled();
    });

    it('claims, records the payment through the REAL action, and attaches it — never writes DocumentPayment itself', async () => {
      const { service, documentsService, channelCredentials, provider } = buildService();
      channelCredentials.resolveActive.mockResolvedValue({ config: { webhookSecret: 'whsec' } });
      provider.parseWebhookEvent.mockReturnValue(completedEvent());
      claimSessionForCompletion.mockResolvedValue({
        id: 'session-1',
        companyId: 'company-1',
        documentId: 'inv-1',
        providerId: 'stripe',
        providerSessionId: 'cs_1',
        amountMinor: 12000,
        currency: 'EUR',
      });
      documentsService.getDocument.mockResolvedValue({ id: 'inv-1', data: { currency: 'EUR' } });
      documentsService.getSettlement
        .mockResolvedValueOnce({ payments: [] }) // before
        .mockResolvedValueOnce({ payments: [{ id: 'payment-new' }] }); // after
      documentsService.runAction.mockResolvedValue({ document: {}, changed: true, message: 'ok' });

      const result = await service.handleWebhookEvent('company-1', 'stripe', 'body', 'sig');

      expect(result).toEqual({ outcome: 'processed' });
      expect(documentsService.runAction).toHaveBeenCalledWith('company-1', 'invoice', 'record-payment', {
        documentId: 'inv-1',
        data: { currency: 'EUR' },
        params: expect.objectContaining({
          amount: 120, // 12000 minor EUR -> 120.00 major
          currency: 'EUR',
          // 'card' — one of invoice.descriptor.ts's own FIXED `method` options (a strict 'select'
          // field; an invented value like "stripe" would 400 at the real action) — see
          // payment-sessions.service.ts's own comment at this exact call site.
          method: 'card',
        }),
      });
      expect(attachSessionPayment).toHaveBeenCalledWith('session-1', 'payment-new');
      expect(releaseSessionClaim).not.toHaveBeenCalled();
    });

    it('releases the claim and RETHROWS when "record-payment" fails — recoverable, never silently lost', async () => {
      const { service, documentsService, channelCredentials, provider } = buildService();
      channelCredentials.resolveActive.mockResolvedValue({ config: { webhookSecret: 'whsec' } });
      provider.parseWebhookEvent.mockReturnValue(completedEvent());
      claimSessionForCompletion.mockResolvedValue({
        id: 'session-1',
        companyId: 'company-1',
        documentId: 'inv-1',
        providerId: 'stripe',
        providerSessionId: 'cs_1',
        amountMinor: 12000,
        currency: 'EUR',
      });
      documentsService.getDocument.mockResolvedValue({ id: 'inv-1', data: { currency: 'EUR' } });
      documentsService.getSettlement.mockResolvedValue({ payments: [] });
      documentsService.runAction.mockRejectedValue(new Error('country-policy refused this action'));

      await expect(service.handleWebhookEvent('company-1', 'stripe', 'body', 'sig')).rejects.toThrow(
        'country-policy refused this action',
      );
      expect(releaseSessionClaim).toHaveBeenCalledWith('stripe', 'cs_1');
      expect(attachSessionPayment).not.toHaveBeenCalled();
    });
  });
});
