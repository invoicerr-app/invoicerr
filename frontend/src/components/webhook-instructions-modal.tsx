import { Check, Copy, ExternalLink, Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface WebhookInstructionsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pluginName: string;
  webhookUrl: string;
  webhookSecret: string;
  instructions: string[];
}

export function WebhookInstructionsModal({
  open,
  onOpenChange,
  pluginName,
  webhookUrl,
  webhookSecret,
  instructions,
}: WebhookInstructionsModalProps) {
  const { t } = useTranslation();
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  const copyWebhookUrl = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopiedUrl(true);
      toast.success('Webhook URL copied to clipboard!');
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch (_error) {
      toast.error('Failed to copy webhook URL');
    }
  };

  const copyWebhookSecret = async () => {
    try {
      await navigator.clipboard.writeText(webhookSecret);
      setCopiedSecret(true);
      toast.success('Webhook secret copied to clipboard!');
      setTimeout(() => setCopiedSecret(false), 2000);
    } catch (_error) {
      toast.error('Failed to copy webhook secret');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ExternalLink className="h-5 w-5" />
            {t('webhook.modal.title', { pluginName })}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Webhook URL */}
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('webhook.modal.url')}</label>
            <div className="flex items-center gap-2">
              <div className="flex-1 p-3 bg-muted rounded-md font-mono text-sm break-all">
                {webhookUrl}
              </div>
              <Button variant="outline" size="icon" onClick={copyWebhookUrl} disabled={copiedUrl}>
                {copiedUrl ? (
                  <Check className="h-4 w-4 text-green-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Webhook Secret */}
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('webhook.modal.secret')}</label>
            <div className="flex items-center gap-2">
              <div className="flex-1 p-3 bg-muted rounded-md font-mono text-sm break-all">
                {showSecret ? webhookSecret : '•'.repeat(32)}
              </div>
              <Button variant="outline" size="icon" onClick={() => setShowSecret(!showSecret)}>
                {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={copyWebhookSecret}
                disabled={copiedSecret}
              >
                {copiedSecret ? (
                  <Check className="h-4 w-4 text-green-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('webhook.modal.secretDescription')}</p>
          </div>

          {/* Instructions */}
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('webhook.modal.instructions')}</label>
            <div className="p-4 bg-muted rounded-md">
              <ol className="space-y-2">
                {instructions.map((instructionKey, index) => (
                  <li key={index} className="text-sm">
                    {instructionKey.endsWith('.title') ? (
                      <div className="font-semibold text-primary mb-2">{t(instructionKey)}</div>
                    ) : instructionKey.match(/\.step\d+$/) ? (
                      <div className="flex gap-2">
                        <span className="font-medium text-primary">
                          {t(instructionKey).match(/^\d+\./)?.[0]}
                        </span>
                        <span>{t(instructionKey).replace(/^\d+\.\s*/, '')}</span>
                      </div>
                    ) : (
                      <div className="ml-4 text-muted-foreground">{t(instructionKey)}</div>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          </div>

          {/* Warning */}
          <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md">
            <div className="text-sm text-yellow-800">
              <strong>Important:</strong> {t('webhook.modal.warning', { pluginName })}
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end">
            <Button onClick={() => onOpenChange(false)}>{t('webhook.modal.gotIt')}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
