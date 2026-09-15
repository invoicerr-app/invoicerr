import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { DocumentInstanceResult } from '../documents/actions/action-registry';
import { DocumentsService } from '../documents/documents.service';
import { findOwnedDocument, listDocuments, updateDocumentStatus } from '../documents/persistence';
import {
  InvoiceCheckoutSessionResult,
  PaymentSessionsService,
} from '../documents/payments/payment-sessions.service';
import { ClientStatement, resolveClientStatement } from '../documents/settlement/client-statement';
import { SignaturesService } from '../documents/signatures/signatures.service';
import { computeDocumentTotals } from '../documents/totals/compute-totals';
import {
  clientVisibleStatusIds,
  directClientId,
  invoiceIdOfCreditNote,
  isPortalDocumentType,
} from './client-visibility';

/** An honest, capped read — same convention every other portal/statement read in this codebase
 *  already holds (`settlement/client-statement.ts#CLIENT_STATEMENT_READ_LIMIT`,
 *  `settlement/credits.ts#CREDIT_NOTE_READ_LIMIT`). */
const PORTAL_QUOTE_READ_LIMIT = 500;

export interface PortalProfile {
  clientId: string;
  clientName: string;
  companyName: string;
}

export interface PortalQuoteRow {
  id: string;
  displayNumber: string | null;
  status: string;
  issueDate: string | null;
  currency: string;
  /** The quote's own gross total — `totals/compute-totals.ts`, the same pure arithmetic every other
   *  document detail screen already uses for its own total. NOT a settlement/balance figure (a quote
   *  is never billed) — see this module's own header on why `getStatement` below is the ONLY place
   *  balance math is ever surfaced, and it is never recomputed there either. */
  amountMinor: number;
  /** Whether this row still awaits the client's own decision — exactly `status === 'sent'`, the one
   *  status `requestQuoteSignature`/`refuseQuote` below both require. */
  canRespond: boolean;
}

