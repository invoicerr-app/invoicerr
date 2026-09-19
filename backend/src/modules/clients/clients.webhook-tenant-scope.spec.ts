/**
 * `ClientsService.createClient` → `WebhookDispatcherService.dispatch(CLIENT_CREATED, ...)` →
 * `WebhookDeliveryService.deliver` → Prisma, wired for real, against a REAL database — the same
 * "ClientsService constructed directly, real Prisma" discipline `clients.vat-validation.spec.ts`
 * already holds (see that file's own header for why: `WebhooksModule`/`WebhooksService` drag in
 * `@teever/ez-hook`, a pure-ESM package the test compiler cannot import "as a module" —
 * `WebhookDispatcherService`/`WebhookDeliveryService` themselves do not, so both are used here
 * UN-mocked, only `WebhooksService` itself is a bare `{ send }` stub, avoiding that chain without
 * avoiding either class's own real logic).
 *
 * The defect this reproduces: the four `CLIENT_*` emitters in `clients.service.ts` used to omit
 * `companyId` entirely, so `WebhookDispatcherService.dispatch` fell through to an UNSCOPED
 * `prisma.webhook.findMany` — every company's webhook for that event, not just the client's own. Two
 * real companies, each with their own real `Webhook` row subscribed to `CLIENT_CREATED`, prove the fix
 * end-to-end: creating a client for company A reaches ONLY company A's webhook.
 *
 * Outbound delivery moved onto its own queue since this test was first written (see
 * `webhook-dispatcher.service.ts`'s own header) — `dispatch()` now queries the REAL `Webhook` table
 * itself (scoped by companyId) to decide how many jobs to create, one per subscriber, so the tenant
 * proof now has two legs instead of one: (1) `dispatch()`'s own real Prisma query enqueues EXACTLY ONE
 * job, for company A's own webhook id, never company B's; and (2) replaying that exact job's data
 * through the real `WebhookDeliveryService` — the class that re-fetches that ONE row fresh at delivery
 * time — still reaches only company A's row. Splitting the proof this way follows the queue boundary
 * honestly rather than mocking it away.
 */

import { vi, type Mock } from 'vitest';

import { randomUUID } from 'node:crypto';

import { ClientsService } from './clients.service';
import { WebhookDeliveryService } from '../webhooks/webhook-delivery.service';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { VatValidationPort, VatValidationResult } from '../documents/tax/vat-validation';
import { WebhookEvent, WebhookType } from '../../../prisma/generated/prisma/client';
import prisma from '@/prisma/prisma.service';

function fakeVatValidator(result: VatValidationResult): VatValidationPort {
  return { validate: vi.fn().mockResolvedValue(result) };
}

describe('CLIENT_CREATED is tenant-scoped end-to-end (ClientsService -> WebhookDispatcherService -> queue -> WebhookDeliveryService -> Prisma)', () => {
  let companyAId: string;
  let companyBId: string;
  let send: Mock;
  let queueAdd: Mock;
  let dispatcher: WebhookDispatcherService;
  let delivery: WebhookDeliveryService;

  beforeAll(async () => {
    const suffix = randomUUID();
    const [companyA, companyB] = await Promise.all([
      prisma.company.create({
        data: {
          name: `Tenant A ${suffix}`,
          foundedAt: new Date('2020-01-01'),
          address: '1 Rue A',
          postalCode: '00000',
          city: 'Aville',
          country: 'France',
          countryCode: 'FR',
          phone: '+33000000001',
          email: `tenant-a-${suffix}@example.com`,
        },
      }),
      prisma.company.create({
        data: {
          name: `Tenant B ${suffix}`,
          foundedAt: new Date('2020-01-01'),
          address: '1 Rue B',
          postalCode: '00000',
          city: 'Bville',
          country: 'France',
          countryCode: 'FR',
          phone: '+33000000002',
          email: `tenant-b-${suffix}@example.com`,
        },
      }),
    ]);
    companyAId = companyA.id;
    companyBId = companyB.id;

    // Both subscribe to the SAME event — the only thing that must tell them apart is `companyId`.
    await Promise.all([
      prisma.webhook.create({
        data: {
          url: 'https://a.example.com/hook',
          type: WebhookType.GENERIC,
          events: [WebhookEvent.CLIENT_CREATED],
          secret: 'a-secret',
          companyId: companyAId,
        },
      }),
      prisma.webhook.create({
        data: {
          url: 'https://b.example.com/hook',
          type: WebhookType.GENERIC,
          events: [WebhookEvent.CLIENT_CREATED],
          secret: 'b-secret',
          companyId: companyBId,
        },
      }),
    ]);
  });

  afterAll(async () => {
    await prisma.webhook.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
    await prisma.client.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
    await prisma.company.deleteMany({ where: { id: { in: [companyAId, companyBId] } } });
  });

  beforeEach(() => {
    // Real `WebhookDispatcherService` against a fake `Queue` (only `.add` is ever called) — proves the
    // ENQUEUE carries the right companyId without needing real Redis. Real `WebhookDeliveryService`
    // against a real Prisma — only the actual outbound HTTP send (`WebhooksService.send`) is stubbed —
    // proves the DELIVERY side's own query/payload once replayed, never a real network call.
    send = vi.fn().mockResolvedValue([true]);
    queueAdd = vi.fn().mockResolvedValue(undefined);
    dispatcher = new WebhookDispatcherService({ add: queueAdd } as never);
    delivery = new WebhookDeliveryService({ send } as unknown as WebhooksService);
  });

  it("enqueues a job carrying the new client's own companyId, and reaches only that company's own webhook once delivered", async () => {
    const validator = fakeVatValidator({ status: 'VALID', checkedAt: new Date(), source: 'eu-vies' });
    const service = new ClientsService(dispatcher, validator);

    const client = await service.createClient(companyAId, {
      name: 'Acme SARL',
      address: 'Somewhere',
      postalCode: '75000',
      city: 'Paris',
      country: 'France',
      countryCode: 'FR',
      currency: 'EUR',
      isActive: true,
    } as never);

    // Leg 1 — `dispatch()` itself already queried the REAL `Webhook` table (scoped by companyId) to
    // decide how many jobs to create: exactly ONE, for company A's own row — company B's, despite
    // subscribing to the identical event, was never even considered. The enqueued job's own data
    // carries company A's id, never company B's, and never nothing.
    expect(queueAdd).toHaveBeenCalledTimes(1);
    const [, jobData] = queueAdd.mock.calls[0] as [
      string,
      {
        companyId: string;
        webhookId: string;
        event: WebhookEvent;
        payload: { companyId?: string; client?: { companyId: string } };
      },
    ];
    expect(jobData.companyId).toBe(companyAId);
    expect(jobData.event).toBe(WebhookEvent.CLIENT_CREATED);
    expect(jobData.payload.companyId).toBe(companyAId);
    expect(jobData.payload.client?.companyId).toBe(companyAId);
    expect(jobData.payload.client).toMatchObject({ id: client.id });

    // Leg 2 — replaying that EXACT job through the real delivery path (what
    // `queue/webhook-delivery.processor.ts` does in production) reaches company A's webhook only.
    await delivery.deliver(jobData.companyId, jobData.webhookId, jobData.event, jobData.payload);

    expect(send).toHaveBeenCalledTimes(1);
    const [webhooksSent] = send.mock.calls[0] as [Array<{ companyId: string; url: string }>];
    expect(webhooksSent).toHaveLength(1);
    expect(webhooksSent[0]).toMatchObject({ companyId: companyAId, url: 'https://a.example.com/hook' });
  });
});
