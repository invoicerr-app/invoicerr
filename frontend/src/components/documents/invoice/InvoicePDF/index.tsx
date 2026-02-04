import { useTranslation } from 'react-i18next';
import { DocumentPDF } from '../../DocumentPDF';
import type { Invoice } from '@/types';
import { useGet } from '@/hooks/use-fetch';

export interface InvoicePDFProps {
  invoice: Invoice | null;
  onOpenChange: (open: boolean) => void;
}

interface PluginPdfFormat {
  format_name: string;
  format_key: string;
}

export function InvoicePDF({ invoice, onOpenChange }: InvoicePDFProps) {
  const { t } = useTranslation();
  const { data: pdf_formats } = useGet<PluginPdfFormat[]>('/api/plugins/formats');

  if (!invoice) return null;

  const handleDownload = (format: string, fileFormat: 'pdf' | 'xml') => {
    const url = `${import.meta.env.VITE_BACKEND_URL || ''}/api/invoices/${invoice.id}/download/${fileFormat}?format=${format}`;
    const link = document.createElement('a');
    link.href = url;
    link.download = `invoice-${invoice.number}-${format}.${fileFormat}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    onOpenChange(false);
  };

  return (
    <DocumentPDF
      documentNumber={invoice.rawNumber || invoice.number.toString()}
      documentType="invoice"
      pdfFormats={pdf_formats || []}
      onDownload={handleDownload}
      onClose={() => onOpenChange(false)}
    />
  );
}
