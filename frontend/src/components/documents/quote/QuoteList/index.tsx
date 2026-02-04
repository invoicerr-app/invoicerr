import { useTranslation } from 'react-i18next';
import { DocumentList } from '../../DocumentList';
import type { DocumentListProps } from '../../DocumentList';
import { usePost } from '@/hooks/use-fetch';
import type { Quote } from '@/types';

export function QuoteList({ documents, loading, title, description, page, pageCount, setPage, mutate, emptyState, showCreateButton = false }: DocumentListProps<Quote>) {
  const { t } = useTranslation();
  const { trigger: triggerConvertToInvoice } = usePost(`/api/quotes/convert-to-invoice`);

  const handleConvertToInvoice = (quoteId: string) => {
    triggerConvertToInvoice({ id: quoteId })
      .then(() => {
        window.location.href = '/invoices';
      })
      .catch(() => {
        console.error('Failed to convert quote to invoice');
      });
  };

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
      documentType="quote"
      onConvertToInvoice={handleConvertToInvoice}
      getStatusColor={getStatusColor}
      getStatusLabel={getStatusLabel}
    />
  );
}
