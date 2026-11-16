import { ChatWebhookDriver } from './chat-webhook.driver';

export class RocketChatDriver extends ChatWebhookDriver {
  protected readonly fallbackColor = '#F3F4F6';
  protected readonly iconKey = 'avatar' as const;
}
