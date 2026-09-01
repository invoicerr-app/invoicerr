import { z } from 'zod';

import { ClientType, Currency } from '../../../../prisma/generated/prisma/client';
import { hasScope } from '@/utils/scope-check';
import { ToolDescriptor } from './types';

const inputSchema = {
  name: z
    .string()
    .describe(
      'Client display name (company name, or leave empty for an individual and use contactFirstname/contactLastname instead)',
    ),
  address: z.string(),
  addressLine2: z.string().optional(),
  postalCode: z.string(),
  city: z.string(),
  state: z.string().optional(),
  country: z.string(),
  currency: z.nativeEnum(Currency),
  type: z.nativeEnum(ClientType).optional(),
  description: z.string().optional(),
  legalId: z.string().optional().describe('Legal identification number (SIRET, EIN, etc.)'),
  VAT: z.string().optional(),
  foundedAt: z.string().datetime().optional(),
  contactFirstname: z.string().optional(),
  contactLastname: z.string().optional(),
  contactEmail: z.string().optional(),
  contactPhone: z.string().optional(),
};

const outputSchema = {
  id: z.string(),
  name: z.string(),
};

// Reprised, unchanged in spirit, from the repère's own `create_client` (git tag
// `avant-refonte-documents`) — a real business ENTITY, not a document type.
export const createClientTool: ToolDescriptor<typeof inputSchema> = {
  name: 'create_client',
  description:
    'Create a new client in the active company. ' +
    "Call list_clients first to check whether a client matching the user's request already exists — do not create a duplicate. " +
    'If list_clients returns an ambiguous or partial match, ask the user to confirm before creating a new record.',
  isRegistered: (scopes) => hasScope({ scopes }, 'clients:write'),
  inputSchema,
  outputSchema,
  handler: async (ctx, input) => {
    const client = await ctx.services.clientsService.createClient(ctx.companyId, {
      ...input,
      id: '', // ignored on create — required by the DTO type, not by the service
      isActive: true,
      foundedAt: input.foundedAt ? new Date(input.foundedAt) : undefined,
    });

    return {
      content: [{ type: 'text', text: `Client "${client.name}" created (id: ${client.id}).` }],
      structuredContent: { id: client.id, name: client.name },
    };
  },
};
