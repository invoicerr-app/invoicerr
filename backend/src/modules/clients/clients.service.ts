import { BadRequestException, Injectable } from "@nestjs/common";
import { logger } from "@/logger/logger.service";
import { EditClientsDto } from "@/modules/clients/dto/clients.dto";
import prisma from "@/prisma/prisma.service";
import { WebhookEvent } from "../../../prisma/generated/prisma/client";
import { WebhookDispatcherService } from "../webhooks/webhook-dispatcher.service";
import { TenantContext } from "../tenant/tenant.service";

@Injectable()
export class ClientsService {
	constructor(
		private readonly webhookDispatcher: WebhookDispatcherService,
		private readonly tenantContext: TenantContext,
	) {}

	async getClients(page: string) {
		const pageNumber = parseInt(page, 10) || 1;
		const pageSize = 10;
		const skip = (pageNumber - 1) * pageSize;

		const clients = await prisma.client.findMany({
			skip,
			take: pageSize,
			orderBy: {
				name: "asc",
			},
		});

		const totalClients = await prisma.client.count();

		return { pageCount: Math.ceil(totalClients / pageSize), clients };
	}

	async searchClients(query: string) {
		if (!query) {
			return prisma.client.findMany({
				where: { isActive: true },
				take: 10,
				orderBy: {
					name: "asc",
				},
			});
		}

		const results = await prisma.client.findMany({
			where: {
				isActive: true,
				OR: [
					{ name: { contains: query } },
					{ contactFirstname: { contains: query } },
					{ contactLastname: { contains: query } },
					{ contactEmail: { contains: query } },
					{ contactPhone: { contains: query } },
					{ address: { contains: query } },
					{ postalCode: { contains: query } },
					{ city: { contains: query } },
					{ country: { contains: query } },
				],
			},
			take: 10,
			orderBy: {
				name: "asc",
			},
		});

		try {
			await this.webhookDispatcher.dispatch(WebhookEvent.CLIENT_SEARCHED, {
				query,
				results: results.length,
			});
		} catch (error) {
			logger.error("Failed to dispatch CLIENT_SEARCHED webhook", {
				category: "client",
				details: { error },
			});
		}

		return results;
	}

	async createClient(editClientsDto: EditClientsDto) {
		const { id, ...data } = editClientsDto;

		const type = data.type || "COMPANY";

		if (type === "INDIVIDUAL") {
			data.name = ``;
			if (
				!data.contactFirstname ||
				(data.contactFirstname as string).trim() === ""
			) {
				logger.error("First name is required for individual clients", {
					category: "client",
				});
				throw new BadRequestException(
					"First name is required for individual clients",
				);
			}
			if (
				!data.contactLastname ||
				(data.contactLastname as string).trim() === ""
			) {
				logger.error("Last name is required for individual clients", {
					category: "client",
				});
				throw new BadRequestException(
					"Last name is required for individual clients",
				);
			}
		} else {
			data.contactFirstname = undefined;
			data.contactLastname = undefined;
			if (!data.name || (data.name as string).trim() === "") {
				logger.error("Company name is required for company clients", {
					category: "client",
				});
				throw new BadRequestException(
					"Company name is required for company clients",
				);
			}
			if (!data.legalId || (data.legalId as string).trim() === "") {
				logger.error("SIRET/SIREN (legalId) is required for company clients", {
					category: "client",
				});
				throw new BadRequestException(
					"SIRET/SIREN (legalId) is required for company clients",
				);
			}
		}

		if (!this.tenantContext.companyId) {
			logger.error("Company context is required to create a client", {
				category: "client",
			});
			throw new BadRequestException("Company context is required");
		}

		const newClient = await prisma.client.create({
			data: {
				...data,
				companyId: this.tenantContext.companyId,
			},
		});

		logger.info("Client created", {
			category: "client",
			details: { clientId: newClient.id },
		});

		try {
			await this.webhookDispatcher.dispatch(WebhookEvent.CLIENT_CREATED, {
				client: newClient,
			});
		} catch (error) {
			logger.error("Failed to dispatch CLIENT_CREATED webhook", {
				category: "client",
				details: { error },
			});
		}

		return newClient;
	}

	async editClientsInfo(editClientsDto: EditClientsDto) {
		if (!editClientsDto.id) {
			logger.error("Client ID is required for editing", { category: "client" });
			throw new BadRequestException("Client ID is required for editing");
		}

		const existingClient = await prisma.client.findUnique({
			where: { id: editClientsDto.id },
		});
		if (!existingClient) {
			logger.error("Client not found", {
				category: "client",
				details: { id: editClientsDto.id },
			});
			throw new BadRequestException("Client not found");
		}

		const data: EditClientsDto & { type?: string } = { ...editClientsDto };
		// Prefer explicit type in payload, otherwise fall back to existing client's type
		const type = data.type || existingClient.type || "COMPANY";

		if (type === "INDIVIDUAL") {
			if (
				!data.contactFirstname ||
				(data.contactFirstname as string).trim() === ""
			) {
				logger.error("First name is required for individual clients", {
					category: "client",
				});
				throw new BadRequestException(
					"First name is required for individual clients",
				);
			}
			if (
				!data.contactLastname ||
				(data.contactLastname as string).trim() === ""
			) {
				logger.error("Last name is required for individual clients", {
					category: "client",
				});
				throw new BadRequestException(
					"Last name is required for individual clients",
				);
			}
		} else {
			if (!data.name || (data.name as string).trim() === "") {
				logger.error("Company name is required for company clients", {
					category: "client",
				});
				throw new BadRequestException(
					"Company name is required for company clients",
				);
			}
			if (!data.legalId || (data.legalId as string).trim() === "") {
				logger.error("SIRET/SIREN (legalId) is required for company clients", {
					category: "client",
				});
				throw new BadRequestException(
					"SIRET/SIREN (legalId) is required for company clients",
				);
			}
		}

		const updatedClient = await prisma.client.update({
			where: { id: editClientsDto.id },
			data: { ...editClientsDto, isActive: true },
		});

		logger.info("Client updated", {
			category: "client",
			details: { clientId: updatedClient.id },
		});

		try {
			await this.webhookDispatcher.dispatch(WebhookEvent.CLIENT_UPDATED, {
				client: updatedClient,
			});
		} catch (error) {
			logger.error("Failed to dispatch CLIENT_UPDATED webhook", {
				category: "client",
				details: { error },
			});
		}

		return updatedClient;
	}

	async deleteClient(id: string) {
		const existingClient = await prisma.client.findUnique({ where: { id } });

		if (!existingClient) {
			logger.error("Client not found", { category: "client", details: { id } });
			throw new BadRequestException("Client not found");
		}

		const deletedClient = await prisma.client.update({
			where: { id },
			data: { isActive: false },
		});

		logger.info("Client deleted", {
			category: "client",
			details: { clientId: id },
		});

		try {
			await this.webhookDispatcher.dispatch(WebhookEvent.CLIENT_DELETED, {
				client: existingClient,
			});
		} catch (error) {
			logger.error("Failed to dispatch CLIENT_DELETED webhook", {
				category: "client",
				details: { error },
			});
		}

		return deletedClient;
	}
}
