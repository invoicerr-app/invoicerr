/**
 * `ClientsService.createClient` → `WebhookDispatcherService.dispatch(CLIENT_CREATED, ...)`, wired for
 * real, against a REAL database — the same "ClientsService constructed directly, real Prisma"
 * discipline `clients.vat-validation.spec.ts` already holds (see that file's own header for why:
 * `WebhooksModule`/`WebhooksService` drag in `@teever/ez-hook`, a pure-ESM package ts-jest cannot
 * compile — `WebhookDispatcherService` itself does not, so it is used here UN-mocked, only its own
 * `WebhooksService` dependency is a bare `{ send }` stub, avoiding that chain without avoiding the
 * dispatcher's own tenant-scoping logic).
 *
 * The defect this reproduces: the four `CLIENT_*` emitters in `clients.service.ts` used to omit
 * `companyId` entirely, so `WebhookDispatcherService.dispatch` fell through to an UNSCOPED
 * `prisma.webhook.findMany` — every company's webhook for that event, not just the client's own. Two
 * real companies, each with their own real `Webhook` row subscribed to `CLIENT_CREATED`, prove the
 * fix end-to-end: creating a client for company A reaches ONLY company A's webhook.
 */
import { randomUUID } from 'node:crypto';

import { ClientsService } from './clients.service';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { VatValidationPort, VatValidationResult } from '../documents/tax/vat-validation';
import { WebhookEvent, WebhookType } from '../../../prisma/generated/prisma/client';
import prisma from '@/prisma/prisma.service';

function fakeVatValidator(result: VatValidationResult): VatValidationPort {
  return { validate: jest.fn().mockResolvedValue(result) };
}

describe('CLIENT_CREATED is tenant-scoped end-to-end (ClientsService -> WebhookDispatcherService -> Prisma)', () => {
  let companyAId: string;
  let companyBId: string;
  let send: jest.Mock;
  let dispatcher: WebhookDispatcherService;

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
    // Real `WebhookDispatcherService`, real Prisma tenant-scoping — only the actual outbound HTTP send
    // (`WebhooksService.send`) is stubbed, so this proves the query/payload, never a real network call.
    send = jest.fn().mockResolvedValue([true]);
    dispatcher = new WebhookDispatcherService({ send } as unknown as WebhooksService);
  });

  it("carries the new client's own companyId and reaches only that company's own webhook", async () => {
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

    expect(send).toHaveBeenCalledTimes(1);
    const [webhooksSent, event, payload] = send.mock.calls[0] as [
      Array<{ companyId: string; url: string }>,
      WebhookEvent,
      { companyId?: string; client?: { companyId: string } },
    ];

    expect(event).toBe(WebhookEvent.CLIENT_CREATED);
    expect(payload.companyId).toBe(companyAId);
    expect(payload.client?.companyId).toBe(companyAId);
    expect(payload.client).toMatchObject({ id: client.id });

    // THE tenant-scoping proof: exactly company A's own webhook reached `send` — company B's, despite
    // subscribing to the identical event, never does.
    expect(webhooksSent).toHaveLength(1);
    expect(webhooksSent[0]).toMatchObject({ companyId: companyAId, url: 'https://a.example.com/hook' });
  });
});
