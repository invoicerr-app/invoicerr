import { Plus, ReceiptText, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useGetRaw, useSse } from '@/hooks/use-fetch';
import {
  InvoiceList,
  type InvoiceListHandle,
} from '@/pages/(app)/invoices/_components/invoice-list';
import type { Invoice, RecurringInvoice } from '@/types';
import {
  RecurringInvoiceList,
  type RecurringInvoiceListHandle,
} from './_components/recurring-invoices/recurring-invoices-list';

export default function Invoices() {
  const { t } = useTranslation();
  const invoiceListRef = useRef<InvoiceListHandle>(null);
  const recurringInvoiceListRef = useRef<RecurringInvoiceListHandle>(null);

  const [page, setPage] = useState(1);
  const { data: invoices } = useSse<{ pageCount: number; invoices: Invoice[] }>(
    `/api/invoices/sse?page=${page}`,
  );
  const { data: recurringInvoices } = useSse<{ pageCount: number; data: RecurringInvoice[] }>(
    '/api/recurring-invoices/sse',
  );
  const [downloadInvoicePdf, setDownloadInvoicePdf] = useState<Invoice | null>(null);
  const { data: pdf } = useGetRaw<Response>(`/api/invoices/${downloadInvoicePdf?.id}/pdf`);

  useEffect(() => {
    if (downloadInvoicePdf && pdf) {
      pdf.arrayBuffer().then((buffer) => {
        const blob = new Blob([buffer], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `invoice-${downloadInvoicePdf.number}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        setDownloadInvoicePdf(null); // Reset after download
      });
    }
  }, [downloadInvoicePdf, pdf]);

  const [searchTerm, setSearchTerm] = useState('');

  const filteredInvoices =
    invoices?.invoices.filter(
      (invoice) =>
        invoice.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        invoice.status.toLowerCase().includes(searchTerm.toLowerCase()),
    ) || [];

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
          <Button onClick={() => invoiceListRef.current?.handleAddClick()}>
            <Plus className="h-4 w-4 mr-2" />
            {t('invoices.actions.addNew')}
          </Button>
        </div>
      )}
    </div>
  );
  const recurringInvoiceEmptyState = (
    <div className="text-center py-12">
      <ReceiptText className="mx-auto h-12 w-12 text-gray-400" />
      <h3 className="mt-2 text-sm font-medium text-foreground">
        {t('recurringInvoices.emptyState.noInvoices')}
      </h3>
      <p className="mt-1 text-sm text-primary">{t('recurringInvoices.emptyState.startAdding')}</p>
      <div className="mt-6">
        <Button onClick={() => recurringInvoiceListRef.current?.handleAddClick()}>
          <Plus className="h-4 w-4 mr-2" />
          {t('recurringInvoices.actions.addNew')}
        </Button>
      </div>
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
          <Button onClick={() => invoiceListRef.current?.handleAddClick()}>
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
                <p className="text-2xl font-semibold text-foreground">
                  {invoices?.invoices.length || 0}
                </p>
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
                  <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                </div>
              </div>
              <div>
                <p className="text-2xl font-semibold text-foreground">
                  {invoices?.invoices.filter((c) => c.status === 'SENT').length || 0}
                </p>
                <p className="text-sm text-primary">{t('invoices.stats.sent')}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-blue-100 rounded-lg">
                <div className="w-6 h-6 flex items-center justify-center">
                  <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                </div>
              </div>
              <div>
                <p className="text-2xl font-semibold text-foreground">
                  {invoices?.invoices.filter((c) => c.status === 'PAID').length || 0}
                </p>
                <p className="text-sm text-primary">{t('invoices.stats.paid')}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <RecurringInvoiceList
        ref={recurringInvoiceListRef}
        recurringInvoices={recurringInvoices?.data || []}
        loading={false}
        title={t('recurringInvoices.list.title')}
        description={t('recurringInvoices.list.description')}
        page={1}
        pageCount={1}
        setPage={() => {}}
        mutate={() => {}}
        emptyState={recurringInvoiceEmptyState}
        showCreateButton={true}
      />

      <InvoiceList
        ref={invoiceListRef}
        invoices={filteredInvoices}
        loading={false}
        title={t('invoices.list.title')}
        description={t('invoices.list.description')}
        page={page}
        pageCount={invoices?.pageCount || 1}
        setPage={setPage}
        emptyState={invoiceEmptyState}
        showCreateButton={true}
      />
    </div>
  );
}
