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
 * Types de FORMULAIRE de plugin — génériques, malgré leur adresse d'origine.
 *
 * Ils vivaient dans `signing/types.ts`, aux côtés de l'interface de signature de devis. La
 * signature est partie avec les documents ; ces trois-là décrivent le formulaire de configuration
 * de N'IMPORTE quel plugin et n'ont rien à voir avec un document légal.
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
