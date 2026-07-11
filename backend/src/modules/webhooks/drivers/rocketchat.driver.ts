import { WebhookType } from '../../../../prisma/generated/prisma/client';

import { ChatWebhookDriver } from './chat-webhook.driver';

export class RocketChatDriver extends ChatWebhookDriver {
  protected readonly type = WebhookType.ROCKETCHAT;
  protected readonly fallbackColor = '#F3F4F6';
  protected readonly iconKey = 'avatar' as const;
}
