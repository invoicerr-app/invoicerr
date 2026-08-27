import { ClientType } from '../../../../prisma/generated/prisma/client';

import { ToolDescriptor } from './types';
import { z } from 'zod';

const inputSchema = {
    query: z.string().optional().describe(
        'Optional text filter matched against name, contact name/email/phone, and address fields. Omit to list the most recent active clients.',
    ),
};

const outputSchema = {
    clients: z.array(z.object({
        id: z.string(),
        name: z.string(),
        type: z.nativeEnum(ClientType),
        legalId: z.string().nullable(),
        contactFirstname: z.string().nullable(),
        contactLastname: z.string().nullable(),
        contactEmail: z.string().nullable(),
        contactPhone: z.string().nullable(),
        city: z.string(),
        country: z.string(),
    })),
};

export const listClientsTool: ToolDescriptor<typeof inputSchema> = {
    name: 'list_clients',
    description:
        'List existing active clients in the active company, optionally filtered by a name, contact, or address search query (e.g. "Thomas D" or "Acme"). ' +
        'ALWAYS call this before create_client, and before create_quote/create_invoice when you only have a client name from the user, to find the clientId they need and to avoid creating a duplicate client. ' +
        'If the results include two or more clients that could plausibly be the one the user means, do not guess and do not create a new client — ask the user to confirm which existing client they mean (quoting enough distinguishing detail, e.g. city, contact name, or email) or to confirm they want a brand-new client.',
    scope: 'clients:read',
    inputSchema,
    outputSchema,
    handler: async (ctx, input) => {
        const clients = await ctx.services.clientsService.searchClients(ctx.companyId, input.query ?? '');
        const summary = clients.map((c) => ({
            id: c.id,
            name: c.name,
            type: c.type,
            legalId: c.legalId,
            contactFirstname: c.contactFirstname,
            contactLastname: c.contactLastname,
            contactEmail: c.contactEmail,
            contactPhone: c.contactPhone,
            city: c.city,
            country: c.country,
        }));

        return {
            content: [{ type: 'text', text: `${summary.length} client(s) found.` }],
            structuredContent: { clients: summary },
        };
    },
};
