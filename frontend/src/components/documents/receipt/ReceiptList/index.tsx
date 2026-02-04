import { useTranslation } from 'react-i18next';
import { DocumentList } from '../../DocumentList';
import type { Receipt } from '@/types';

export interface ReceiptListProps {
  documents: Receipt[];
  loading: boolean;
  title: string;
  description: string;
  page?: number;
  pageCount?: number;
  setPage?: (page: number) => void;
  emptyState: React.ReactNode;
  showCreateButton?: boolean;
}

export function ReceiptList({ documents, loading, title, description, page, pageCount, setPage, emptyState, showCreateButton = false }: ReceiptListProps) {
  const { t } = useTranslation();

  const getStatusColor = () => 'bg-green-100 text-green-800';
  const getStatusLabel = () => t('receipts.list.status.paid');

  return (
    <DocumentList
      documents={documents as any}
      loading={loading}
      title={title}
      description={description}
      page={page}
      pageCount={pageCount}
      setPage={setPage}
      emptyState={emptyState}
      showCreateButton={showCreateButton}
      documentType="receipt"
      getStatusColor={getStatusColor}
      getStatusLabel={getStatusLabel}
    />
  );
}
