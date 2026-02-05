import { IStorageProvider } from '@/plugins/storage/types';
import { Logger } from '@nestjs/common';
import { PluginType } from '../../prisma/generated/prisma/client';
import { PluginsService } from '@/modules/plugins/plugins.service';

const logger = new Logger('StorageUploadService');

/**
 * Service to handle file uploads to all active storage providers
 */
export class StorageUploadService {
    private static pluginsService: PluginsService;

    private static getPluginsService(): PluginsService {
        if (!StorageUploadService.pluginsService) {
            StorageUploadService.pluginsService = new PluginsService();
        }
        return StorageUploadService.pluginsService;
    }

    /**
     * Upload a file to all active storage providers
     * @param filename The name of the file to save
     * @param buffer The file buffer/content
     * @param mimeType The MIME type of the file (e.g., 'application/pdf')
     * @returns Array of URLs where the file was uploaded
     */
    static async uploadToStorageProviders(
        filename: string,
        buffer: Uint8Array | Buffer | ArrayBuffer,
        mimeType: string = 'application/pdf'
    ): Promise<string[]> {
        try {
            const pluginsService = StorageUploadService.getPluginsService();

            // Get all active storage providers
            const storageProviders = await pluginsService.getProvidersByType<IStorageProvider>(
                PluginType.STORAGE.toLowerCase()
            );

            if (storageProviders.length === 0) {
                logger.warn('No active storage providers found. File upload skipped.');
                return [];
            }

            const uploadedUrls: string[] = [];

            // Upload to each storage provider
            for (const provider of storageProviders) {
                try {
                    logger.log(`Uploading ${filename} to provider: ${provider.name}`);

                    // Ensure buffer is in the correct format (Uint8Array)
                    let fileBuffer = buffer;
                    if (!(buffer instanceof Uint8Array)) {
                        fileBuffer = new Uint8Array(buffer);
                    }

                    // Upload file to the provider
                    const url = await provider.uploadFile({
                        key: filename,
                        buffer: fileBuffer as Uint8Array,
                        mimeType,
                    });

                    uploadedUrls.push(url);
                    logger.log(`File ${filename} successfully uploaded to ${provider.name}: ${url}`);
                } catch (error) {
                    logger.error(
                        `Failed to upload ${filename} to provider ${provider.name}`,
                        error instanceof Error ? error.message : String(error)
                    );
                    // Continue uploading to other providers even if one fails
                }
            }

            return uploadedUrls;
        } catch (error) {
            logger.error(
                'Error during storage provider upload',
                error instanceof Error ? error.message : String(error)
            );
            return [];
        }
    }

    /**
     * Upload a signed quote PDF to storage providers
     * @param quoteId The ID of the quote
     * @param buffer The PDF buffer
     * @returns Array of URLs where the file was uploaded
     */
    static async uploadSignedQuotePdf(quoteId: string, buffer: Uint8Array): Promise<string[]> {
        const filename = `signed-quotes/${quoteId}/quote-${quoteId}.pdf`;
        return StorageUploadService.uploadToStorageProviders(filename, buffer, 'application/pdf');
    }

    /**
     * Upload a paid invoice PDF to storage providers
     * @param invoiceId The ID of the invoice
     * @param buffer The PDF buffer
     * @returns Array of URLs where the file was uploaded
     */
    static async uploadPaidInvoicePdf(invoiceId: string, buffer: Uint8Array): Promise<string[]> {
        const filename = `paid-invoices/${invoiceId}/invoice-${invoiceId}.pdf`;
        return StorageUploadService.uploadToStorageProviders(filename, buffer, 'application/pdf');
    }
}