/**
 * The client-facing half of the client portal (TODO_FEATURES.md rank 3) — every method takes BOTH
 * `companyId` AND `clientId` (the two halves `ActivePortalClient` resolves from the caller's own
 * bearer token, never from a request parameter) and scopes every read/write by both. This is the
 * actual enforcement of the security boundary the portal exists to hold: a document is reachable
 * through this class if and only if it belongs to THIS company AND names THIS client — see
 * `assertVisibleToClient` below, the one method every other one in this class funnels through.
 *
 * Reuses, rather than re-implements:
 *  - `settlement/client-statement.ts#resolveClientStatement` for the balance (`getStatement`) —
 *    UNCHANGED, not even a wrapper that renames a field: this class calls it exactly as
 *    `ClientsService.getStatement` (the STAFF-facing equivalent) already does.
 *  - `signatures/signatures.service.ts#SignaturesService.requestSignature` for accepting a quote
 *    (`requestQuoteSignature`) — the EXISTING, OTP-hardened path, never a second one. This class only
 *    adds the ownership check that method itself does not perform (it trusts a company-authenticated
 *    caller completely — see its own header) before delegating to it unchanged.
 *  - `documents.service.ts#renderInstancePdf` for a document's PDF (`getDocumentPdf`) — byte-for-byte
 *    the same rendering (and PAdES-signing) pipeline the staff-facing download and the public
 *    share-link both already use.
 *
 * "refused" (`refuseQuote`) is the one genuinely NEW write: a quote's own decline, reached the same
 * way "signed" already is (see quote.descriptor.ts's own comment on that status) — a hand-guarded
 * status write OUTSIDE `runAction`/`ActionRegistry`, because there is no company-authenticated caller
 * to run an action AS here, the caller is the CLIENT. Deliberately NOT routed through the OTP
 * signature mechanism: declining carries no legal weight the way accepting does (nothing is signed,
 * nothing becomes non-repudiable) — see `refuseQuote`'s own header.
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly signaturesService: SignaturesService,
    private readonly paymentSessions: PaymentSessionsService,
  ) {}

  async getProfile(companyId: string, clientId: string): Promise<PortalProfile> {
    const [client, company] = await Promise.all([
      prisma.client.findFirstOrThrow({ where: { id: clientId, companyId }, select: { name: true } }),
      prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true } }),
    ]);
    return { clientId, clientName: client.name, companyName: company.name };
  }

  /**
   * The client's own balance — see this class's own header: `resolveClientStatement` is called
   * exactly as the staff-facing `GET /clients/:id/statement` already calls it. No extra scoping is
   * needed beyond passing THIS session's own `clientId`: that function already computes an empty,
   * harmless statement for a `clientId` that names no invoice of this company at all (its own header
   * documents this), and here `clientId` is never attacker-supplied — it came out of a verified
   * bearer token, never a request parameter.
   */
  async getStatement(companyId: string, clientId: string): Promise<ClientStatement> {
    return resolveClientStatement(companyId, clientId);
  }

  /** Every quote this client may see — `clientVisible` statuses only (today: "sent", "signed",
   *  "refused" — see quote.descriptor.ts), derived from the descriptor, never hardcoded here. */
  async listQuotes(companyId: string, clientId: string): Promise<PortalQuoteRow[]> {
    const descriptor = this.documentsService.getType('quote');
    const visible = clientVisibleStatusIds(descriptor);

    const quotes = await listDocuments(companyId, 'quote', PORTAL_QUOTE_READ_LIMIT);
    const rows: PortalQuoteRow[] = [];
    for (const quote of quotes) {
      const data = (quote.data ?? {}) as Record<string, unknown>;
      if (!visible.has(quote.status)) continue;
      if (directClientId(data) !== clientId) continue;

      rows.push({
        id: quote.id,
        displayNumber: quote.displayNumber ?? null,
        status: quote.status,
        issueDate: typeof data.issueDate === 'string' ? data.issueDate : null,
        currency: typeof data.currency === 'string' ? data.currency : '',
        amountMinor: computeDocumentTotals(descriptor, data).grossMinor,
        canRespond: quote.status === 'sent',
      });
    }
    return rows;
  }

  /**
   * Triggers the EXISTING, OTP-hardened signature request (`SignaturesService.requestSignature`) —
   * see this class's own header. That method itself trusts `companyId`/`typeId`/`documentId`
   * completely (it is normally reached only after `runAction`'s own four gates already ran); THIS
   * method is what stands in for those gates on the portal's own, differently-shaped path: resolve the
   * quote (tenant-scoped 404), check it actually belongs to THIS client (never another one — 404,
   * indistinguishable from "does not exist", the same discipline `assertVisibleToClient` holds
   * everywhere else in this class), check it is still "sent" (409 otherwise — a signed or refused
   * quote has nothing left to request), then delegate. The client still has to open the emailed link
   * and pass the OTP challenge exactly as before — this call only starts that existing flow, it does
   * not shortcut it.
   */
  async requestQuoteSignature(
    companyId: string,
    clientId: string,
    quoteId: string,
  ): Promise<{ message: string }> {
    const quote = await this.documentsService.getDocument(companyId, 'quote', quoteId);
    this.assertBelongsToClient(quote, clientId);
    if (quote.status !== 'sent') {
      throw new ConflictException(
        `Cannot request a signature for a quote with status "${quote.status}" — it is no longer awaiting a decision.`,
      );
    }
    return this.signaturesService.requestSignature(companyId, 'quote', quoteId);
  }

  /**
   * The quote's own decline — a plain status write, hand-guarded exactly like
   * `signatures.service.ts`'s own private `markSigned` guards "signed" (only from "sent", a 409
   * otherwise), OUTSIDE `runAction`/`ActionRegistry` for the identical reason that method is: there is
   * no company-authenticated caller here to run an action AS, the caller is the client themselves.
   *
   * Deliberately NEVER routed through the OTP signature mechanism `requestQuoteSignature` above uses:
   * accepting a quote is a legally meaningful, non-repudiable act (which is exactly what that
   * mechanism's CSPRNG/lifetime-lockout/throttler guarantee), while declining one is a reversible
   * business preference with no such weight — the worst a stolen portal token could do here is
   * prematurely mark a quote refused, a fact the company can see and act on (send a fresh quote,
   * follow up by phone), never a forged acceptance of anything.
   */
  async refuseQuote(companyId: string, clientId: string, quoteId: string): Promise<{ status: string }> {
    const quote = await this.documentsService.getDocument(companyId, 'quote', quoteId);
    this.assertBelongsToClient(quote, clientId);
    if (quote.status !== 'sent') {
      throw new ConflictException(
        `Cannot refuse a quote with status "${quote.status}" — it is no longer awaiting a decision.`,
      );
    }
    const updated = await updateDocumentStatus(companyId, 'quote', quoteId, 'refused');
    return { status: updated.status };
  }

  /**
   * TODO_FEATURES.md rank 1 ("paiement en ligne") — opens (or reuses) a Stripe Checkout session for
   * one of THIS client's own invoices. `assertVisibleToClient(..., 'invoice', ...)` is what stands in
   * for the ownership/visibility check every other write in this class already runs through (see this
   * class's own header) — a 404, never a 403, for an invoice belonging to another client of this same
   * company or one this client type never sees at all (a draft). `PaymentSessionsService` itself
   * re-checks status ("sent") and the outstanding balance on top (its own header) — this method's OWN
   * job stops at "does this token's owner get to ask about THIS document at all".
   *
   * `successUrl`/`cancelUrl` point back at `/portal/<token>` — the SAME bootstrap route `[token].tsx`
   * already exists for the emailed portal link (see `PortalIdentity.token`'s own header) — never bare
   * `/portal`: that route reads the token from `localStorage`, which a NEW TAB opened by `PayButton`
   * (see that component's own header — the checkout opens in a separate tab, not a redirect of the
   * current one) has never had a chance to populate. A query flag (`?payment=success|cancelled`,
   * forwarded by `[token].tsx` onto the clean `/portal` URL it redirects to) is never trusted as a
   * payment signal either way — only a verified webhook moves the balance, see
   * `PaymentSessionsService`'s own header — it only picks which toast the frontend shows on return.
   */
  async createInvoiceCheckoutSession(
    companyId: string,
    clientId: string,
    documentId: string,
    token: string,
  ): Promise<InvoiceCheckoutSessionResult> {
    await this.assertVisibleToClient(companyId, clientId, 'invoice', documentId);
    const appUrl = (process.env.APP_URL || '').replace(/\/+$/, '');
    return this.paymentSessions.createInvoiceCheckoutSession(companyId, documentId, {
      successUrl: `${appUrl}/portal/${token}?payment=success`,
      cancelUrl: `${appUrl}/portal/${token}?payment=cancelled`,
    });
  }

  /**
   * A document's own PDF — byte-for-byte `documentsService.renderInstancePdf`'s own output, never a
   * second rendering. Restricted to `PORTAL_DOCUMENT_TYPE_IDS` (invoice/quote/credit-note) and to a
   * `clientVisible` status of THIS client's own — see `assertVisibleToClient` below, the single choke
   * point this whole class's security boundary runs through.
   */
  async getDocumentPdf(
    companyId: string,
    clientId: string,
    typeId: string,
    documentId: string,
  ): Promise<Buffer> {
    if (!isPortalDocumentType(typeId)) {
      throw new NotFoundException(`Document type "${typeId}" is not available in the client portal.`);
    }
    await this.assertVisibleToClient(companyId, clientId, typeId, documentId);
    return this.documentsService.renderInstancePdf(companyId, typeId, documentId);
  }

  /**
   * THE security boundary, in one place: resolves `typeId`/`documentId` (tenant-scoped 404, via
   * `DocumentsService.getDocument`) and refuses — with the SAME 404, never a distinguishing message —
   * unless BOTH hold:
   *  1. the instance's own status is `clientVisible` on this type's descriptor (a draft, an in-flight
   *     send, or any status the type never opted in never resolves here, regardless of client);
   *  2. the instance actually belongs to `clientId` — direct `client` field for invoice/quote, or, for
   *     a credit note (which carries no `client` field of its own — see `client-visibility.ts`'s own
   *     header), the INVOICE it corrects belongs to `clientId`.
   *
   * A 404 (never 403) for a wrong-client document on purpose: the same "existence and ownership are
   * indistinguishable from outside" discipline `findOwnedDocument` already holds for
   * company-ownership — telling client A "this document exists, you may just not open it" would leak
   * that SOME client of this company has a document with this id, information this boundary owes
   * NEITHER client. See `portal.service.spec.ts`'s own "client A cannot reach client B's document" for
   * the test that pins exactly this.
   */
  private async assertVisibleToClient(
    companyId: string,
    clientId: string,
    typeId: string,
    documentId: string,
  ): Promise<DocumentInstanceResult> {
    const descriptor = this.documentsService.getType(typeId);
    const instance = await this.documentsService.getDocument(companyId, typeId, documentId);
    const visible = clientVisibleStatusIds(descriptor);

    if (
      !visible.has(instance.status) ||
      !(await this.resolvesToClient(companyId, typeId, instance, clientId))
    ) {
      throw new NotFoundException(`Document "${documentId}" not found for this client.`);
    }
    return instance;
  }

  /** The synchronous, in-memory half of the SAME check — used by the two write paths above, which
   *  already know `instance.status` is exactly "sent" (a `clientVisible` status on both types that
   *  matters here) and so only need the ownership half, never a second descriptor lookup. */
  private assertBelongsToClient(instance: DocumentInstanceResult, clientId: string): void {
    const data = (instance.data ?? {}) as Record<string, unknown>;
    if (directClientId(data) !== clientId) {
      throw new NotFoundException(`Document "${instance.id}" not found for this client.`);
    }
  }

  /** Resolves whether `instance` (of `typeId`) belongs to `clientId` — direct field for
   *  invoice/quote, joined through the corrected invoice for a credit note. See this file's own
   *  header, `client-visibility.ts`'s, and `settlement/credits.ts`'s (the same join, for the same
   *  reason) for why "credit-note" is the one type resolved differently. */
  private async resolvesToClient(
    companyId: string,
    typeId: string,
    instance: DocumentInstanceResult,
    clientId: string,
  ): Promise<boolean> {
    const data = (instance.data ?? {}) as Record<string, unknown>;
    if (typeId !== 'credit-note') {
      return directClientId(data) === clientId;
    }
    const invoiceId = invoiceIdOfCreditNote(data);
    if (!invoiceId) return false;
    const invoice = await findOwnedDocument(companyId, 'invoice', invoiceId).catch(() => null);
    if (!invoice) return false;
    const invoiceData = (invoice.data ?? {}) as Record<string, unknown>;
    return directClientId(invoiceData) === clientId;
  }
}
