import { useTranslation } from 'react-i18next';
import { DocumentView } from '../../DocumentView';
import type { Invoice } from '@/types';

export interface InvoiceViewProps {
  invoice: Invoice | null;
  onOpenChange: (open: boolean) => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onMarkAsPaid?: () => void;
  onDownload?: (format: string, fileFormat: 'pdf' | 'xml') => void;
}

export function InvoiceView({ invoice, onOpenChange, onEdit, onDelete, onMarkAsPaid, onDownload }: InvoiceViewProps) {
  const { t } = useTranslation();

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'SENT':
        return 'bg-yellow-100 text-yellow-800';
      case 'UNPAID':
        return 'bg-blue-100 text-blue-800';
      case 'OVERDUE':
        return 'bg-red-100 text-red-800';
      case 'PAID':
        return 'bg-green-100 text-green-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusLabel = (status: string) => {
    return t(`invoices.list.status.${status.toLowerCase()}`);
  };

  return (
    <DocumentView
      document={invoice}
      onOpenChange={onOpenChange}
      documentType="invoice"
      getStatusColor={getStatusColor}
      getStatusLabel={getStatusLabel}
      onEdit={onEdit}
      onDelete={onDelete}
      onMarkAsPaid={onMarkAsPaid}
      onDownload={onDownload}
    />
  );
}
