import { vi, type Mock } from 'vitest';

import { ConflictException, NotFoundException } from '@nestjs/common';

import { ActionExtensionRegistry } from '../documents/actions/action-extensions';
import { ActionRegistry, DocumentInstanceResult } from '../documents/actions/action-registry';
import { ContributionRegistry } from '../documents/contributions/contribution-registry';
import { buildCreditNoteDescriptor } from '../documents/descriptors/credit-note.descriptor';
import { registerCoreFieldKinds, FieldKindRegistry } from '../documents/descriptors/field-kinds';
import { buildInvoiceDescriptor } from '../documents/descriptors/invoice.descriptor';
import { buildQuoteDescriptor } from '../documents/descriptors/quote.descriptor';
import { DocumentTypeRegistry } from '../documents/descriptors/type-registry';
import { DocumentsService } from '../documents/documents.service';
import * as persistence from '../documents/persistence';
import { filterLikeListAllDocuments } from '../documents/__tests__/fake-document-instance-table';
import { PaymentSessionsService } from '../documents/payments/payment-sessions.service';
import * as clientStatement from '../documents/settlement/client-statement';
import { EntityReferenceRegistry } from '../documents/references/reference-registry';
import { SignaturesService } from '../documents/signatures/signatures.service';
import { TransportRegistry } from '../documents/transports/transport-registry';
import { PortalService } from './portal.service';

vi.mock('../documents/persistence');
vi.mock('../documents/settlement/client-statement');

const listAllDocuments = persistence.listAllDocuments as Mock;

/** Hands the portal only the rows the QUERY would have returned — the client and client-visible
 *  status narrowing moved into SQL when this read stopped being capped. The cap-crossing fixture
 *  lives in `portal-quotes.read-cap.spec.ts`. */
function seedDocuments(rows: Parameters<typeof filterLikeListAllDocuments>[0]): void {
  listAllDocuments.mockImplementation(async (_companyId: string, options = {}) =>
    filterLikeListAllDocuments(rows, options),
  );
}

/**
 * `PortalService` is where the portal's ENTIRE security boundary lives (see that file's own header)
 * — this spec is the "exact test that proves a client cannot reach another's document" the feature's
 * own brief asks for. Every scenario below pairs a document belonging to "client-A" against a caller
 * asking as "client-B" (or a status this feature never exposes at all), and asserts the SAME
 * `NotFoundException` `findOwnedDocument`-style tenant checks already use elsewhere in this codebase
 * — never a 403 that would confirm "something exists here, you may just not see it".
 *
 * `DocumentsService` is constructed for REAL (registries + real descriptors, the same
 * `share-links.service.spec.ts#buildDocumentsService` pattern) — only `../documents/persistence` (the
 * actual Prisma reads) and `../documents/settlement/client-statement` are mocked, plus
 * `renderInstancePdf` itself (spied out: it drives a real HTML→PDF→PAdES pipeline no unit test should
 * pay for). This means `getType`/`getDocument` run their REAL implementation, so a status this
 * boundary should refuse is refused by the SAME code path production uses, not a hand-rolled stand-in.
 */
function buildDocumentsService(): DocumentsService {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildQuoteDescriptor());
  typeRegistry.register(buildInvoiceDescriptor());
  typeRegistry.register(buildCreditNoteDescriptor());

  const fieldKindRegistry = new FieldKindRegistry();
  registerCoreFieldKinds(fieldKindRegistry);

  return new DocumentsService(
    typeRegistry,
    fieldKindRegistry,
    new ActionRegistry(),
    new ActionExtensionRegistry(),
    new EntityReferenceRegistry(),
    new TransportRegistry(),
    new ContributionRegistry(),
  );
}

function fakeSignaturesService(): SignaturesService {
  return {
    requestSignature: vi.fn().mockResolvedValue({ message: 'sent' }),
  } as unknown as SignaturesService;
}

function fakePaymentSessionsService(): PaymentSessionsService {
  return {
    createInvoiceCheckoutSession: vi.fn().mockResolvedValue({ checkoutUrl: 'https://checkout.stripe.com/x' }),
  } as unknown as PaymentSessionsService;
}

function buildService(): {
  service: PortalService;
  documentsService: DocumentsService;
  signatures: SignaturesService;
  paymentSessions: PaymentSessionsService;
} {
  const documentsService = buildDocumentsService();
  const signatures = fakeSignaturesService();
  const paymentSessions = fakePaymentSessionsService();
  return {
    service: new PortalService(documentsService, signatures, paymentSessions),
    documentsService,
    signatures,
    paymentSessions,
  };
}

