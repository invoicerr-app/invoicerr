import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { VatValidationPort } from '@/compliance/canonical/vat-validation.port';

/**
 * C4 — how stale a verdict may be before it is asked again.
 *
 * A VAT registration can be withdrawn, so "valid as of 2019" is not a fact about today. Ninety days
 * is a deliberate, arbitrary-but-stated choice: long enough that a client edited twice in a week
 * does not hammer VIES, short enough that a deregistration surfaces within a quarter. An
 * UNAVAILABLE verdict is retried on the next edit whatever its age — it was never an answer.
 */
const REVALIDATE_AFTER_DAYS = 90;

function needsRevalidation(row?: { validationStatus: string | null; validatedAt: Date | null }): boolean {
  if (!row) return true;
  if (row.validationStatus !== 'VALID') return true;
  if (!row.validatedAt) return true;
  const ageDays = (Date.now() - row.validatedAt.getTime()) / 86_400_000;
  return ageDays > REVALIDATE_AFTER_DAYS;
}

import { EditClientsDto, IdentifierEntry } from '@/modules/clients/dto/clients.dto';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { WebhookEvent } from '../../../prisma/generated/prisma/client';
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

@Injectable()
export class ClientsService {
  constructor(
    private readonly webhookDispatcher: WebhookDispatcherService,
    @Inject('VAT_VALIDATION_CLIENT') private readonly vatValidation: VatValidationPort,
  ) {}

  async getClients(companyId: string, page: string) {
    const pageNumber = parseInt(page, 10) || 1;
    const pageSize = 10;
    const skip = (pageNumber - 1) * pageSize;

    const clients = await prisma.client.findMany({
      where: { companyId },
      skip,
      take: pageSize,
      orderBy: {
        name: 'asc',
      },
      include: { partyIdentifiers: true },
    });

    const totalClients = await prisma.client.count({ where: { companyId } });

    return { pageCount: Math.ceil(totalClients / pageSize), clients };
  }

