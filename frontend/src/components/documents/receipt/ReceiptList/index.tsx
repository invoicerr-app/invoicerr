import { useTranslation } from 'react-i18next';
import { DocumentList } from '../../DocumentList';
import type { DocumentListProps } from '../../DocumentList';
import type { Receipt } from '@/types';

export function ReceiptList({ documents, loading, title, description, page, pageCount, setPage, mutate, emptyState, showCreateButton = false }: DocumentListProps<Receipt>) {
  const { t } = useTranslation();

  const getStatusColor = () => 'bg-green-100 text-green-800';
  const getStatusLabel = () => t('receipts.list.status.paid');

  return (
    <DocumentList
      documents={documents}
      loading={loading}
      title={title}
      description={description}
      page={page}
      pageCount={pageCount}
      setPage={setPage}
      mutate={mutate}
      emptyState={emptyState}
      showCreateButton={showCreateButton}
      documentType="receipt"
      getStatusColor={getStatusColor}
      getStatusLabel={getStatusLabel}
    />
  );
}
