/**
 * InboundInvoiceDocumentSink — Nest adapter wiring `InboundDocumentSink` (the pure port
 * `InboxPoller` calls for full-document messages, see lifecycle/drivers/inbound-document-sink.ts)
 * onto the EXISTING `InboundInvoiceService.receiveDocument()` — the SAME parse/store/dedup path
 * already used by the `receive/:channel` webhook (M-6 / F-15: no parallel reception path).
 */
import { Injectable } from '@nestjs/common';
import {
  InboundDocumentSink,
  InboundDocumentSinkInput,
  InboundDocumentSinkResult,
} from '../lifecycle/drivers/inbound-document-sink';
import { InboundInvoiceService } from './inbound-invoice.service';

@Injectable()
export class InboundInvoiceDocumentSink implements InboundDocumentSink {
  constructor(private readonly inboundInvoices: InboundInvoiceService) {}

  async receive(input: InboundDocumentSinkInput): Promise<InboundDocumentSinkResult> {
    return this.inboundInvoices.receiveDocument(input);
  }
}