const COMPANY = 'company-1';
const CLIENT_A = 'client-A';
const CLIENT_B = 'client-B';

function instance(
  overrides: Partial<DocumentInstanceResult> & { id: string; typeId: string },
): DocumentInstanceResult {
  return {
    status: 'sent',
    data: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    displayNumber: null,
    ...overrides,
  };
}

const QUOTE_A = instance({
  id: 'quote-a',
  typeId: 'quote',
  data: { client: CLIENT_A, currency: 'EUR', lines: [] },
});
const QUOTE_B = instance({
  id: 'quote-b',
  typeId: 'quote',
  data: { client: CLIENT_B, currency: 'EUR', lines: [] },
});
const DRAFT_QUOTE_A = instance({
  id: 'quote-a-draft',
  typeId: 'quote',
  status: 'draft',
  data: { client: CLIENT_A, currency: 'EUR', lines: [] },
});
// Issue #421: a manually-accepted quote - clientVisible (client-visibility.spec.ts), but never
// respondable again (canRespond below), the same as an already-signed one.
const ACCEPTED_QUOTE_A = instance({
  id: 'quote-a-accepted',
  typeId: 'quote',
  status: 'accepted',
  data: { client: CLIENT_A, currency: 'EUR', lines: [] },
});
const INVOICE_A = instance({
  id: 'invoice-a',
  typeId: 'invoice',
  data: { client: CLIENT_A, currency: 'EUR' },
});
const CREDIT_NOTE_A = instance({
  id: 'cn-a',
  typeId: 'credit-note',
  data: { invoice: 'invoice-a', currency: 'EUR' },
});

