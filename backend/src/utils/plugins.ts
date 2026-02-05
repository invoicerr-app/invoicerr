import 'dotenv/config'

import { PrismaClient } from '../../prisma/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

export interface SigningPluginConfig {
    baseUrl: string;
    apiKey: string;
}

export async function getProviderConfig<T>(name: string) {
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
    const prisma = new PrismaClient({ adapter });

    const plugin = await prisma.plugin.findFirst({
        where: {
            isActive: true,
            id: name,
        }
    })

    prisma.$disconnect();

    return (plugin?.config as T);
}
