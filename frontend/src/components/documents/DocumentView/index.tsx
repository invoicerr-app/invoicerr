import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import type { BaseDocument, DocumentType } from '../types';

export interface DocumentViewProps<T extends BaseDocument> {
  document: T | null;
  onOpenChange: (open: boolean) => void;
  documentType: DocumentType;
  getStatusColor: (status: string) => string;
  getStatusLabel: (status: string) => string;
  onEdit?: () => void;
  onDownload?: (format: string, fileFormat: 'pdf' | 'xml') => void;
  onMarkAsPaid?: () => void;
  onDelete?: () => void;
}

export function DocumentView<T extends BaseDocument>({
  document,
  onOpenChange,
  documentType,
  getStatusColor,
  getStatusLabel,
  onEdit,
  onDownload,
  onMarkAsPaid,
  onDelete,
}: DocumentViewProps<T>) {
  if (!document) return null;

  const status = (document as any).status || 'SENT';

  return (
    <Dialog open={!!document} onOpenChange={onOpenChange}>
      <DialogContent className="w-full sm:max-w-2xl overflow-y-auto max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>
            {documentType === 'invoice' && `Invoice ${document.rawNumber || document.number}`}
            {documentType === 'quote' && `Quote ${document.rawNumber || document.number}`}
            {documentType === 'receipt' && `Receipt ${document.rawNumber || document.number}`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 mt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Status</p>
              <Badge className={`bg-opacity-100 ${getStatusColor(status)}`}>
                {getStatusLabel(status)}
              </Badge>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Created</p>
              <p className="font-medium">{new Date(document.createdAt).toLocaleDateString()}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Total (excl. VAT)</p>
              <p className="text-2xl font-bold">{document.currency} {document.totalHT.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">VAT Amount</p>
              <p className="text-2xl font-bold">{document.currency} {document.totalVAT.toFixed(2)}</p>
            </div>
          </div>

          <div>
            <p className="text-sm text-muted-foreground">Total (incl. VAT)</p>
            <p className="text-3xl font-bold text-primary">
              {document.currency} {document.totalTTC.toFixed(2)}
            </p>
          </div>

          {document.notes && (
            <div>
              <p className="text-sm text-muted-foreground mb-2">Notes</p>
              <p className="text-sm bg-muted p-3 rounded-lg">{document.notes}</p>
            </div>
          )}

          <div className="flex gap-2 flex-wrap">
            {onDownload && (
              <Button variant="outline" onClick={() => onDownload('', 'pdf')}>
                Download PDF
              </Button>
            )}
            {onEdit && status !== 'PAID' && (
              <Button onClick={onEdit}>Edit</Button>
            )}
            {onMarkAsPaid && status !== 'PAID' && documentType !== 'receipt' && (
              <Button onClick={onMarkAsPaid} variant="secondary">
                Mark as Paid
              </Button>
            )}
            {onDelete && status !== 'PAID' && status !== 'OVERDUE' && (
              <Button onClick={onDelete} variant="destructive">
                Delete
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
