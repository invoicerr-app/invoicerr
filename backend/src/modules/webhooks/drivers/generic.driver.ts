import type { Dispatcher } from 'undici';

import { WEBHOOK_FETCH_TIMEOUT_MS, WebhookDriver } from './webhook-driver.interface';
import { WebhookType } from '../../../../prisma/generated/prisma/client';
// Named import, not `import crypto from 'node:crypto'`: this codebase's tsconfig
// (`module: NodeNext`) compiles a DEFAULT import of a Node builtin correctly under `nest build`
// (tsc's own `__importDefault` CommonJS interop helper), but ts-jest's per-file transform of the
// same `NodeNext` module kind does not apply that helper consistently — the default binding comes
// back `undefined` at test time only, silently no-signature-computed rather than a loud failure. A
// named import sidesteps the whole default-export interop question, the same way every OTHER
// `node:crypto` import in this codebase already does (`utils/secret-crypto.ts`, `utils/api-key.ts`).
import { createHmac } from 'node:crypto';

export class GenericDriver implements WebhookDriver {
  supports(type: WebhookType) {
    return type === WebhookType.GENERIC;
  }

  async send(url: string, payload: any, secret?: string | null, dispatcher?: Dispatcher): Promise<boolean> {
    const body = JSON.stringify(payload);

    const signature = secret ? createHmac('sha256', secret).update(body).digest('hex') : null;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(signature ? { 'X-Webhook-Signature': signature } : {}),
      },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(WEBHOOK_FETCH_TIMEOUT_MS),
      // Pins the connection to the address `webhooks.service.ts#send` already validated — see
      // `webhook-driver.interface.ts`'s own header on why this must never be omitted.
      dispatcher,
    } as RequestInit);

    return res.ok;
  }
}
