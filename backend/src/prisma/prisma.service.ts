import 'dotenv/config';

import { Injectable } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { formatPattern } from '@/utils/pdf';
import { Prisma, PrismaClient } from '../../prisma/generated/prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL as string });

// Quote/Invoice carry companyId directly; Payment only carries invoiceId, so
// its companyId has to be resolved through the invoice it belongs to. Defined
// as a function (not a const) so it can reference `prisma` below despite
// being declared above it — same forward-reference pattern already used by
// the query hooks in this extension.
async function resolveCompanyId(
  _model: string,
  record: { companyId?: string; invoiceId?: string },
): Promise<string> {
  if (record.companyId) {
    return record.companyId;
  }
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: record.invoiceId as string } });
  return invoice.companyId;
}

function createExtendedClient() {
  return new PrismaClient({ adapter }).$extends({
    query: {
      $allModels: {
        async findMany({ model, args, query }) {
          if (
            ['Quote', 'Invoice', 'Payment'].includes(model) &&
            args?.where &&
            (args.where as Prisma.QuoteWhereInput | Prisma.InvoiceWhereInput | Prisma.PaymentWhereInput)
              .rawNumber === null
          ) {
            return query(args);
          }

          const result = await query(args);

          // Backfill missing rawNumbers (legacy rows created before the numbering hooks).
          if (['Quote', 'Invoice', 'Payment'].includes(model)) {
            if (model === 'Quote') {
              const toUpdate = await prisma.quote.findMany({
                where: { rawNumber: null, number: { not: null } },
              });
              await Promise.all(
                toUpdate.map(async (quote) => {
                  const formattedNumber = await formatPattern(
                    'quote',
                    quote.number,
                    quote.createdAt,
                    quote.companyId,
                  );
                  await prisma.quote.update({
                    where: { id: quote.id },
                    data: { rawNumber: formattedNumber },
                  });
                }),
              );
            }

            if (model === 'Invoice') {
              const toUpdate = await prisma.invoice.findMany({
                where: { rawNumber: null, number: { not: null } },
              });
              await Promise.all(
                toUpdate.map(async (invoice) => {
                  const formattedNumber = await formatPattern(
                    'invoice',
                    invoice.number,
                    invoice.createdAt,
                    invoice.companyId,
                  );
                  await prisma.invoice.update({
                    where: { id: invoice.id },
                    data: { rawNumber: formattedNumber },
                  });
                }),
              );
            }

            if (model === 'Payment') {
              const toUpdate = await prisma.payment.findMany({
                where: { rawNumber: null, number: { not: null } },
                include: { invoice: true },
              });
              await Promise.all(
                toUpdate.map(async (payment) => {
                  const formattedNumber = await formatPattern(
                    'payment',
                    payment.number,
                    payment.createdAt,
                    payment.invoice.companyId,
                  );
                  await prisma.payment.update({
                    where: { id: payment.id },
                    data: { rawNumber: formattedNumber },
                  });
                }),
              );
            }
          }

          return result;
        },

        async create({ model, args, query }) {
          const result = await query(args);

          if (['Quote', 'Invoice', 'Payment'].includes(model)) {
            const typedResult = result as
              | Prisma.QuoteGetPayload<Record<string, never>>
              | Prisma.InvoiceGetPayload<Record<string, never>>
              | Prisma.PaymentGetPayload<Record<string, never>>;
            // `number` null = brouillon : pas de numéro, donc pas de numéro formaté. Sans cette
            // garde, tous les brouillons recevaient le même `…-0000`.
            if (!typedResult.rawNumber && typedResult.number !== null && typedResult.number !== undefined) {
              const companyId = await resolveCompanyId(model, typedResult);
              const formattedNumber = await formatPattern(
                model.toLowerCase() as 'quote' | 'invoice' | 'payment',
                typedResult.number,
                typedResult.createdAt,
                companyId,
              );
              await (
                prisma[model.toLowerCase() as 'quote' | 'invoice' | 'payment'] as {
                  update: (a: { where: { id: string }; data: { rawNumber: string } }) => Promise<unknown>;
                }
              ).update({
                where: { id: typedResult.id },
                data: { rawNumber: formattedNumber },
              });
            }
          }

          return result;
        },

        async update({ model, args, query }) {
          const result = await query(args);

          if (['Quote', 'Invoice', 'Payment'].includes(model)) {
            const typedResult = result as
              | Prisma.QuoteGetPayload<Record<string, never>>
              | Prisma.InvoiceGetPayload<Record<string, never>>
              | Prisma.PaymentGetPayload<Record<string, never>>;
            // `number` null = brouillon : pas de numéro, donc pas de numéro formaté. Sans cette
            // garde, tous les brouillons recevaient le même `…-0000`.
            if (!typedResult.rawNumber && typedResult.number !== null && typedResult.number !== undefined) {
              const companyId = await resolveCompanyId(model, typedResult);
              const formattedNumber = await formatPattern(
                model.toLowerCase() as 'quote' | 'invoice' | 'payment',
                typedResult.number,
                typedResult.createdAt,
                companyId,
              );
              await (
                prisma[model.toLowerCase() as 'quote' | 'invoice' | 'payment'] as {
                  update: (a: { where: { id: string }; data: { rawNumber: string } }) => Promise<unknown>;
                }
              ).update({
                where: { id: typedResult.id },
                data: { rawNumber: formattedNumber },
              });
            }
          }

          return result;
        },
      },
    },
  });
}

export type ExtendedPrismaClient = ReturnType<typeof createExtendedClient>;

/**
 * Module-level singleton. Carries the numbering hooks above; shared by BOTH the
 * legacy `import prisma from '@/prisma/prisma.service'` consumers and the NestJS
 * DI class below, so every code path gets the same extended client.
 */
const prisma = createExtendedClient();
export default prisma;

/**
 * NestJS DI token. The base-class constructor RETURNS the extended singleton, so the
 * injected instance IS the extended client — every model delegate (incl. the
 * compliance models) and `$transaction` exist without hand-written getters, and the
 * numbering hooks apply on the DI path too. The `new () => ExtendedPrismaClient`
 * assertion gives the class the extended client's full static type.
 */
@Injectable()
class PrismaServiceToken {
  constructor() {
    // Substitute the DI instance with the shared extended singleton so every
    // injection point gets the SAME client (numbering hooks + one pool).
    // biome-ignore lint/correctness/noConstructorReturn: deliberate instance substitution — the token class must hand out the extended singleton
    return prisma as unknown as PrismaServiceToken;
  }
}

/**
 * Value+type merge: the VALUE is the Nest DI token (class above); the TYPE is the
 * extended client, so `constructor(private prisma: PrismaService)` exposes every
 * model delegate (incl. compliance models), `$transaction`, `$queryRaw`, …
 */
export const PrismaService = PrismaServiceToken as unknown as new () => ExtendedPrismaClient;
export type PrismaService = ExtendedPrismaClient;
