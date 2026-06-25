import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';

import { EditClientsDto, IdentifierEntry } from '@/modules/clients/dto/clients.dto';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { WebhookEvent } from '../../../prisma/generated/prisma/client';
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';



@Injectable()
export class ClientsService {

    constructor(private readonly webhookDispatcher: WebhookDispatcherService) {
    }

    async getClients(page: string) {
        const pageNumber = parseInt(page, 10) || 1;
        const pageSize = 10;
        const skip = (pageNumber - 1) * pageSize;

        const clients = await prisma.client.findMany({
            skip,
            take: pageSize,
            orderBy: {
                name: 'asc',
            },
            include: { partyIdentifiers: true },
        });

        const totalClients = await prisma.client.count();

        return { pageCount: Math.ceil(totalClients / pageSize), clients };
    }

    async searchClients(query: string) {
        if (!query) {
            return prisma.client.findMany({
                where: { isActive: true },
                take: 10,
                orderBy: {
                    name: 'asc',
                },
                include: { partyIdentifiers: true },
            });
        }

        const results = await prisma.client.findMany({
            where: {
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
            await prisma.partyIdentifier.upsert({
                where: { clientId_scheme: { clientId, scheme: entry.scheme } },
                create: { clientId, scheme: entry.scheme, value: entry.value },
                update: { value: entry.value },
            });
        }
    }

    async createClient(editClientsDto: EditClientsDto) {
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

        const newClient = await prisma.client.create({ data });

        await this.upsertPartyIdentifiers(newClient.id, identifiers);

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

    async editClientsInfo(editClientsDto: EditClientsDto) {
        if (!editClientsDto.id) {
            logger.error('Client ID is required for editing', { category: 'client' });
            throw new BadRequestException('Client ID is required for editing');
        }

        const existingClient = await prisma.client.findUnique({ where: { id: editClientsDto.id } });
        if (!existingClient) {
            logger.error('Client not found', { category: 'client', details: { id: editClientsDto.id } });
            throw new BadRequestException('Client not found');
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

        await this.upsertPartyIdentifiers(updatedClient.id, identifiers);

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

    async deleteClient(id: string) {
        const existingClient = await prisma.client.findUnique({ where: { id } });

        if (!existingClient) {
            logger.error('Client not found', { category: 'client', details: { id } });
            throw new BadRequestException('Client not found');
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
