import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import prisma from "@/prisma/prisma.service";
import { IStorageProvider, IUploadFileProps } from "../../types";

interface ILocalConfig {
	storagePath: string;
}

export class LocalStorageProvider implements IStorageProvider {
	id = "local";
	name = "Local Storage";
	description = "Store files in a local directory";

	async getConfig(): Promise<ILocalConfig> {
		const plugin = await prisma.plugin.findUnique({
			where: { id: this.id },
		});

		if (!plugin) {
			throw new Error("Local Storage plugin not found in database.");
		}

		const config = plugin.config as unknown as ILocalConfig;

		if (!config || !config.storagePath) {
			throw new Error(
				"Local Storage plugin is not configured. Please provide a storage path.",
			);
		}

		return config;
	}

	async uploadFile({
		key,
		buffer,
		mimeType,
	}: IUploadFileProps): Promise<string> {
		try {
			const config = await this.getConfig();
			const filePath = resolve(config.storagePath, key);
			const fileDir = dirname(filePath);

			// Create directories if they don't exist
			mkdirSync(fileDir, { recursive: true });

			// Convert buffer to Buffer if needed
			let fileBuffer: Buffer;
			if (buffer instanceof ArrayBuffer) {
				fileBuffer = Buffer.from(buffer);
			} else if (buffer instanceof Uint8Array) {
				fileBuffer = Buffer.from(buffer);
			} else {
				fileBuffer = buffer as Buffer;
			}

			// Write file to disk
			writeFileSync(filePath, fileBuffer);

			// Return a relative URL-like path that can be used by the frontend
			// The frontend would need to serve these files through a static file server
			return `/storage/${key}`;
		} catch (error) {
			throw new Error(
				`Failed to upload file: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	async getSignedUrl(key: string, _expiresIn = 3600): Promise<string> {
		// For local storage, we just return the file path
		// In a real scenario, you might want to generate a temporary token
		return `/storage/${key}`;
	}

	async deleteFile(key: string): Promise<void> {
		try {
			const config = await this.getConfig();
			const filePath = resolve(config.storagePath, key);
			unlinkSync(filePath);
		} catch (error) {
			throw new Error(
				`Failed to delete file: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	formatUrl(url: string): string {
		return url;
	}

	async validatePlugin(config: ILocalConfig): Promise<boolean> {
		if (!config.storagePath) {
			throw new Error("Storage path is required");
		}

		try {
			// Try to create the directory to verify write permissions
			mkdirSync(config.storagePath, { recursive: true });
			return true;
		} catch (error) {
			throw new Error(
				`Unable to access storage path: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}
