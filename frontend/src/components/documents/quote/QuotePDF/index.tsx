import { useTranslation } from 'react-i18next';
import { DocumentPDF } from '../../DocumentPDF';
import type { Quote } from '@/types';
import { useGet } from '@/hooks/use-fetch';

export interface QuotePDFProps {
  quote: Quote | null;
  onOpenChange: (open: boolean) => void;
}

interface PluginPdfFormat {
  format_name: string;
  format_key: string;
}

export function QuotePDF({ quote, onOpenChange }: QuotePDFProps) {
  const { t } = useTranslation();
  const { data: pdf_formats } = useGet<PluginPdfFormat[]>('/api/plugins/formats');

  if (!quote) return null;

  const handleDownload = (format: string, fileFormat: 'pdf' | 'xml') => {
    const url = `${import.meta.env.VITE_BACKEND_URL || ''}/api/quotes/${quote.id}/download/${fileFormat}?format=${format}`;
    const link = document.createElement('a');
    link.href = url;
    link.download = `quote-${quote.number}-${format}.${fileFormat}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    onOpenChange(false);
  };

  return (
    <DocumentPDF
      documentNumber={quote.rawNumber || quote.number.toString()}
      documentType="quote"
      pdfFormats={pdf_formats || []}
      onDownload={handleDownload}
      onClose={() => onOpenChange(false)}
    />
  );
}
