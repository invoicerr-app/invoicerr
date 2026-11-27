/**
 * `dispatchWebhookSafely`: the best-effort send of one company or client webhook, written once for
 * every call site (the `DOCUMENT_*` counterpart is `documents/queue/dispatch-document-webhook.ts`).
 * Kept apart from `webhook-dispatcher.service.ts`, and taking the dispatcher as an argument, so the
 * many specs that mock that module or pass a bare `{ dispatch: vi.fn() }` keep exercising this code.
 */
import type { WebhookEvent } from '../../../prisma/generated/prisma/client';
import { logger } from '@/logger/logger.service';

import type { WebhookDispatcherService, WebhookDispatchPayload } from './webhook-dispatcher.service';

/** How a failed dispatch is logged: the call site's exact message, its category and extra details. */
export interface WebhookDispatchFailureLog {
  message: string;
  category: string;
  /** Spread into `details` after `error`. */
  details?: Record<string, unknown>;
}

/** The `logger.error` line for a failed dispatch, also used for a failure just before the dispatch. */
export function logWebhookDispatchFailure(failure: WebhookDispatchFailureLog, error: unknown): void {
  logger.error(failure.message, { category: failure.category, details: { error, ...failure.details } });
}

/**
 * Dispatches one webhook and NEVER throws: the write it announces already happened, so a failure
 * (which `dispatch` has already logged once before rethrowing) is logged again for the call site
 * instead of failing the request.
 */
export async function dispatchWebhookSafely(
  dispatcher: Pick<WebhookDispatcherService, 'dispatch'>,
  event: WebhookEvent,
  payload: WebhookDispatchPayload,
  failure: WebhookDispatchFailureLog,
): Promise<void> {
  try {
    await dispatcher.dispatch(event, payload);
  } catch (error) {
    logWebhookDispatchFailure(failure, error);
  }
}
