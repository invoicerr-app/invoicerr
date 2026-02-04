import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface ClientListProps {
  clients: any[];
  loading: boolean;
  onCreate?: () => void;
  onEdit?: (client: any) => void;
  onDelete?: (id: string) => void;
}

export function ClientList({ clients, loading, onCreate, onEdit, onDelete }: ClientListProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500" />
          </div>
        ) : clients.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-sm text-muted-foreground">{t('clients.emptyState.noClients')}</p>
            <p className="text-sm text-primary mt-2">{t('clients.emptyState.startAdding')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">{t('clients.list.title')}</h3>
              {onCreate && (
                <Button onClick={onCreate}>
                  {t('clients.actions.addNew')}
                </Button>
              )}
            </div>
            <Input placeholder={t('clients.search.placeholder')} className="mb-4" />
            <div className="space-y-2">
              {clients.map((client) => (
                <div key={client.id} className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <h4 className="font-medium">{client.name}</h4>
                    {client.email && <p className="text-sm text-muted-foreground">{client.email}</p>}
                  </div>
                  <div className="flex gap-2">
                    {onEdit && (
                      <Button variant="outline" size="sm" onClick={() => onEdit(client)}>
                        Edit
                      </Button>
                    )}
                    {onDelete && (
                      <Button variant="destructive" size="sm" onClick={() => onDelete(client.id)}>
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
