import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { BaseDocument, DocumentType } from '../types';
import { DocumentRow } from './DocumentRow';
import BetterPagination from '@/components/pagination';

export interface DocumentListProps<T extends BaseDocument> {
  documents: T[];
  loading: boolean;
  title: string;
  description: string;
  page?: number;
  pageCount?: number;
  setPage?: (page: number) => void;
  emptyState: React.ReactNode;
  showCreateButton?: boolean;
  documentType: DocumentType;
  onCreate?: () => void;
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

export function DocumentList<T extends BaseDocument>({
  documents,
  loading,
  title,
  description,
  page,
  pageCount,
  setPage,
  emptyState,
  showCreateButton = false,
  documentType,
  onCreate,
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
}: DocumentListProps<T>) {
  return (
    <Card className="gap-0">
      <CardHeader className="border-b flex flex-row items-center justify-between">
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        {showCreateButton && onCreate && (
          <Button onClick={onCreate}>Add New</Button>
        )}
      </CardHeader>

      <CardContent className="p-0">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500" />
          </div>
        ) : documents.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            {emptyState}
          </div>
        ) : (
          <div className="divide-y">
            {documents.map((document) => (
              <DocumentRow
                key={document.id}
                document={document}
                documentType={documentType}
                onEdit={onEdit}
                onView={onView}
                onViewPdf={onViewPdf}
                onDownload={onDownload}
                onDelete={onDelete}
                onMarkAsPaid={onMarkAsPaid}
                onCreateReceipt={onCreateReceipt}
                onConvertToInvoice={onConvertToInvoice}
                getStatusColor={getStatusColor}
                getStatusLabel={getStatusLabel}
              />
            ))}
          </div>
        )}
      </CardContent>

      {page && pageCount && setPage && (
        <CardFooter>
          {!loading && documents.length > 0 && (
            <BetterPagination pageCount={pageCount} page={page} setPage={setPage} />
          )}
        </CardFooter>
      )}
    </Card>
  );
}
