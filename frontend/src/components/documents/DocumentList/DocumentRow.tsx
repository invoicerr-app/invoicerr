import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { DocumentType, BaseDocument } from '../types';

interface DocumentRowProps<T extends BaseDocument> {
  document: T;
  documentType: DocumentType;
  onEdit?: (document: T) => void;
  onView?: (document: T) => void;
  onViewPdf?: (document: T) => void;
  onDownload?: (document: T) => void;
  onDelete?: (document: T) => void;
  onMarkAsPaid?: (id: string) => void;
  onCreateReceipt?: (id: string) => void;
  onConvertToInvoice?: (id: string) => void;
  getStatusColor: (status: string) => string;
  getStatusLabel: (status: string) => string;
}

export function DocumentRow<T extends BaseDocument>({
  document,
  documentType,
  onEdit,
  onView,
  onViewPdf,
  onDownload,
  onDelete,
  onMarkAsPaid,
  onCreateReceipt,
  onConvertToInvoice,
  getStatusColor,
  getStatusLabel,
}: DocumentRowProps<T>) {
  return (
    <div className="p-4 sm:p-6" data-cy={`${documentType}-row`}>
      <div className="flex flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex flex-row items-center gap-4 w-full">
          <div className="p-2 bg-blue-100 rounded-lg mb-4 md:mb-0 w-fit h-fit">
            {documentType === 'invoice' && (
              <svg className="h-5 w-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <title>Invoice</title>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            )}
            {documentType === 'quote' && (
              <svg className="h-5 w-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <title>Quote</title>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            )}
            {documentType === 'receipt' && (
              <svg className="h-5 w-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <title>Receipt</title>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            )}
          </div>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium text-foreground break-words">
                {documentType === 'invoice' && `Invoice ${document.rawNumber || document.number}`}
                {documentType === 'quote' && `Quote ${document.rawNumber || document.number}`}
                {documentType === 'receipt' && `Receipt ${document.rawNumber || document.number}`}
              </h3>
              <Badge
                className={`bg-opacity-100 ${getStatusColor(
                  documentType === 'receipt' ? (document as any).status || 'PAID' : (document as any).status
                )}`}
              >
                {getStatusLabel(
                  documentType === 'receipt' ? (document as any).status || 'PAID' : (document as any).status
                )}
              </Badge>
            </div>
            <div className="mt-2 flex flex-col gap-2 text-sm text-muted-foreground">
              <div className="hidden sm:grid sm:grid-cols-2 lg:grid-cols-3 gap-1">
                <span>
                  <span className="font-medium text-foreground">Issued:</span>{' '}
                  {new Date(document.createdAt).toLocaleDateString()}
                </span>
                <span>
                  <span className="font-medium text-foreground">Total (excl. VAT):</span>{' '}
                  {document.currency} {document.totalHT.toFixed(2)}
                </span>
                <span>
                  <span className="font-medium text-foreground">Total (incl. VAT):</span>{' '}
                  {document.currency} {document.totalTTC.toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:flex justify-start sm:justify-end gap-1 md:gap-2">
          {onView && (
            <Button
              tooltip="View details"
              variant="ghost"
              size="icon"
              onClick={() => onView(document)}
              className="text-gray-600 hover:text-blue-600"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <title>View</title>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </Button>
          )}

          {onViewPdf && (
            <Button
              tooltip="View PDF"
              variant="ghost"
              size="icon"
              onClick={() => onViewPdf(document)}
              className="text-gray-600 hover:text-blue-600"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <title>View PDF</title>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </Button>
          )}

          {onDownload && (
            <Button
              tooltip="Download"
              variant="ghost"
              size="icon"
              onClick={() => onDownload(document)}
              className="text-gray-600 hover:text-blue-600"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <title>Download</title>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </Button>
          )}

          {onEdit && (document as any).status !== 'PAID' && (
            <Button
              data-cy={`${documentType}-edit-button`}
              tooltip="Edit"
              variant="ghost"
              size="icon"
              onClick={() => onEdit(document)}
              className="text-gray-600 hover:text-blue-600"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <title>Edit</title>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </Button>
          )}

          {onMarkAsPaid && documentType !== 'receipt' && (document as any).status !== 'PAID' && (
            <Button
              tooltip="Mark as paid"
              variant="ghost"
              size="icon"
              onClick={() => onMarkAsPaid(document.id)}
              className="text-gray-600 hover:text-blue-600"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <title>Mark as paid</title>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </Button>
          )}

          {onCreateReceipt && documentType === 'invoice' && (
            <Button
              tooltip="Create receipt"
              variant="ghost"
              size="icon"
              onClick={() => onCreateReceipt(document.id)}
              className="text-gray-600 hover:text-green-600"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <title>Create receipt</title>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </Button>
          )}

          {onConvertToInvoice && documentType === 'quote' && (document as any).status !== 'SIGNED' && (document as any).status !== 'EXPIRED' && (
            <Button
              tooltip="Convert to invoice"
              variant="ghost"
              size="icon"
              onClick={() => onConvertToInvoice(document.id)}
              className="text-gray-600 hover:text-green-600"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <title>Convert to invoice</title>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
            </Button>
          )}

          {onDelete && (document as any).status !== 'PAID' && (document as any).status !== 'OVERDUE' && (
            <Button
              tooltip="Delete"
              variant="ghost"
              size="icon"
              onClick={() => onDelete(document)}
              className="text-gray-600 hover:text-red-600"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <title>Delete</title>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
