import { Request } from 'express';

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

/**
 * Plugin FORM types — generic, despite where they used to live.
 *
 * They used to live alongside the quote-signature interface, in the removed module that carried
 * it. Signing left along with the documents; these three describe the configuration form for
 * ANY plugin and have nothing to do with a legal document.
 */
export interface IPluginForm {
  form: IPluginFormConfig;
}

export interface IPluginFormConfig {
  fields: IPluginFormField[];
}

export interface IPluginFormField {
  type: 'text' | 'number' | 'switch' | 'select';
  name: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  default?: boolean;
  multiple?: boolean;
  pattern?: string;
  options?: { label: string; value: string }[];
}