describe('PortalService — the client-portal security boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getDocumentPdf', () => {
    it('a client CANNOT reach another client’s document by id — same company, wrong client, 404', async () => {
      const { service, documentsService } = buildService();
      const renderSpy = vi.spyOn(documentsService, 'renderInstancePdf');
      (persistence.findOwnedDocument as Mock).mockResolvedValue(QUOTE_B);

      await expect(service.getDocumentPdf(COMPANY, CLIENT_A, 'quote', 'quote-b')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      // Never even reaches the rendering pipeline — the boundary refuses before any PDF is built.
      expect(renderSpy).not.toHaveBeenCalled();
    });

    it('a DRAFT document is never portal-visible, even to its own client', async () => {
      const { service, documentsService } = buildService();
      const renderSpy = vi.spyOn(documentsService, 'renderInstancePdf');
      (persistence.findOwnedDocument as Mock).mockResolvedValue(DRAFT_QUOTE_A);

      await expect(
        service.getDocumentPdf(COMPANY, CLIENT_A, 'quote', 'quote-a-draft'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(renderSpy).not.toHaveBeenCalled();
    });

    it('a document type the portal never exposes (e.g. "expense") 404s before any lookup', async () => {
      const { service } = buildService();
      await expect(service.getDocumentPdf(COMPANY, CLIENT_A, 'expense', 'exp-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(persistence.findOwnedDocument).not.toHaveBeenCalled();
    });

    it('a credit note resolves its client THROUGH the invoice it corrects — wrong client still 404s', async () => {
      const { service, documentsService } = buildService();
      const renderSpy = vi.spyOn(documentsService, 'renderInstancePdf').mockResolvedValue(Buffer.from('pdf'));
      (persistence.findOwnedDocument as Mock).mockImplementation(
        async (_companyId: string, typeId: string, id: string) => {
          if (typeId === 'credit-note' && id === 'cn-a') return CREDIT_NOTE_A;
          if (typeId === 'invoice' && id === 'invoice-a') return INVOICE_A;
          throw new Error(`unexpected lookup ${typeId}/${id}`);
        },
      );

      // Client B asking for client A's credit note (correcting client A's own invoice) — refused.
      await expect(service.getDocumentPdf(COMPANY, CLIENT_B, 'credit-note', 'cn-a')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(renderSpy).not.toHaveBeenCalled();

      // The right client — succeeds, and reaches the real rendering pipeline.
      const pdf = await service.getDocumentPdf(COMPANY, CLIENT_A, 'credit-note', 'cn-a');
      expect(pdf.toString()).toBe('pdf');
      expect(renderSpy).toHaveBeenCalledWith(COMPANY, 'credit-note', 'cn-a');
    });

    it('succeeds, and renders, for the RIGHT client on a clientVisible status', async () => {
      const { service, documentsService } = buildService();
      const renderSpy = vi.spyOn(documentsService, 'renderInstancePdf').mockResolvedValue(Buffer.from('pdf'));
      (persistence.findOwnedDocument as Mock).mockResolvedValue(QUOTE_A);

      const pdf = await service.getDocumentPdf(COMPANY, CLIENT_A, 'quote', 'quote-a');
      expect(pdf.toString()).toBe('pdf');
      expect(renderSpy).toHaveBeenCalledWith(COMPANY, 'quote', 'quote-a');
    });
  });

  describe('refuseQuote', () => {
    it('refuses to decline another client’s quote — 404, never a 403', async () => {
      const { service } = buildService();
      (persistence.findOwnedDocument as Mock).mockResolvedValue(QUOTE_B);

      await expect(service.refuseQuote(COMPANY, CLIENT_A, 'quote-b')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(persistence.updateDocumentStatus).not.toHaveBeenCalled();
    });

    it('409s a quote that is no longer "sent" (already signed/refused)', async () => {
      const { service } = buildService();
      (persistence.findOwnedDocument as Mock).mockResolvedValue({ ...QUOTE_A, status: 'signed' });

      await expect(service.refuseQuote(COMPANY, CLIENT_A, 'quote-a')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(persistence.updateDocumentStatus).not.toHaveBeenCalled();
    });

    it('declines the client’s OWN "sent" quote', async () => {
      const { service } = buildService();
      (persistence.findOwnedDocument as Mock).mockResolvedValue(QUOTE_A);
      (persistence.updateDocumentStatus as Mock).mockResolvedValue({ ...QUOTE_A, status: 'refused' });

      const result = await service.refuseQuote(COMPANY, CLIENT_A, 'quote-a');
      expect(result).toEqual({ status: 'refused' });
      expect(persistence.updateDocumentStatus).toHaveBeenCalledWith(COMPANY, 'quote', 'quote-a', 'refused');
    });
  });

  describe('requestQuoteSignature', () => {
    it('refuses to start a signature request for another client’s quote — 404', async () => {
      const { service, signatures } = buildService();
      (persistence.findOwnedDocument as Mock).mockResolvedValue(QUOTE_B);

      await expect(service.requestQuoteSignature(COMPANY, CLIENT_A, 'quote-b')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(signatures.requestSignature).not.toHaveBeenCalled();
    });

    it('409s once the quote already left "sent"', async () => {
      const { service, signatures } = buildService();
      (persistence.findOwnedDocument as Mock).mockResolvedValue({ ...QUOTE_A, status: 'refused' });

      await expect(service.requestQuoteSignature(COMPANY, CLIENT_A, 'quote-a')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(signatures.requestSignature).not.toHaveBeenCalled();
    });

    it('delegates to the EXISTING SignaturesService.requestSignature, unchanged, for the right client', async () => {
      const { service, signatures } = buildService();
      (persistence.findOwnedDocument as Mock).mockResolvedValue(QUOTE_A);

      const result = await service.requestQuoteSignature(COMPANY, CLIENT_A, 'quote-a');
      expect(result).toEqual({ message: 'sent' });
      expect(signatures.requestSignature).toHaveBeenCalledWith(COMPANY, 'quote', 'quote-a');
    });
  });

  describe('createInvoiceCheckoutSession', () => {
    const originalAppUrl = process.env.APP_URL;
    afterEach(() => {
      process.env.APP_URL = originalAppUrl;
    });

    it('a client CANNOT open a checkout session for another client’s invoice — 404, never calls PaymentSessionsService', async () => {
      const { service, paymentSessions } = buildService();
      const invoiceB = { ...INVOICE_A, id: 'invoice-b', data: { client: CLIENT_B, currency: 'EUR' } };
      (persistence.findOwnedDocument as Mock).mockResolvedValue(invoiceB);

      await expect(
        service.createInvoiceCheckoutSession(COMPANY, CLIENT_A, 'invoice-b'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(paymentSessions.createInvoiceCheckoutSession).not.toHaveBeenCalled();
    });

    it(
      'delegates to PaymentSessionsService, verbatim, for THIS client’s own invoice, with return ' +
        'URLs that carry NO credential — the provider stores these on its own session object',
      async () => {
        const { service, paymentSessions } = buildService();
        (persistence.findOwnedDocument as Mock).mockResolvedValue(INVOICE_A);
        process.env.APP_URL = 'http://localhost:5173';

        const result = await service.createInvoiceCheckoutSession(COMPANY, CLIENT_A, 'invoice-a');

        expect(result).toEqual({ checkoutUrl: 'https://checkout.stripe.com/x' });
        expect(paymentSessions.createInvoiceCheckoutSession).toHaveBeenCalledWith(COMPANY, 'invoice-a', {
          successUrl: 'http://localhost:5173/portal?payment=success',
          cancelUrl: 'http://localhost:5173/portal?payment=cancelled',
        });
      },
    );

    it('the return URLs carry NOTHING but the banner flag — no path segment, no extra query', async () => {
      // A 30-day bearer credential for this client's whole portal must never be handed to Stripe/
      // PayPal/Mollie, each of which RETAINS the return URL on its own session object, readable from
      // that provider's dashboard, API and logs. Asserted structurally — path and query, not a
      // substring — so any future addition of a secret to either URL fails here.
      const { service, paymentSessions } = buildService();
      (persistence.findOwnedDocument as Mock).mockResolvedValue(INVOICE_A);
      process.env.APP_URL = 'http://localhost:5173';

      await service.createInvoiceCheckoutSession(COMPANY, CLIENT_A, 'invoice-a');

      const [, , urls] = (paymentSessions.createInvoiceCheckoutSession as Mock).mock.calls[0];
      for (const [raw, flag] of [
        [urls.successUrl, 'success'],
        [urls.cancelUrl, 'cancelled'],
      ] as const) {
        const url = new URL(raw);
        expect(url.pathname).toBe('/portal');
        expect([...url.searchParams]).toEqual([['payment', flag]]);
      }
    });

    it('strips a trailing slash off APP_URL before building the return URL', async () => {
      const { service, paymentSessions } = buildService();
      (persistence.findOwnedDocument as Mock).mockResolvedValue(INVOICE_A);
      process.env.APP_URL = 'http://localhost:5173/';

      await service.createInvoiceCheckoutSession(COMPANY, CLIENT_A, 'invoice-a');

      expect(paymentSessions.createInvoiceCheckoutSession).toHaveBeenCalledWith(COMPANY, 'invoice-a', {
        successUrl: 'http://localhost:5173/portal?payment=success',
        cancelUrl: 'http://localhost:5173/portal?payment=cancelled',
      });
    });
  });

  describe('listQuotes', () => {
    it('lists only THIS client’s quotes, on a clientVisible status — never a draft, never another client’s', async () => {
      const { service } = buildService();
      // The client and status narrowing is in the QUERY now, so this fixture goes through the same
      // filter — the other client's quote and the draft never reach the service at all, which is
      // exactly what the boundary this test guards must keep being true of.
      seedDocuments([QUOTE_A, QUOTE_B, DRAFT_QUOTE_A]);

      const rows = await service.listQuotes(COMPANY, CLIENT_A);
      expect(rows.map((row) => row.id)).toEqual(['quote-a']);
      expect(rows[0].canRespond).toBe(true);
    });

    it('shows a manually-accepted quote (issue #421) but never lets the client respond to it again', async () => {
      const { service } = buildService();
      seedDocuments([ACCEPTED_QUOTE_A]);

      const rows = await service.listQuotes(COMPANY, CLIENT_A);
      expect(rows.map((row) => row.id)).toEqual(['quote-a-accepted']);
      expect(rows[0].status).toBe('accepted');
      // Same posture as an already-"signed" quote: nothing left to sign or refuse.
      expect(rows[0].canRespond).toBe(false);
    });
  });

  describe('getStatement', () => {
    it('delegates VERBATIM to resolveClientStatement — never a second balance computation', async () => {
      const { service } = buildService();
      const fakeStatement = { clientId: CLIENT_A, documents: [], totals: [] };
      (clientStatement.resolveClientStatement as Mock).mockResolvedValue(fakeStatement);

      const result = await service.getStatement(COMPANY, CLIENT_A);
      expect(result).toBe(fakeStatement);
      expect(clientStatement.resolveClientStatement).toHaveBeenCalledWith(COMPANY, CLIENT_A);
    });
  });
});
