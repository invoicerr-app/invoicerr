/**
 * InboundDocumentSink — port for persisting a FULL inbound document (a brand-new e-invoice we
 * never sent, e.g. a KSeF purchase invoice where the polled company is the buyer) into the
 * received-invoice store (M-6 / F-15).
 *
 * This is deliberately a SEPARATE seam from `InboundRouter` (inbound-router.ts): the router
 * correlates a STATUS ping (delivery receipt, notifica, MLR…) against a `CallbackRegistration`
 * created when WE transmitted a document — there is no such registration for a document a third
 * party sent TO us, so routing a purchase invoice through `InboundRouter.receive()` would always
 * come back UNMATCHED. `InboxPoller.tick()` picks the right seam per message: an `InboxMessage`
 * carrying `documentBytes` (see inbox-port.ts) is a full document → routed here; one without is a
 * status ping → routed through `InboundRouter` as before.
 *
 * The concrete implementation (`InboundInvoiceDocumentSink`, reception/inbound-invoice-document-sink.ts)
 * wraps the existing `InboundInvoiceService.receiveDocument()` — the SAME parse/store/dedup path
 * already used by the `receive/:channel` webhook, so purchase invoices pulled via KSeF's query API
 * show up in the identical `received-invoices` list/store as documents pushed to us by a webhook.
 * No parallel reception path is introduced.
 */
import { ChannelType } from '../../types';

export interface InboundDocumentSinkInput {
  /** The receiving (buyer) company — mandatory multi-tenant scope. */
  companyId: string;
  channel: ChannelType;
  /** Specific provider id, e.g. 'ksef'. */
  providerId?: string;
  /** Authority-assigned document ID — the dedup key (paired with `channel`). */
  externalId: string;
  /** Raw e-invoice payload (XML/JSON string) verbatim. */
  rawPayload: string;
  /** DocumentSyntax hint (e.g. 'FA_VAT'). */
  syntax?: string;
  /** Sender endpoint / tax ID, for quick display. */
  senderId?: string;
}

export interface InboundDocumentSinkResult {
  kind: 'STORED' | 'DUPLICATE';
  id: string;
}

export interface InboundDocumentSink {
  receive(input: InboundDocumentSinkInput): Promise<InboundDocumentSinkResult>;
}
