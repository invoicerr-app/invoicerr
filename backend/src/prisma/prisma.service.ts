import 'dotenv/config';

import { Injectable } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../prisma/generated/prisma/client';
import { buildDatabasePoolConfig } from './database-pool-config';

// `buildDatabasePoolConfig` — see that file's own header — is what stands between this pool and pg's
// own silent defaults (`max: 10`, no `connectionTimeoutMillis` at all, i.e. no timeout). Bare
// `{ connectionString }` was the ENTIRE config here before: fine for a serverless Postgres provider
// fronted by its own connection pooler, wrong the moment the database behind DATABASE_URL is a
// traditional managed instance with no pooler at all — every one of these `max` connections then
// becomes a real backend process on the database server.
const adapter = new PrismaPg(buildDatabasePoolConfig(process.env.DATABASE_URL as string));

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
