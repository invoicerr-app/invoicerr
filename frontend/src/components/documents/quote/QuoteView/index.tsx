import { useTranslation } from 'react-i18next';
import { DocumentView } from '../../DocumentView';
import type { Quote } from '@/types';

export interface QuoteViewProps {
  quote: Quote | null;
  onOpenChange: (open: boolean) => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onConvertToInvoice?: () => void;
  onDownload?: (format: string, fileFormat: 'pdf' | 'xml') => void;
}

export function QuoteView({ quote, onOpenChange, onEdit, onDelete, onConvertToInvoice, onDownload }: QuoteViewProps) {
  const { t } = useTranslation();

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'DRAFT':
        return 'bg-gray-100 text-gray-800';
      case 'SENT':
        return 'bg-blue-100 text-blue-800';
      case 'VIEWED':
        return 'bg-purple-100 text-purple-800';
      case 'SIGNED':
        return 'bg-green-100 text-green-800';
      case 'EXPIRED':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusLabel = (status: string) => {
    return t(`quotes.list.status.${status.toLowerCase()}`);
  };

  return (
    <DocumentView
      document={quote}
      onOpenChange={onOpenChange}
      documentType="quote"
      getStatusColor={getStatusColor}
      getStatusLabel={getStatusLabel}
      onEdit={onEdit}
      onDelete={onDelete}
      onDownload={onDownload}
    />
  );
}
