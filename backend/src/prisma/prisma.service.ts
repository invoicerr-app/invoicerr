import "dotenv/config";

import { Injectable } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../prisma/generated/prisma/client";

@Injectable()
export class PrismaService extends PrismaClient {
	constructor() {
		const adapter = new PrismaPg({
			connectionString: process.env.DATABASE_URL as string,
		});
		super({ adapter });
	}
}

/**
 * Module-level singleton for legacy consumers that do
 *   `import prisma from '@/prisma/prisma.service'`
 * The DI class above is the canonical path for NestJS modules;
 * this default export exists solely to keep non-DI callers working
 * without a mass migration.
 */
const prisma = new PrismaService();
export default prisma;