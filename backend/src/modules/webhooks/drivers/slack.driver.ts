import { ChatWebhookDriver } from './chat-webhook.driver';

export class SlackDriver extends ChatWebhookDriver {
  protected readonly fallbackColor = '#439FE0';
  protected readonly iconKey = 'icon_url' as const;
}
