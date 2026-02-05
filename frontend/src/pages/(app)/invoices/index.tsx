import { Plus, ReceiptText, Search } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useSsePaginated } from '@/hooks/use-fetch';
import { InvoiceList } from '@/components/documents/invoice/InvoiceList';
import { InvoiceForm } from '@/components/documents/invoice/InvoiceForm';
import { InvoiceView } from '@/components/documents/invoice/InvoiceView';
import { InvoicePDF } from '@/components/documents/invoice/InvoicePDF';
import type { Invoice } from '@/types';

interface InvoiceStats {
  total: number;
  sent: number;
  paid: number;
  overdue: number;
}

interface InvoicesResponse {
  pageCount: number;
  invoices: Invoice[];
  stats: InvoiceStats;
}

export default function Invoices() {
  const { t } = useTranslation();

  const [page, setPage] = useState(1);
  const pageCountRef = useRef(1);
  const { data: invoicesData, loading } = useSsePaginated<InvoicesResponse>(
    '/api/invoices/sse',
    page,
    pageCountRef.current,
  );

  if (invoicesData?.pageCount && invoicesData.pageCount !== pageCountRef.current) {
    pageCountRef.current = invoicesData.pageCount;
  }

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [viewInvoice, setViewInvoice] = useState<Invoice | null>(null);
  const [viewPdfInvoice, setViewPdfInvoice] = useState<Invoice | null>(null);

  const filteredInvoices =
    invoicesData?.invoices.filter(
      (invoice) =>
        invoice.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        invoice.status.toLowerCase().includes(searchTerm.toLowerCase()),
    ) || [];

  const stats = invoicesData?.stats || { total: 0, sent: 0, paid: 0, overdue: 0 };

  const invoiceEmptyState = (
    <div className="text-center py-12">
      <ReceiptText className="mx-auto h-12 w-12 text-gray-400" />
      <h3 className="mt-2 text-sm font-medium text-foreground">
        {searchTerm ? t('invoices.emptyState.noResults') : t('invoices.emptyState.noInvoices')}
      </h3>
      <p className="mt-1 text-sm text-primary">
        {searchTerm
          ? t('invoices.emptyState.tryDifferentSearch')
          : t('invoices.emptyState.startAdding')}
      </p>
      {!searchTerm && (
        <div className="mt-6">
          <Button onClick={() => setSelectedInvoice({} as Invoice)}>
            <Plus className="h-4 w-4 mr-2" />
            {t('invoices.actions.addNew')}
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto space-y-6 p-6">
      <div className="flex flex-col lg:flex-row items-start lg:items-center gap-4 lg:gap-0 lg:justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-blue-100 rounded-lg">
            <ReceiptText className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <div className="text-sm text-primary">{t('invoices.header.subtitle')}</div>
            <div className="font-medium text-foreground">
              {t('invoices.header.count', {
                count: filteredInvoices.length,
                found: searchTerm ? t('invoices.header.found') : '',
              })}
            </div>
          </div>
        </div>

        <div className="flex flex-row items-center gap-4 w-full lg:w-fit lg:gap-6 lg:justify-between">
          <div className="relative w-full lg:w-fit">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder={t('invoices.search.placeholder')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 w-full"
            />
          </div>
          <Button onClick={() => setSelectedInvoice({} as Invoice)}>
            <Plus className="h-4 w-4 mr-0 md:mr-2" />
            <span className="hidden md:inline-flex">{t('invoices.actions.addNew')}</span>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardContent>
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-blue-100 rounded-lg">
                <ReceiptText className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-semibold text-foreground">{stats.total}</p>
                <p className="text-sm text-primary">{t('invoices.stats.total')}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-yellow-100 rounded-lg">
                <div className="w-6 h-6 flex items-center justify-center">
                  <div className="w-3 h-3 bg-yellow-500 rounded-full" />
                </div>
              </div>
              <div>
                <p className="text-2xl font-semibold text-foreground">{stats.sent}</p>
                <p className="text-sm text-primary">{t('invoices.stats.sent')}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-green-100 rounded-lg">
                <div className="w-6 h-6 flex items-center justify-center">
                  <div className="w-3 h-3 bg-green-500 rounded-full" />
                </div>
              </div>
              <div>
                <p className="text-2xl font-semibold text-foreground">{stats.paid}</p>
                <p className="text-sm text-primary">{t('invoices.stats.paid')}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <InvoiceList
        documents={filteredInvoices}
        loading={loading}
        title={t('invoices.list.title')}
        description={t('invoices.list.description')}
        page={page}
        pageCount={invoicesData?.pageCount || 1}
        setPage={setPage}
        emptyState={invoiceEmptyState}
        showCreateButton={false}
      />

      <InvoiceForm
        open={!!selectedInvoice}
        onOpenChange={(open) => {
          if (!open) setSelectedInvoice(null);
        }}
        invoice={selectedInvoice}
        onSuccess={() => window.location.reload()}
      />

      <InvoiceView
        invoice={viewInvoice}
        onOpenChange={(open) => {
          if (!open) setViewInvoice(null);
        }}
        onEdit={() => {
          setViewInvoice(null);
          setSelectedInvoice(viewInvoice);
        }}
        onDelete={() => window.location.reload()}
        onMarkAsPaid={() => window.location.reload()}
        onDownload={(format, fileFormat) => {
          const url = `${import.meta.env.VITE_BACKEND_URL || ''}/api/invoices/${viewInvoice?.id}/download/${fileFormat}?format=${format}`;
          const link = document.createElement('a');
          link.href = url;
          link.download = `invoice-${viewInvoice?.number}-${format}.${fileFormat}`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }}
      />

      <InvoicePDF
        invoice={viewPdfInvoice}
        onOpenChange={(open) => {
          if (!open) setViewPdfInvoice(null);
        }}
      />
    </div>
  );
}
