import { WebhookEvent } from '../../../../prisma/generated/prisma/client';

import { appOrigin } from '@/utils/app-origin';

import { EVENT_STYLES, formatPayloadForEvent } from './event-formatters';

/**
 * The icon and link a chat message carries, taken from THIS instance: a self-hosted deployment must
 * not send its users to a site where they have no account, nor ask a closed network to fetch an
 * image from the open internet. `favicon.svg` because every deployment serves it.
 */
export const instanceUrl = (): string => appOrigin();
export const instanceIcon = (): string => `${instanceUrl()}/favicon.svg`;

/** What every chat-style driver (Discord, Teams, Slack family) renders, before its own markup. */
export interface EventMessage {
  title: string;
  color: string;
  description: string;
  companyName?: string;
}

/**
 * `fallbackColor` covers an event the style table does not know: a job queued before an enum member
 * was removed still carries the old name.
 */
export function describeEvent(payload: any, fallbackColor: string): EventMessage {
  const event = payload.event as WebhookEvent;
  const style = EVENT_STYLES[event] || { color: fallbackColor, emoji: '📢', title: 'Event' };

  return {
    title: `${style.emoji} ${style.title}`,
    color: style.color,
    description: formatPayloadForEvent(event, payload),
    companyName: payload.company?.name || undefined,
  };
}
