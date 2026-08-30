import { BadRequestException } from '@nestjs/common';

import { ClientsService } from '@/modules/clients/clients.service';
import { MailService } from '@/mail/mail.service';

import { DocumentTransport, DocumentTransportContext, DocumentTransportResult } from './transport-registry';

/**
 * The built-in "email" transport — ONE entry in TransportRegistry among however many a company can
 * choose from, not a fallback the invoice's "send" reaches for on its own. A company opts into it by
 * setting `invoiceTransportId: "email"` exactly the way it would opt into any third-party transport;
 * nothing about invoice-actions.ts treats this id specially.
 *
 * Unlike the quote's own send-by-email plumbing (quote-actions.ts's registerSendAction, where the
 * user TYPES a recipient into the action's own params), this transport resolves the recipient itself
 * from the document's `client` field — the transport owns its own addressing scheme, the same way a
 * hypothetical non-email transport would derive whatever IT needs (an endpoint id, a queue name...)
 * from the document/company instead of a generic "recipient" param the action would otherwise have
 * to pretend applies to every transport equally.
 */
export function buildEmailTransport(
  clientsService: ClientsService,
  mailService: MailService,
): DocumentTransport {
  return {
    async send(ctx: DocumentTransportContext): Promise<DocumentTransportResult> {
      const data = (ctx.document.data ?? {}) as Record<string, unknown>;
      const clientId = typeof data.client === 'string' ? data.client : undefined;
      const client = clientId ? await clientsService.getClientById(ctx.companyId, clientId) : null;

      if (!client?.contactEmail) {
        throw new BadRequestException(
          `Cannot send by email: the client on this ${ctx.label.toLowerCase()} has no contact email on file.`,
        );
      }

      await mailService.sendMail({
        to: client.contactEmail,
        subject: `${ctx.label} ${ctx.document.id}`,
        text: ctx.text,
      });

      return { message: `${ctx.label} sent to ${client.contactEmail}.` };
    },
  };
}
