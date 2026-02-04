import { useTranslation } from 'react-i18next';
import { DocumentView } from '../../DocumentView';
import type { Receipt } from '@/types';

export interface ReceiptViewProps {
  receipt: Receipt | null;
  onOpenChange: (open: boolean) => void;
  onDelete?: () => void;
  onDownload?: (format: string, fileFormat: 'pdf' | 'xml') => void;
}

export function ReceiptView({ receipt, onOpenChange, onDelete, onDownload }: ReceiptViewProps) {
  const { t } = useTranslation();

  const getStatusColor = () => 'bg-green-100 text-green-800';
  const getStatusLabel = () => t('receipts.list.status.paid');

  return (
    <DocumentView
      document={receipt}
      onOpenChange={onOpenChange}
      documentType="receipt"
      getStatusColor={getStatusColor}
      getStatusLabel={getStatusLabel}
      onDelete={onDelete}
      onDownload={onDownload}
    />
  );
}
