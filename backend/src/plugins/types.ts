import type { Request } from 'express';

export interface IPlugin {
  id: string;
  name: string;
}

/**
 * Interface for providers that can validate plugins
 */
export interface IValidatableProvider {
  /**
   * Validates the plugin and configures the necessary webhooks
   * @param config The plugin configuration
   * @return True if the plugin is valid, false otherwise
   */
  validatePlugin(config: any): Promise<boolean>;
}

/**
 * Interface for providers that support webhooks
 */
export interface IWebhookProvider {
  /**
   * Handles a received webhook
   * @param req The Express Request object
   * @param body The body of the webhook request
   */
  handleWebhook(req: Request, body: any): Promise<any>;
}

/**
 * Interface for providers that support pdf preview
 */
export interface IPdfPreviewProvider {
  /**
   * Generates a preview for a PDF document
   * @param req The Express Request object
   * @param document The PDF document to preview
   */
  generatePdfPreview(quoteId: string): Promise<Uint8Array<ArrayBufferLike>>;
}
