import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface DocumentPDFProps {
  documentNumber: string;
  documentType: 'invoice' | 'quote' | 'receipt';
  pdfFormats?: { format_key: string; format_name: string }[];
  onDownload: (format: string, fileFormat: 'pdf' | 'xml') => void;
  onClose: () => void;
}

export function DocumentPDF({
  documentNumber,
  documentType,
  pdfFormats = [],
  onDownload,
  onClose,
}: DocumentPDFProps) {
  const title = `${documentType.charAt(0).toUpperCase() + documentType.slice(1)} ${documentNumber}`;

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title} - Download</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="text-sm text-muted-foreground mb-3">Select download format:</p>
            <div className="grid grid-cols-1 gap-3">
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => onDownload('', 'pdf')}
              >
                Standard PDF
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => onDownload('facturx', 'pdf')}
              >
                Factur-X PDF
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => onDownload('zugferd', 'pdf')}
              >
                ZUGFeRD PDF
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => onDownload('xrechnung', 'pdf')}
              >
                XRechnung PDF
              </Button>
            </div>
          </div>

          {pdfFormats.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between">
                  More Formats
                  <span className="text-sm text-muted-foreground">
                    {pdfFormats.length} available
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="w-56">
                <DropdownMenuLabel>XML Formats</DropdownMenuLabel>
                {pdfFormats.map((format) => (
                  <DropdownMenuItem
                    key={format.format_key}
                    onClick={() => onDownload(format.format_key, 'xml')}
                  >
                    {format.format_name} XML
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onDownload('ubl', 'xml')}>
                  UBL XML
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onDownload('cii', 'xml')}>
                  CII XML
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <div className="flex justify-end">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
