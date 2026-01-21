export interface TransmissionResult {
  success: boolean;
  externalId?: string;
  message?: string;
  errorCode?: string;
}

export interface TransmissionPayload {
  invoiceId: string;
  invoiceNumber: string;
  pdfBuffer: Buffer;
  xmlContent?: string;
  recipient: {
    email: string;
    name: string;
    siret?: string;
    vatNumber?: string;
  };
  sender: {
    email: string;
    name: string;
    siret?: string;
    vatNumber?: string;
  };
  metadata: Record<string, unknown>;
}

export interface TransmissionStrategy {
  readonly name: string;

  send(payload: TransmissionPayload): Promise<TransmissionResult>;

  supports(platform: string): boolean;
}