  async searchClients(companyId: string, query: string) {
    if (!query) {
      return prisma.client.findMany({
        where: { companyId, isActive: true },
        take: 10,
        orderBy: {
          name: 'asc',
        },
        include: { partyIdentifiers: true },
      });
    }

    const results = await prisma.client.findMany({
      where: {
        companyId,
        isActive: true,
        OR: [
          { name: { contains: query } },
          { contactFirstname: { contains: query } },
          { contactLastname: { contains: query } },
          { contactEmail: { contains: query } },
          { contactPhone: { contains: query } },
          { address: { contains: query } },
          { postalCode: { contains: query } },
          { city: { contains: query } },
          { country: { contains: query } },
        ],
      },
      take: 10,
      orderBy: {
        name: 'asc',
      },
      include: { partyIdentifiers: true },
    });

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.CLIENT_SEARCHED, {
        query,
        results: results.length,
      });
    } catch (error) {
      logger.error('Failed to dispatch CLIENT_SEARCHED webhook', { category: 'client', details: { error } });
    }

    return results;
  }

  private async upsertPartyIdentifiers(
    clientId: string,
    identifiers: IdentifierEntry[] | undefined,
    // C4: VIES is addressed per member state, so the client's country is needed to ask at all.
    countryCode: string | null | undefined,
  ) {
    if (!identifiers) return;

    const existing = await prisma.partyIdentifier.findMany({
      where: { clientId },
    });

    const incomingSchemes = new Set(identifiers.map((i) => i.scheme));

    for (const row of existing) {
      if (!incomingSchemes.has(row.scheme)) {
        await prisma.partyIdentifier.delete({ where: { id: row.id } });
      }
    }

    for (const entry of identifiers) {
      const before = existing.find((r) => r.scheme === entry.scheme);
      const row = await prisma.partyIdentifier.upsert({
        where: { clientId_scheme: { clientId, scheme: entry.scheme } },
        create: { clientId, scheme: entry.scheme, value: entry.value },
        update: { value: entry.value },
      });

      // C4: validate the VAT number HERE — when it is entered or changed — and never at issuance.
      // Validating at issuance would make emitting an invoice depend on a third-party service that
      // is regularly saturated, which is exactly what the port's UNAVAILABLE verdict exists to
      // avoid. Here a slow or failing VIES only delays a form submission.
      //
      // A changed value invalidates any previous verdict: it is a different number.
      const valueChanged = before?.value !== entry.value;
      if (entry.scheme === 'VAT' && countryCode && (valueChanged || needsRevalidation(before))) {
        await this.validateAndPersistVat(row.id, countryCode, entry.value);
      }
    }
  }

  /**
   * C4 — validate a VAT number and persist the verdict with its date.
   *
   * Never throws: the port's contract is that a transport failure is an UNAVAILABLE verdict, and
   * saving a client must not fail because the European Commission's service is down.
   */
  private async validateAndPersistVat(identifierId: string, countryCode: string, value: string) {
    const result = await this.vatValidation.validate(countryCode, value);
    await prisma.partyIdentifier.update({
      where: { id: identifierId },
      data: {
        validationStatus: result.status,
        validatedAt: result.checkedAt,
        validationSource: result.source,
      },
    });
    if (result.status !== 'VALID') {
      logger.warn('VAT number not verified', {
        category: 'client',
        details: { identifierId, status: result.status, source: result.source },
      });
    }
  }

  async createClient(companyId: string, editClientsDto: EditClientsDto) {
    const { id, identifiers, ...data } = editClientsDto;

    const type = (data as any).type || 'COMPANY';

    if (type === 'INDIVIDUAL') {
      data.name = ``;
      if (!data.contactFirstname || (data.contactFirstname as string).trim() === '') {
        logger.error('First name is required for individual clients', { category: 'client' });
        throw new BadRequestException('First name is required for individual clients');
      }
      if (!data.contactLastname || (data.contactLastname as string).trim() === '') {
        logger.error('Last name is required for individual clients', { category: 'client' });
        throw new BadRequestException('Last name is required for individual clients');
      }
    } else {
      data.contactFirstname = undefined;
      data.contactLastname = undefined;
      if (!data.name || (data.name as string).trim() === '') {
        logger.error('Company name is required for company clients', { category: 'client' });
        throw new BadRequestException('Company name is required for company clients');
      }
    }

    const newClient = await prisma.client.create({ data: { ...data, companyId } });

    await this.upsertPartyIdentifiers(newClient.id, identifiers, newClient.countryCode ?? newClient.country);

    logger.info('Client created', { category: 'client', details: { clientId: newClient.id } });

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.CLIENT_CREATED, {
        client: newClient,
      });
    } catch (error) {
      logger.error('Failed to dispatch CLIENT_CREATED webhook', { category: 'client', details: { error } });
    }

    return newClient;
  }

  async editClientsInfo(companyId: string, editClientsDto: EditClientsDto) {
    if (!editClientsDto.id) {
      logger.error('Client ID is required for editing', { category: 'client' });
      throw new BadRequestException('Client ID is required for editing');
    }

    const existingClient = await prisma.client.findFirst({
      where: { id: editClientsDto.id, companyId },
    });
    if (!existingClient) {
      logger.error('Client not found', { category: 'client', details: { id: editClientsDto.id } });
      throw new NotFoundException('Client not found');
    }

    const { identifiers, ...dataFields } = editClientsDto;
    const data = { ...dataFields } as any;
    // Prefer explicit type in payload, otherwise fall back to existing client's type
    const type = data.type || existingClient.type || 'COMPANY';

    if (type === 'INDIVIDUAL') {
      if (!data.contactFirstname || (data.contactFirstname as string).trim() === '') {
        logger.error('First name is required for individual clients', { category: 'client' });
        throw new BadRequestException('First name is required for individual clients');
      }
      if (!data.contactLastname || (data.contactLastname as string).trim() === '') {
        logger.error('Last name is required for individual clients', { category: 'client' });
        throw new BadRequestException('Last name is required for individual clients');
      }
    } else {
      if (!data.name || (data.name as string).trim() === '') {
        logger.error('Company name is required for company clients', { category: 'client' });
        throw new BadRequestException('Company name is required for company clients');
      }
    }

    const updatedClient = await prisma.client.update({
      where: { id: editClientsDto.id },
      data: { ...dataFields, isActive: true },
    });

    await this.upsertPartyIdentifiers(
      updatedClient.id,
      identifiers,
      updatedClient.countryCode ?? updatedClient.country,
    );

    logger.info('Client updated', { category: 'client', details: { clientId: updatedClient.id } });

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.CLIENT_UPDATED, {
        client: updatedClient,
      });
    } catch (error) {
      logger.error('Failed to dispatch CLIENT_UPDATED webhook', { category: 'client', details: { error } });
    }

    return updatedClient;
  }

  async deleteClient(companyId: string, id: string) {
    const existingClient = await prisma.client.findFirst({ where: { id, companyId } });

    if (!existingClient) {
      logger.error('Client not found', { category: 'client', details: { id } });
      throw new NotFoundException('Client not found');
    }

    const deletedClient = await prisma.client.update({
      where: { id },
      data: { isActive: false },
    });

    logger.info('Client deleted', { category: 'client', details: { clientId: id } });

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.CLIENT_DELETED, {
        client: existingClient,
      });
    } catch (error) {
      logger.error('Failed to dispatch CLIENT_DELETED webhook', { category: 'client', details: { error } });
    }

    return deletedClient;
  }
}
