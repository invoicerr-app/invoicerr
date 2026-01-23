import 'dotenv/config';

import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { formatPattern } from '@/utils/pdf';
import { type Prisma, PrismaClient } from '../../prisma/generated/prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });

const prisma = new PrismaClient({ adapter }).$extends({
  query: {
    $allModels: {
      async findMany({ model, args, query }) {
        if (
          ['Quote', 'Invoice', 'Receipt'].includes(model) &&
          args?.where &&
          (
            args.where as
              | Prisma.QuoteWhereInput
              | Prisma.InvoiceWhereInput
              | Prisma.ReceiptWhereInput
          ).rawNumber! === null
        ) {
          return query(args);
        }

        // Exécution de la requête
        const result = await query(args);

        // Mise à jour automatique des rawNumber manquants
        if (['Quote', 'Invoice', 'Receipt'].includes(model)) {
          if (model === 'Quote') {
            const toUpdate = await prisma.quote.findMany({
              where: { rawNumber: null },
              include: { company: true },
            });
            await Promise.all(
              toUpdate.map(async (quote) => {
                const formattedNumber = await formatPattern('quote', quote.number, quote.createdAt);
                await prisma.quote.update({
                  where: { id: quote.id },
                  data: { rawNumber: formattedNumber },
                });
              }),
            );
          }

          if (model === 'Invoice') {
            const toUpdate = await prisma.invoice.findMany({
              where: { rawNumber: null },
              include: { company: true },
            });
            await Promise.all(
              toUpdate.map(async (invoice) => {
                const formattedNumber = await formatPattern(
                  'invoice',
                  invoice.number,
                  invoice.createdAt,
                );
                await prisma.invoice.update({
                  where: { id: invoice.id },
                  data: { rawNumber: formattedNumber },
                });
              }),
            );
          }

          if (model === 'Receipt') {
            const toUpdate = await prisma.receipt.findMany({
              where: { rawNumber: null },
              include: { invoice: { include: { company: true } } },
            });
            await Promise.all(
              toUpdate.map(async (receipt) => {
                const formattedNumber = await formatPattern(
                  'receipt',
                  receipt.number,
                  receipt.createdAt,
                );
                await prisma.receipt.update({
                  where: { id: receipt.id },
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

        if (['Quote', 'Invoice', 'Receipt'].includes(model)) {
          const typedResult = result as
            | Prisma.QuoteGetPayload<undefined>
            | Prisma.InvoiceGetPayload<undefined>
            | Prisma.ReceiptGetPayload<undefined>;
          if (!typedResult.rawNumber) {
            const formattedNumber = await formatPattern(
              model.toLowerCase() as 'quote' | 'invoice' | 'receipt',
              typedResult.number,
              typedResult.createdAt,
            );
            await prisma[model.toLowerCase()].update({
              where: { id: result.id },
              data: { rawNumber: formattedNumber },
            });
          }
        }

        return result;
      },

      async update({ model, args, query }) {
        const result = await query(args);

        if (['Quote', 'Invoice', 'Receipt'].includes(model)) {
          const typedResult = result as
            | Prisma.QuoteGetPayload<undefined>
            | Prisma.InvoiceGetPayload<undefined>
            | Prisma.ReceiptGetPayload<undefined>;
          if (!typedResult.rawNumber) {
            const formattedNumber = await formatPattern(
              model.toLowerCase() as 'quote' | 'invoice' | 'receipt',
              typedResult.number,
              typedResult.createdAt,
            );
            await prisma[model.toLowerCase()].update({
              where: { id: result.id },
              data: { rawNumber: formattedNumber },
            });
          }
        }

        return result;
      },
    },
  },
});

export default prisma;

// Injectable PrismaService for NestJS dependency injection
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly client = prisma;

  async onModuleInit() {
    // Connection is handled by the client automatically
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
  }

  // Expose all Prisma models
  get user() {
    return this.client.user;
  }
  get session() {
    return this.client.session;
  }
  get account() {
    return this.client.account;
  }
  get verification() {
    return this.client.verification;
  }
  get invitationCode() {
    return this.client.invitationCode;
  }
  get company() {
    return this.client.company;
  }
  get client_model() {
    return this.client.client;
  }
  get quote() {
    return this.client.quote;
  }
  get invoice() {
    return this.client.invoice;
  }
  get receipt() {
    return this.client.receipt;
  }
  get recurringInvoice() {
    return this.client.recurringInvoice;
  }
  get paymentMethod() {
    return this.client.paymentMethod;
  }
  get webhook() {
    return this.client.webhook;
  }
  get plugin() {
    return this.client.plugin;
  }
  get numberingSequence() {
    return this.client.numberingSequence;
  }
  // Expose $transaction for complex atomic operations
  $transaction<T>(fn: Parameters<typeof this.client.$transaction>[0]): Promise<T> {
    return this.client.$transaction(fn) as Promise<T>;
  }
}
