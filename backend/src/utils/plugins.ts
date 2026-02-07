import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../prisma/generated/prisma/client";

export interface SigningPluginConfig {
	baseUrl: string;
	apiKey: string;
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	throw new Error("DATABASE_URL environment variable is required");
}

export async function getProviderConfig<T>(name: string) {
	const adapter = new PrismaPg({ connectionString: databaseUrl });
	const prisma = new PrismaClient({ adapter });

	const plugin = await prisma.plugin.findFirst({
		where: {
			isActive: true,
			id: name,
		},
	});

	prisma.$disconnect();

	return plugin?.config as T;
}
