import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { DocumentList } from '../../DocumentList';
import type { DocumentListProps } from '../../DocumentList';
import { useGet, usePost } from '@/hooks/use-fetch';
import type { Invoice } from '@/types';

export interface InvoiceListHandle {
  handleAddClick: () => void;
}

interface PluginPdfFormat {
  format_name: string;
  format_key: string;
}

export function InvoiceList({ documents, loading, title, description, page, pageCount, setPage, mutate, emptyState, showCreateButton = false }: DocumentListProps<Invoice>) {
  const { t } = useTranslation();
  const { activeCompany } = useCompany();

  const { data: pdf_formats } = useGet<PluginPdfFormat[]>('/api/plugins/formats');
  const { trigger: triggerMarkAsPaid } = usePost(`/api/invoices/mark-as-paid`);
  const { trigger: triggerSendInvoiceByEmail } = usePost(`/api/invoices/send`);
  const { trigger: triggerCreateReceipt } = usePost(`/api/receipts/create-from-invoice`);

  const handleMarkAsPaid = (invoiceId: string) => {
    triggerMarkAsPaid({ invoiceId })
      .then(() => {
        toast.success(t('invoices.list.messages.markAsPaidSuccess'));
        mutate?.();
      })
      .catch(() => {
        toast.error(t('invoices.list.messages.markAsPaidError'));
      });
  };

  const handleCreateReceiptFromInvoice = (invoiceId: string) => {
    triggerCreateReceipt({ id: invoiceId })
      .then(() => {
        toast.success(t('invoices.list.messages.createReceiptSuccess'));
        mutate?.();
      })
      .catch(() => {
        toast.error(t('invoices.list.messages.createReceiptError'));
      });
  };

  const handleSendInvoiceByEmail = (invoiceId: string) => {
    triggerSendInvoiceByEmail({ id: invoiceId })
      .then(() => {
        toast.success(t('invoices.list.messages.sendByEmailSuccess'));
      })
      .catch(() => {
        toast.error(t('invoices.list.messages.sendByEmailError'));
      });
  };

  const handleDownload = (invoice: Invoice, format: string, fileFormat: 'pdf' | 'xml') => {
    const url = `${import.meta.env.VITE_BACKEND_URL || ''}/api/invoices/${invoice.id}/download/${fileFormat}?format=${format}`;
    const link = document.createElement('a');
    link.href = url;
    link.download = `invoice-${invoice.number}-${format}.${fileFormat}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

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
      documentType="invoice"
      onEdit={() => {}}
      onView={() => {}}
      onDelete={() => {}}
      onMarkAsPaid={handleMarkAsPaid}
      onCreateReceipt={handleCreateReceiptFromInvoice}
      getStatusColor={getStatusColor}
      getStatusLabel={getStatusLabel}
      onDownload={handleDownload}
    />
  );
}
