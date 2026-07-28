import { WebhookType } from '../../../../prisma/generated/prisma/client';

import { ChatWebhookDriver } from './chat-webhook.driver';

export class MattermostDriver extends ChatWebhookDriver {
  protected readonly type = WebhookType.MATTERMOST;
  protected readonly fallbackColor = '#5865F2';
  protected readonly iconKey = 'icon_url' as const;
}
