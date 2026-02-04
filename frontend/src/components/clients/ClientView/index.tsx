import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTranslation } from 'react-i18next';

export interface ClientViewProps {
  client: any | null;
  onOpenChange: (open: boolean) => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

export function ClientView({ client, onOpenChange, onEdit }: ClientViewProps) {
  const { t } = useTranslation();

  if (!client) return null;

  return (
    <Dialog open={!!client} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{client.name || 'Client Details'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          <div>
            <h4 className="font-medium mb-2">{t('clients.upsert.fields.type.label')}</h4>
            <p className="text-sm">{t(`clients.upsert.fields.type.${client.type?.toLowerCase()}`)}</p>
          </div>

          <div>
            <h4 className="font-medium mb-2">{t('clients.upsert.fields.contactEmail.label')}</h4>
            <p className="text-sm">{client.contactEmail}</p>
          </div>

          {client.contactPhone && (
            <div>
              <h4 className="font-medium mb-2">Phone</h4>
              <p className="text-sm">{client.contactPhone}</p>
            </div>
          )}

          {client.address && (
            <div>
              <h4 className="font-medium mb-2">{t('clients.upsert.fields.address.label')}</h4>
              <p className="text-sm">{client.address}</p>
            </div>
          )}

          {(client.city || client.postalCode) && (
            <div>
              <h4 className="font-medium mb-2">{t('clients.upsert.fields.city.label')}</h4>
              <p className="text-sm">{[client.city, client.postalCode].filter(Boolean).join(', ')}</p>
            </div>
          )}

          {client.identifiers && Object.keys(client.identifiers).length > 0 && (
            <div>
              <h4 className="font-medium mb-2">Identifiers</h4>
              <div className="space-y-1">
                {Object.entries(client.identifiers).map(([key, value]) => (
                  <p key={key} className="text-sm">
                    <span className="font-medium">{key}:</span> {String(value)}
                  </p>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end space-x-2">
            {onEdit && (
              <Button onClick={onEdit}>Edit</Button>
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
