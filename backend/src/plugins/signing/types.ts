import type { Request } from 'express';
import type {
  IPdfPreviewProvider,
  IPlugin,
  IValidatableProvider,
  IWebhookProvider,
} from '../types';

export interface RequestSignatureProps {
  id: string;
  title: string;
  fileUrl: string;
  signers: string[];
}

export interface ISigningProvider
  extends IPlugin,
    IValidatableProvider,
    IWebhookProvider,
    IPdfPreviewProvider {
  formatServerUrl: (url: string) => string;
  requestSignature: (doc: RequestSignatureProps) => Promise<string>;
  handleWebhook: (req: Request, body: any) => Promise<any>;
  generatePdfPreview: (quoteId: string) => Promise<Uint8Array<ArrayBufferLike>>;
}

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
