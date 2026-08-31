import { BadRequestException } from '@nestjs/common';

import { ClientsService } from '@/modules/clients/clients.service';
import { MailService } from '@/mail/mail.service';

import { sendDocumentInstanceEmail } from '../actions/send-document-email';
import { DocumentTypeRegistry } from '../descriptors/type-registry';
import { EntityReferenceRegistry } from '../references/reference-registry';
import { SigningCredentialsPort } from '../signing/signing-credentials-port';
import { DocumentTransport, DocumentTransportContext, DocumentTransportResult } from './transport-registry';

export interface EmailTransportDeps {
  clientsService: ClientsService;
  mailService: MailService;
  typeRegistry: DocumentTypeRegistry;
  referenceRegistry: EntityReferenceRegistry;
  /** Root TODO item 13 — threaded straight through to `sendDocumentInstanceEmail`; see
   *  `SendDocumentEmailDeps.signingCertificates`'s own header for the "optional, no-cert-is-a-no-op"
   *  contract this preserves. */
  signingCertificates?: SigningCredentialsPort;
}

/**
 * The built-in "email" transport — ONE entry in TransportRegistry among however many a company can
 * choose from, not a fallback the invoice's "send" reaches for on its own. A company opts into it by
 * setting `invoiceTransportId: "email"` exactly the way it would opt into any third-party transport;
 * nothing about invoice-actions.ts treats this id specially.
 *
 * Unlike the quote's own send-by-email plumbing (quote-actions.ts's registerEmailSendAction, where
 * the user TYPES a recipient into the action's own params), this transport resolves the recipient
 * itself from the document's `client` field — the transport owns its own addressing scheme, the same
 * way a hypothetical non-email transport would derive whatever IT needs (an endpoint id, a queue
 * name...) from the document/company instead of a generic "recipient" param the action would
 * otherwise have to pretend applies to every transport equally.
 *
 * Once addressed, the ACTUAL composition (PDF attached, subject/body from the invoice's own `email`
 * template or a company override) is `sendDocumentInstanceEmail`'s job (actions/send-document-email.ts)
 * — the exact same function the quote's own "send" calls, so both attach an identical PDF pipeline
 * without a second implementation of any of it. See that function's own header for the
 * numbering-pulled-forward and PDF-failure-fails-loudly behavior this transport inherits by calling
 * it — this file only ever decides ADDRESSING, never composition or delivery mechanics.
 */
export function buildEmailTransport(deps: EmailTransportDeps): DocumentTransport {
  return {
    async send(ctx: DocumentTransportContext): Promise<DocumentTransportResult> {
      const data = (ctx.document.data ?? {}) as Record<string, unknown>;
      const clientId = typeof data.client === 'string' ? data.client : undefined;
      const client = clientId ? await deps.clientsService.getClientById(ctx.companyId, clientId) : null;

      if (!client?.contactEmail) {
        throw new BadRequestException(
          `Cannot send by email: the client on this ${ctx.label.toLowerCase()} has no contact email on file.`,
        );
      }

      return sendDocumentInstanceEmail(
        {
          mailService: deps.mailService,
          typeRegistry: deps.typeRegistry,
          referenceRegistry: deps.referenceRegistry,
          signingCertificates: deps.signingCertificates,
        },
        {
          companyId: ctx.companyId,
          typeId: ctx.document.typeId,
          document: ctx.document,
          recipient: client.contactEmail,
          label: ctx.label,
        },
      );
    },
  };
}
