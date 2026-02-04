import { FileText, Plus, Search } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useSsePaginated } from '@/hooks/use-fetch';
import { QuoteList } from '@/components/documents/quote/QuoteList';
import { QuoteForm } from '@/components/documents/quote/QuoteForm';
import { QuoteView } from '@/components/documents/quote/QuoteView';
import { QuotePDF } from '@/components/documents/quote/QuotePDF';
import type { Quote } from '@/types';

interface QuoteStats {
  total: number;
  sent: number;
  signed: number;
}

interface QuotesResponse {
  pageCount: number;
  quotes: Quote[];
  stats: QuoteStats;
}

export default function Quotes() {
  const { t } = useTranslation();

  const [page, setPage] = useState(1);
  const pageCountRef = useRef(1);
  const { data: quotesData, loading } = useSsePaginated<QuotesResponse>(
    '/api/quotes/sse',
    page,
    pageCountRef.current,
  );

  if (quotesData?.pageCount && quotesData.pageCount !== pageCountRef.current) {
    pageCountRef.current = quotesData.pageCount;
  }

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
  const [viewQuote, setViewQuote] = useState<Quote | null>(null);
  const [viewPdfQuote, setViewPdfQuote] = useState<Quote | null>(null);

  const filteredQuotes =
    quotesData?.quotes.filter(
      (quote) =>
        quote.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        quote.status.toLowerCase().includes(searchTerm.toLowerCase()),
    ) || [];

  const stats = quotesData?.stats || { total: 0, sent: 0, signed: 0 };

  const quoteEmptyState = (
    <div className="text-center py-12">
      <FileText className="mx-auto h-12 w-12 text-gray-400" />
      <h3 className="mt-2 text-sm font-medium text-foreground">
        {searchTerm ? t('quotes.emptyState.noResults') : t('quotes.emptyState.noQuotes')}
      </h3>
      <p className="mt-1 text-sm text-primary">
        {searchTerm
          ? t('quotes.emptyState.tryDifferentSearch')
          : t('quotes.emptyState.startAdding')}
      </p>
      {!searchTerm && (
        <div className="mt-6">
          <Button onClick={() => setSelectedQuote({} as Quote)}>
            <Plus className="h-4 w-4 mr-2" />
            {t('quotes.actions.addNew')}
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
            <FileText className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <div className="text-sm text-primary">{t('quotes.header.subtitle')}</div>
            <div className="font-medium text-foreground">
              {t('quotes.header.count', {
                count: filteredQuotes.length,
                found: searchTerm ? t('quotes.header.found') : '',
              })}
            </div>
          </div>
        </div>

        <div className="flex flex-row items-center gap-4 w-full lg:w-fit lg:gap-6 lg:justify-between">
          <div className="relative w-full lg:w-fit">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder={t('quotes.search.placeholder')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 w-full"
            />
          </div>
          <Button onClick={() => setSelectedQuote({} as Quote)}>
            <Plus className="h-4 w-4 mr-0 md:mr-2" />
            <span className="hidden md:inline-flex">{t('quotes.actions.addNew')}</span>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardContent>
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-blue-100 rounded-lg">
                <FileText className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-semibold text-foreground">{stats.total}</p>
                <p className="text-sm text-primary">{t('quotes.stats.total')}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-blue-100 rounded-lg">
                <div className="w-6 h-6 flex items-center justify-center">
                  <div className="w-3 h-3 bg-blue-500 rounded-full" />
                </div>
              </div>
              <div>
                <p className="text-2xl font-semibold text-foreground">{stats.sent}</p>
                <p className="text-sm text-primary">{t('quotes.stats.sent')}</p>
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
                <p className="text-2xl font-semibold text-foreground">{stats.signed}</p>
                <p className="text-sm text-primary">{t('quotes.stats.signed')}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <QuoteList
        documents={filteredQuotes}
        loading={loading}
        title={t('quotes.list.title')}
        description={t('quotes.list.description')}
        page={page}
        pageCount={quotesData?.pageCount || 1}
        setPage={setPage}
        emptyState={quoteEmptyState}
        showCreateButton={false}
      />

      <QuoteForm
        open={!!selectedQuote}
        onOpenChange={(open) => {
          if (!open) setSelectedQuote(null);
        }}
        quote={selectedQuote}
        onSuccess={() => window.location.reload()}
      />

      <QuoteView
        quote={viewQuote}
        onOpenChange={(open) => {
          if (!open) setViewQuote(null);
        }}
        onEdit={() => {
          setViewQuote(null);
          setSelectedQuote(viewQuote);
        }}
        onDelete={() => window.location.reload()}
        onDownload={(format, fileFormat) => {
          const url = `${import.meta.env.VITE_BACKEND_URL || ''}/api/quotes/${viewQuote?.id}/download/${fileFormat}?format=${format}`;
          const link = document.createElement('a');
          link.href = url;
          link.download = `quote-${viewQuote?.number}-${format}.${fileFormat}`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }}
      />

      <QuotePDF
        quote={viewPdfQuote}
        onOpenChange={(open) => {
          if (!open) setViewPdfQuote(null);
        }}
      />
    </div>
  );
}
