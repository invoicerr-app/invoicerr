import {
  Edit,
  FileEdit,
  FileMinus,
  RefreshCw,
  XCircle,
  AlertTriangle,
  CheckCircle,
  Info,
} from 'lucide-react';
import type React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useGet } from '@/hooks/use-fetch';
import type { Invoice } from '@/types';

interface ModificationOption {
  id: string;
  labelKey: string;
  descriptionKey: string;
  icon: string;
  available: boolean;
  reason?: string;
  route?: string;
}

interface ModificationOptionsResponse {
  invoiceId: string;
  invoiceNumber: string;
  invoiceStatus: string;
  countryCode: string;
  correctionConfig: {
    allowDirectModification: boolean;
    method: string;
    requiresOriginalReference: boolean;
    codes: Array<{ code: string; labelKey: string }>;
    requiresPreApproval: boolean;
  } | null;
  options: ModificationOption[];
  recommendedOption: string;
}

interface InvoiceModificationDialogProps {
  invoice: Invoice | null;
  onOpenChange: (open: boolean) => void;
  onDirectEdit: (invoice: Invoice) => void;
}

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  edit: Edit,
  'file-minus': FileMinus,
  'file-edit': FileEdit,
  'refresh-cw': RefreshCw,
  'x-circle': XCircle,
};

// Check if we're in development/non-production environment
const isDev = import.meta.env.DEV || import.meta.env.MODE !== 'production';

export function InvoiceModificationDialog({
  invoice,
  onOpenChange,
  onDirectEdit,
}: InvoiceModificationDialogProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const { data: modificationOptions, loading } = useGet<ModificationOptionsResponse>(
    invoice ? `/api/invoices/${invoice.id}/modification-options` : null,
  );

  const handleOptionClick = (option: ModificationOption) => {
    if (!option.available && !isDev) return;

    if (option.id === 'direct_edit') {
      onOpenChange(false);
      if (invoice) {
        onDirectEdit(invoice);
      }
    } else if (option.route) {
      onOpenChange(false);
      navigate(option.route);
    } else if (option.id === 'cancel') {
      // TODO: Implement cancel confirmation dialog
      console.log('Cancel invoice:', invoice?.id);
    }
  };

  const getIcon = (iconName: string) => {
    const IconComponent = iconMap[iconName] || Edit;
    return IconComponent;
  };

  const renderOption = (option: ModificationOption) => {
    const IconComponent = getIcon(option.icon);
    const isRecommended = modificationOptions?.recommendedOption === option.id;
    const isAvailable = option.available;
    const showInDev = isDev && !isAvailable;

    // Don't show unavailable options in production
    if (!isAvailable && !isDev) return null;

    return (
      <button
        key={option.id}
        onClick={() => handleOptionClick(option)}
        disabled={!isAvailable && !isDev}
        className={`
          relative w-full p-4 rounded-lg border text-left transition-all
          ${isAvailable
            ? 'border-border hover:border-primary hover:bg-accent cursor-pointer'
            : 'border-dashed border-muted-foreground/30 bg-muted/30 cursor-not-allowed opacity-60'
          }
          ${isRecommended && isAvailable ? 'ring-2 ring-primary ring-offset-2' : ''}
        `}
      >
        {/* Dev mode indicator */}
        {showInDev && (
          <div className="absolute top-2 right-2">
            <span className="text-xs bg-yellow-500/20 text-yellow-600 px-2 py-0.5 rounded-full">
              DEV
            </span>
          </div>
        )}

        {/* Recommended badge */}
        {isRecommended && isAvailable && (
          <div className="absolute top-2 right-2">
            <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full flex items-center gap-1">
              <CheckCircle className="h-3 w-3" />
              {t('invoices.modification.recommended')}
            </span>
          </div>
        )}

        <div className="flex items-start gap-3">
          <div className={`
            p-2 rounded-lg
            ${isAvailable ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}
          `}>
            <IconComponent className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className={`font-medium ${!isAvailable ? 'text-muted-foreground' : ''}`}>
              {t(option.labelKey, { defaultValue: option.id })}
            </h4>
            <p className="text-sm text-muted-foreground mt-1">
              {t(option.descriptionKey, { defaultValue: '' })}
            </p>
            {!isAvailable && option.reason && (
              <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                {t(option.reason, { defaultValue: 'Not available' })}
              </p>
            )}
          </div>
        </div>
      </button>
    );
  };

  return (
    <Dialog open={invoice != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('invoices.modification.title')}</DialogTitle>
          <DialogDescription>
            {t('invoices.modification.description', {
              invoiceNumber: modificationOptions?.invoiceNumber || invoice?.rawNumber || invoice?.number,
            })}
          </DialogDescription>
        </DialogHeader>

        {/* Country info banner */}
        {modificationOptions?.correctionConfig && (
          <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 flex items-start gap-2">
            <Info className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-blue-800 dark:text-blue-200">
              <span className="font-medium">{modificationOptions.countryCode}:</span>{' '}
              {modificationOptions.correctionConfig.allowDirectModification
                ? t('invoices.modification.countryAllowsEdit')
                : t('invoices.modification.countryRequiresCorrection', {
                    method: t(`invoices.modification.methods.${modificationOptions.correctionConfig.method}`),
                  })
              }
            </div>
          </div>
        )}

        {/* Options list */}
        <div className="space-y-3 mt-4">
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">
              {t('common.loading')}
            </div>
          ) : (
            modificationOptions?.options.map(renderOption)
          )}
        </div>

        {/* Dev mode notice */}
        {isDev && (
          <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 rounded-lg">
            <p className="text-xs text-yellow-700 dark:text-yellow-300 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              {t('invoices.modification.devModeNotice', {
                defaultValue: 'Development mode: All options are visible. Grayed options would be hidden in production.',
              })}
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
