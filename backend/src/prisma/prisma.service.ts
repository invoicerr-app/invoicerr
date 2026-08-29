import 'dotenv/config';

import { Injectable } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../prisma/generated/prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL as string });

/**
 * Le client Prisma, nu.
 *
 * Il portait jusqu'ici une extension de requête qui fabriquait les NUMÉROS de documents — devis,
 * factures, paiements : formatage à la création, rattrapage des lignes anciennes, reformatage à la
 * mise à jour. Ces documents sont supprimés, l'extension avec. Ce qui reste est un client
 * ordinaire, et c'est tant mieux : cette extension était aussi l'endroit où tous les brouillons
 * recevaient le même numéro fabriqué.
 */
const prisma = new PrismaClient({ adapter });
export default prisma;

export type ExtendedPrismaClient = PrismaClient;

/**
 * Jeton d'injection NestJS. Le constructeur RETOURNE le singleton, donc l'instance injectée EST le
 * client partagé — un seul pool pour tous les chemins d'accès.
 */
@Injectable()
class PrismaServiceToken {
  constructor() {
    // biome-ignore lint/correctness/noConstructorReturn: substitution délibérée — le jeton distribue le singleton
    return prisma as unknown as PrismaServiceToken;
  }
}

export const PrismaService = PrismaServiceToken as unknown as new () => ExtendedPrismaClient;
export type PrismaService = ExtendedPrismaClient;
