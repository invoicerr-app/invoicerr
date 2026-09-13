import 'dotenv/config';

import { Injectable } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../prisma/generated/prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL as string });

/**
 * The bare Prisma client.
 *
 * It used to carry a query extension that manufactured document NUMBERS — quotes,
 * invoices, payments: formatting at creation, backfilling old rows, reformatting on update. Those
 * documents are gone now, and the extension with them. What's left is a plain client, and that's
 * for the best: that extension was also the one place where every draft ended up receiving the
 * same manufactured number.
 */
const prisma = new PrismaClient({ adapter });
export default prisma;

export type ExtendedPrismaClient = PrismaClient;

/**
 * NestJS injection token. The constructor RETURNS the singleton, so the injected instance IS the
 * shared client — one single pool for every access path.
 */
@Injectable()
class PrismaServiceToken {
  constructor() {
    // biome-ignore lint/correctness/noConstructorReturn: deliberate — the token hands out the singleton
    return prisma as unknown as PrismaServiceToken;
  }
}

export const PrismaService = PrismaServiceToken as unknown as new () => ExtendedPrismaClient;
export type PrismaService = ExtendedPrismaClient;
