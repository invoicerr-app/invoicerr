import { Documenso } from "@documenso/sdk-typescript";
import { DocumentDownloadResponse } from "@documenso/sdk-typescript/models/operations";
import {
	DocumentCreateDocumentTemporaryRecipientRequest,
	DocumentCreateDocumentTemporaryResponse,
} from "@documenso/sdk-typescript/models/operations/documentcreatedocumenttemporary";
import {
	type DocumentGetResponse,
	DocumentGetStatus,
} from "@documenso/sdk-typescript/models/operations/documentget";
import {
	Logger,
	NotFoundException,
	UnauthorizedException,
} from "@nestjs/common";
import { Request } from "express";
import prisma from "@/prisma/prisma.service";
import { getProviderConfig, type SigningPluginConfig } from "@/utils/plugins";
import { markQuoteAs } from "@/utils/plugins/signing";
import { generateQuotePdf } from "@/utils/quote-pdf";
import { QuoteStatus } from "../../../../../prisma/generated/prisma/client";
import { ISigningProvider, RequestSignatureProps } from "../../types";
import { countPdfPages, uploadQuoteFileToUrl } from "../../utils";

const logger = new Logger("DocumensoProvider");

interface DocumensoRecipient {
	email: string;
	name: string;
	role: "SIGNER" | "APPROVER" | "CC";
	readStatus: "NOT_OPENED" | "OPENED";
	signingStatus: "NOT_SIGNED" | "SIGNED" | "REJECTED";
	sendStatus: "NOT_SENT" | "SENT";
}
interface DocumensoWebhookPayload {
	id: number;
	externalId: string;
	status: DocumentGetStatus;
	completedAt: string | null;
	recipients: DocumensoRecipient[];
}

interface DocumensoWebhookBody {
	event:
		| "DOCUMENT_SENT"
		| "DOCUMENT_SIGNED"
		| "DOCUMENT_COMPLETED"
		| "DOCUMENT_REJECTED"
		| "DOCUMENT_PENDING";
	payload: DocumensoWebhookPayload;
}

export class DocumensoProvider implements ISigningProvider {
	id = "documenso";
	name = "Documenso";

	formatServerUrl(url: string) {
		return DocumensoProvider.formatServerUrl(url);
	}

	static formatServerUrl(url: string) {
		if (url.endsWith("/")) {
			url = url.slice(0, -1);
		}

		if (!url.includes("/api")) {
			url += "/api/v2-beta";
		}

		return url;
	}

	static async getClient(): Promise<Documenso> {
		let { baseUrl, apiKey } =
			await getProviderConfig<SigningPluginConfig>("documenso");

		baseUrl = DocumensoProvider.formatServerUrl(baseUrl);

		const client = new Documenso({
			apiKey,
			serverURL: baseUrl,
		});
		return client;
	}

	async requestSignature(props: RequestSignatureProps): Promise<string> {
		const client = await DocumensoProvider.getClient();

		const quote = await prisma.quote.findUnique({
			where: { id: props.id },
			include: {
				client: true,
				company: true,
			},
		});

		if (!quote || !quote.client || !quote.client.contactEmail) {
			throw new Error("Quote or client not found");
		}

		const existingDocument = (await client.documents.find({})).data.find(
			(doc) => doc.externalId === props.id,
		);

		if (existingDocument?.id) {
			await client.documents.distribute({
				documentId: existingDocument.id,
			});
			logger.log(
				`Document already exists for quote ID: ${props.id}, re-sent to recipients.`,
			);
			return `documenso-${existingDocument.id}`;
		}

		const pdfFileUint8Array: Uint8Array = await generateQuotePdf(props.id);

		const pageCount = await countPdfPages(pdfFileUint8Array);

		const recipients: DocumentCreateDocumentTemporaryRecipientRequest[] = [
			{
				email: quote.client.contactEmail,
				name:
					quote.client.type === "INDIVIDUAL"
						? `${quote.client.contactFirstname} ${quote.client.contactLastname}`
						: quote.client.name || "Client",
				role: "SIGNER",
				fields: [
					{
						type: "DATE",
						pageNumber: pageCount,
						pageX: 5,
						pageY: 85,
						width: 20,
						height: 5,
					},
					{
						type: "SIGNATURE",
						pageNumber: pageCount,
						pageX: 5,
						pageY: 93,
						width: 20,
						height: 5,
					},
				],
			},
			{
				email: quote.company.email,
				name: quote.company.name,
				role: "APPROVER",
				fields: [
					{
						type: "DATE",
						pageNumber: pageCount,
						pageX: 100 - 20 - 5,
						pageY: 85,
						width: 20,
						height: 5,
					},
					{
						type: "SIGNATURE",
						pageNumber: pageCount,
						pageX: 100 - 20 - 5,
						pageY: 93,
						width: 20,
						height: 5,
					},
				],
			},
		];

		let response: DocumentCreateDocumentTemporaryResponse;

		try {
			response = await client.documents.createV0({
				title: quote.title || `Quote #${quote.id}`,
				externalId: quote.id,
				recipients: recipients,
			});
		} catch (error) {
			logger.error("Error creating document:", error);
			return Promise.reject(error);
		}

		if (!response.uploadUrl) {
			throw new Error("Failed to create document");
		}

		const document = response.document;
		const uploadUrl = response.uploadUrl;

		logger.log(`Upload URL for document "${props.title}": ${uploadUrl}`);

		await uploadQuoteFileToUrl(pdfFileUint8Array, uploadUrl);

		await client.documents.distribute({
			documentId: document.id,
		});

		return `documenso-${document.id}`;
	}

