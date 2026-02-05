export type DocumentType = 'invoice' | 'quote' | 'receipt' | 'credit-note';

export interface BaseDocument {
  id: string;
  number: number;
  rawNumber?: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  currency: string;
  totalHT: number;
  totalVAT: number;
  totalTTC: number;
  notes?: string;
  paymentMethodId?: string;
  companyId: string;
  isActive: boolean;
}

export interface DocumentItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  type: 'HOUR' | 'DAY' | 'DEPOSIT' | 'SERVICE' | 'PRODUCT';
  order: number;
}

export interface DocumentStatusConfig {
  sent: { label: string; color: string };
  unpaid: { label: string; color: string };
  overdue: { label: string; color: string };
  paid: { label: string; color: string };
  draft?: { label: string; color: string };
  expired?: { label: string; color: string };
  viewed?: { label: string; color: string };
  signed?: { label: string; color: string };
}

export interface DocumentFilters {
  status?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface DocumentListProps<T extends BaseDocument> {
  documents: T[];
  loading: boolean;
  title: string;
  description: string;
  page?: number;
  pageCount?: number;
  setPage?: (page: number) => void;
  mutate?: () => void;
  emptyState: React.ReactNode;
  showCreateButton?: boolean;
  documentType: DocumentType;
  onCreate?: () => void;
}

export interface DocumentFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentType: DocumentType;
}

export interface DocumentViewProps<T extends BaseDocument> {
  document: T | null;
  onOpenChange: (open: boolean) => void;
}

export interface PDFFormat {
  format_key: string;
  format_name: string;
}

export interface DocumentPDFOptions {
  format: string;
  file_format: 'pdf' | 'xml';
}
