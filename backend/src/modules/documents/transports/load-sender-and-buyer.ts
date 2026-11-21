import { BadRequestException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { DocumentTransportContext } from './transport-registry';

/**
 * Loads the sending company and the document's client for a transport's `send()`, refusing when
 * either is missing. The client is returned raw: `withIssuedBuyerIdentifiers` stays with the caller.
 *
 * The client read is scoped by `ctx.companyId`: `data.client` comes straight off the document and is
 * never checked for existence at write time (`descriptors/field-kinds.ts`'s comment on the
 * 'reference' kind), so a bare `findUnique` would hand back another tenant's client. A foreign or
 * nonexistent id lands on the same "no valid client on file" refusal as an absent one.
 *
 * `refusalPrefix` names the transport in that refusal, e.g. "Cannot submit to KSeF".
 */
export async function loadSenderAndBuyer(
  ctx: DocumentTransportContext,
  data: Record<string, unknown>,
  refusalPrefix: string,
) {
  const clientId = typeof data.client === 'string' ? data.client : undefined;
  const [company, client] = await Promise.all([
    prisma.company.findUnique({ where: { id: ctx.companyId }, include: { partyIdentifiers: true } }),
    clientId
      ? prisma.client.findFirst({
          where: { id: clientId, companyId: ctx.companyId },
          include: { partyIdentifiers: true, contacts: true },
        })
      : Promise.resolve(null),
  ]);
  if (!company) {
    throw new BadRequestException(`Company "${ctx.companyId}" not found.`);
  }
  if (!client) {
    throw new BadRequestException(
      `${refusalPrefix}: the ${ctx.label.toLowerCase()} has no valid client on file.`,
    );
  }
  return { company, client };
}