	async handleWebhook(req: Request, body: DocumensoWebhookBody) {
		const client = await DocumensoProvider.getClient();

		const plugin = await prisma.plugin.findFirst({
			where: {
				id: "documenso",
				isActive: true,
				webhookUrl: {
					not: null,
				},
			},
		});

		if (!plugin) {
			throw new NotFoundException(`Plugin not found`);
		}

		if (req.headers["x-documenso-secret"]) {
			const providedSecret = req.headers["x-documenso-secret"] as string;

			if (!providedSecret) {
				throw new UnauthorizedException(
					"Webhook secret is required but not provided",
				);
			}

			if (providedSecret !== plugin.webhookSecret) {
				logger.warn(`Invalid webhook secret for plugin ${plugin.name}`);
				throw new UnauthorizedException("Invalid webhook secret");
			}

			logger.log(`Webhook secret verified for plugin ${plugin.name}`);
		} else {
			logger.warn(`No webhook secret provided for plugin ${plugin.name}`);
			throw new UnauthorizedException("Webhook secret is required");
		}

		const documentId = body.payload.id;

		logger.log(`Received webhook for document: ${documentId}`);

		let document: DocumentGetResponse;

		try {
			document = await client.documents.get({ documentId });
		} catch (_error) {
			// We can't fetch, because the document was deleted
			return;
		}

		const quote = await prisma.quote.findFirst({
			where: {
				id: document.externalId || "",
			},
			include: { client: true, company: true },
		});

		if (!quote) {
			// It's just a document not linked to any quote, so we can silently ignore it
			return;
		}

		switch (body.payload.status) {
			case DocumentGetStatus.Draft:
				logger.log(`Document draft: ${document.externalId}`);
				await markQuoteAs(quote?.id || "", QuoteStatus.DRAFT);
				break;
			case DocumentGetStatus.Pending:
				logger.log(`Document pending: ${document.externalId}`);
				await markQuoteAs(quote?.id || "", QuoteStatus.SENT);
				break;
			case DocumentGetStatus.Completed:
				logger.log(`Document completed: ${document.externalId}`);
				await markQuoteAs(quote?.id || "", QuoteStatus.SIGNED);

				break;
			case DocumentGetStatus.Rejected:
				logger.log(`Document rejected: ${document.externalId}`);
				await markQuoteAs(quote?.id || "", QuoteStatus.REJECTED);
				break;
		}

		return { message: "Webhook processed successfully" };
	}

	async generatePdfPreview(
		quoteId: string,
	): Promise<Uint8Array<ArrayBufferLike>> {
		const client = await DocumensoProvider.getClient();

		const document = (await client.documents.find({})).data.find(
			(doc) => doc.externalId === quoteId,
		);

		if (!document || !document.id) {
			logger.error("Document not found for quote ID:", quoteId);
			throw new NotFoundException("Document not found for the given quote ID");
		}

		logger.log(`Generating PDF preview for document ID: ${document.id}`);
		let pdf: DocumentDownloadResponse;

		try {
			pdf = await client.document.documentDownload({
				documentId: document.id,
			});
		} catch (error) {
			logger.error(`Error fetching document download info:`, error);
			throw error;
		}

		const pdfResponse = await fetch(pdf.downloadUrl);
		if (!pdfResponse.ok) {
			throw new Error(`Failed to download PDF: ${pdfResponse.statusText}`);
		}

		const arrayBuffer = await pdfResponse.arrayBuffer();
		const uint8Array = new Uint8Array(arrayBuffer);

		return uint8Array;
	}

	async validatePlugin(config: any): Promise<boolean> {
		console.log("Validating Documenso plugin with config:", config);
		// Add actual validation logic here (e.g., test connection to Documenso)
		return true;
	}
}

export const documensoProvider = new DocumensoProvider();
