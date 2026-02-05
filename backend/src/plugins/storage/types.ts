import { IPlugin, IValidatableProvider, IWebhookProvider } from "../types";

export interface IUploadFileProps {
    key: string;
    buffer: Uint8Array | ArrayBuffer;
    mimeType: string;
}

export interface IStorageProvider extends IPlugin, IValidatableProvider, Partial<IWebhookProvider> {
    /**
     * Upload a file to the storage backend
     */
    uploadFile: (file: IUploadFileProps) => Promise<string>;

    /**
     * Optional: generate a signed URL for private files
     */
    getSignedUrl?: (key: string, expiresIn?: number) => Promise<string>;

    /**
     * Optional: delete a file from the storage backend
     */
    deleteFile?: (key: string) => Promise<void>;

    /**
     * Optional: format the base URL for frontend access
     */
    formatUrl?: (url: string) => string;
}

export interface IStoragePluginForm {
    form: IStoragePluginFormConfig;
}

export interface IStoragePluginFormConfig {
    fields: IStoragePluginFormField[];
}

export interface IStoragePluginFormField {
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
