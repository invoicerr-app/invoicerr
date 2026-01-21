import { Monitor, Smartphone, Tablet } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function UnavailablePlatform() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
      <div className="flex items-center gap-4 mb-6">
        <div className="p-3 bg-muted rounded-full">
          <Monitor className="h-8 w-8 text-muted-foreground" />
        </div>
        <div className="text-4xl text-muted-foreground">→</div>
        <div className="flex gap-2">
          <div className="p-2 bg-muted/50 rounded-full">
            <Smartphone className="h-6 w-6 text-muted-foreground/70" />
          </div>
          <div className="p-2 bg-muted/50 rounded-full">
            <Tablet className="h-6 w-6 text-muted-foreground/70" />
          </div>
        </div>
      </div>

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Monitor className="h-5 w-5" />
            {t('unavailable.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">{t('unavailable.description')}</p>
        </CardContent>
      </Card>
    </div>
  );
}
